export type Item = Record<string, any> & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Envelope<T> = {
  data: T;
  meta: { requestId: string; hasMore?: boolean; nextCursor?: string | null };
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: any = {},
    public requestId = "",
  ) {
    super(message);
  }
}
let csrf = "";
declare global {
  interface Window {
    __SQUARE_CONFIG__?: { apiOrigin?: string };
  }
}
export function apiUrl(path: string) {
  const origin = (
    window.__SQUARE_CONFIG__?.apiOrigin ||
    import.meta.env.VITE_API_ORIGIN ||
    ""
  ).replace(/\/+$/, "");
  return `${origin}/api/v1${path}`;
}
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<Envelope<T>> {
  const headers = new Headers(options.headers),
    method = options.method || "GET";
  if (method !== "GET") {
    headers.set("X-CSRF-Token", csrf);
    if (!headers.has("Idempotency-Key"))
      headers.set("Idempotency-Key", crypto.randomUUID());
    if (!(options.body instanceof FormData))
      headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(apiUrl(url), {
      ...options,
      headers,
      credentials: "include",
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw new ApiError("API_UNREACHABLE", "无法连接后端，请检查服务状态。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      `服务返回无法读取的响应（HTTP ${response.status}）。`,
    );
  }
  if (!response.ok) {
    if (response.status === 401 && url !== "/auth/login" && url !== "/auth/me")
      window.dispatchEvent(new Event("square:session-expired"));
    throw new ApiError(
      data.error?.code || "REQUEST_FAILED",
      data.error?.message || `HTTP ${response.status}`,
      data.error?.details,
      data.meta?.requestId,
    );
  }
  return data;
}
export const send = (url: string, body: any = {}, method = "POST") =>
  api(url, { method, body: JSON.stringify(body) });
export const date = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Taipei",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "—";
export const shortDate = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
export const json = (value: any) => JSON.stringify(value, null, 2);
