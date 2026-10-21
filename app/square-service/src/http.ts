import dns from "node:dns/promises";
import net from "node:net";
import { fetch, Agent, ProxyAgent } from "undici";
import { Fault, Doc, redact, requireThat } from "./core.js";

export class Http {
  private dispatcher: Agent | ProxyAgent;
  constructor(proxy = "") {
    this.dispatcher = proxy ? new ProxyAgent(proxy) : new Agent();
  }
  async checkUrl(
    value: string,
    policy: { allowedHosts?: string[]; allowPrivateNetwork?: boolean } = {},
  ) {
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      throw new Fault("INVALID_URL", "服务地址格式不正确。");
    }
    requireThat(
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password,
      "INVALID_URL",
      "仅支持没有嵌入凭据的 HTTP(S) 地址。",
    );
    if (!policy.allowPrivateNetwork)
      requireThat(
        u.protocol === "https:",
        "HTTPS_REQUIRED",
        "公开来源必须使用 HTTPS。",
      );
    if (policy.allowedHosts)
      requireThat(
        policy.allowedHosts.includes(u.hostname),
        "HOST_NOT_ALLOWED",
        `地址不在允许域名中：${u.hostname}`,
      );
    if (!policy.allowPrivateNetwork) {
      const records = await dns.lookup(u.hostname, { all: true });
      requireThat(
        records.length && !records.some((r) => privateIp(r.address)),
        "PRIVATE_ADDRESS_BLOCKED",
        "公开数据源不得读取内网地址。",
      );
    }
    return u;
  }
  async request(url: string, options: Doc = {}, policy: Doc = {}) {
    await this.checkUrl(url, policy);
    let response;
    const secrets = policy.secrets || [];
    try {
      response = await fetch(url, {
        ...options,
        redirect: "error",
        signal:
          options.signal || AbortSignal.timeout(policy.timeoutMs || 60000),
        dispatcher: this.dispatcher,
      } as any);
    } catch (e: any) {
      throw new Fault(
        "UPSTREAM_NETWORK_ERROR",
        redact(e.message, secrets),
        502,
        { url: safeUrl(url), cause: redact(e.cause?.message || "", secrets) },
        true,
      );
    }
    const max = policy.maxBytes || 8 * 1024 * 1024;
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > max) {
      await response.body?.cancel();
      throw new Fault("RESPONSE_TOO_LARGE", "远端响应超过上限。", 502);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (response.body)
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > max) {
          await response.body.cancel().catch(() => {});
          throw new Fault("RESPONSE_TOO_LARGE", "远端响应超过上限。", 502);
        }
        chunks.push(Buffer.from(chunk));
      }
    const bytes = Buffer.concat(chunks);
    if (!response.ok)
      throw new Fault(
        response.status === 429 ? "REMOTE_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR",
        `HTTP ${response.status}`,
        502,
        {
          httpStatus: response.status,
          retryAfter: response.headers.get("retry-after"),
          raw: redact(bytes.toString("utf8").slice(0, 16000), secrets),
          url: safeUrl(url),
        },
        [429, 502, 503, 504].includes(response.status),
      );
    return {
      bytes,
      status: response.status,
      headers: response.headers,
      json: () => {
        try {
          return JSON.parse(bytes.toString("utf8"));
        } catch {
          throw new Fault("UPSTREAM_INVALID_JSON", "远端没有返回 JSON。", 502, {
            raw: redact(bytes.toString("utf8").slice(0, 16000), secrets),
          });
        }
      },
      text: () => bytes.toString("utf8"),
    };
  }
  async close() {
    await this.dispatcher?.close();
  }
}
function privateIp(address: string) {
  if (
    address === "::1" ||
    address === "::" ||
    /^f[cd]/i.test(address) ||
    /^fe[89ab]/i.test(address)
  )
    return true;
  if (address.startsWith("::ffff:")) return privateIp(address.slice(7));
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  return false;
}
export function safeUrl(value: string) {
  const u = new URL(value);
  return `${u.origin}${u.pathname}`;
}
