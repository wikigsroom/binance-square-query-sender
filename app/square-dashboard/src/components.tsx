import {
  ReactNode,
  ReactElement,
  cloneElement,
  isValidElement,
  useId,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertCircle, Check, ChevronRight, Loader2, X } from "lucide-react";
import { api, ApiError, date, Item, json } from "./api";

export function useData<T = any>(
  path: string,
  refreshKey: any = 0,
  interval = 10000,
) {
  const [data, setData] = useState<T | null>(null),
    [meta, setMeta] = useState<any>({}),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(true),
    [revision, reload] = useState(0);
  const lastPath = useRef(path);
  useEffect(() => {
    let alive = true,
      busy = false;
    const controller = new AbortController();
    if (lastPath.current !== path) {
      setData(null);
      setMeta({});
      lastPath.current = path;
    }
    setLoading(true);
    setError(null);
    const load = () => {
      if (busy || !alive) return;
      busy = true;
      return api<T>(path, { signal: controller.signal })
        .then((r) => {
          if (alive) {
            setData(r.data);
            setMeta(r.meta);
            setError(null);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (alive) {
            setError(e);
            setLoading(false);
          }
        })
        .finally(() => {
          busy = false;
        });
    };
    void load();
    const timer = interval ? setInterval(load, interval) : null;
    return () => {
      alive = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, refreshKey, revision, interval]);
  return {
    data: lastPath.current === path ? data : null,
    meta,
    error,
    loading,
    reload: () => reload((v) => v + 1),
  };
}
export function useDebouncedValue<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
export function notify(message: string) {
  window.dispatchEvent(new CustomEvent("square:toast", { detail: message }));
}
export function Toasts() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const show = (e: Event) => {
      const id = Date.now() + Math.random();
      setItems((p) => [
        ...p.slice(-2),
        { id, text: (e as CustomEvent).detail },
      ]);
      timers.current.push(
        setTimeout(() => setItems((p) => p.filter((m) => m.id !== id)), 4500),
      );
    };
    addEventListener("square:toast", show);
    return () => {
      removeEventListener("square:toast", show);
      timers.current.forEach(clearTimeout);
    };
  }, []);
  return (
    <div
      className="toast-stack"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <div className="toast" key={item.id}>
          <Check size={18} />
          <span>{item.text}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setItems((p) => p.filter((m) => m.id !== item.id))}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
export function ErrorBox({ error }: { error: any }) {
  const issues = Array.isArray(error.details?.errors)
    ? error.details.errors
    : [];
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>{error.message || "操作失败"}</strong>
        {error.code && (
          <small>
            {error.code}
            {error.requestId ? ` · ${error.requestId}` : ""}
          </small>
        )}
        {issues.length > 0 && (
          <ul>
            {issues.map((issue: any, index: number) => (
              <li key={index}>
                <strong>{issue.code}</strong>：{issue.message}
                {Array.isArray(issue.expected) && (
                  <small>
                    应有：
                    {issue.expected
                      .map((token: string) => `$${token}`)
                      .join("、")}
                    ；实际：
                    {issue.actual?.length
                      ? issue.actual
                          .map((token: string) => `$${token}`)
                          .join("、")
                      : "未识别到标签"}
                  </small>
                )}
                {issue.sourceTitle && (
                  <small>所绑定新闻：{issue.sourceTitle}</small>
                )}
              </li>
            ))}
          </ul>
        )}
        {error.details && Object.keys(error.details).length > 0 && (
          <details>
            <summary>错误详情</summary>
            <pre>{json(error.details)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <Loader2 size={20} className="spin" /> 正在读取数据
    </div>
  );
}
export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">···</div>
      <p>{children}</p>
      {action}
    </div>
  );
}
const labels: Record<string, string> = {
  active: "可用",
  disabled: "已停用",
  archived: "已归档",
  unverified: "未验证",
  publish_authenticated: "发布认证通过",
  invalid: "认证失效",
  queued: "排队中",
  preparing: "读取素材",
  generating_text: "AI 写作",
  validating: "内容校验",
  preparing_media: "准备图片",
  ready: "等待提交",
  submitting: "提交中",
  retry_wait: "等待重试",
  published: "已确认发布",
  preview_ready: "预览就绪",
  submission_unknown: "提交结果不明",
  failed: "失败",
  blocked: "已阻塞",
  cancelled: "已取消",
  not_started: "未核验",
  pending: "等待核验",
  verified: "核验通过",
  mismatch: "内容不一致",
  unavailable: "无法完整核验",
  running: "运行中",
  completed: "已完成",
  result_unknown: "结果不明",
  library: "已有图库",
  gpt_image_2: "GPT Image 2",
  manual: "手动",
  scheduled: "自动",
  preview: "预览",
};
export const label = (value: string) => labels[value] || value;
export function Badge({
  value,
  children,
}: {
  value?: string;
  children?: ReactNode;
}) {
  const good = [
      "active",
      "published",
      "verified",
      "completed",
      "preview_ready",
      "publish_authenticated",
    ].includes(value || ""),
    bad = ["failed", "blocked", "invalid", "mismatch"].includes(value || ""),
    warm = [
      "submission_unknown",
      "result_unknown",
      "pending",
      "unverified",
      "retry_wait",
    ].includes(value || "");
  return (
    <span
      className={`badge ${good ? "good" : bad ? "bad" : warm ? "warm" : ""}`}
    >
      {children || label(value || "")}
    </span>
  );
}
export function Button({
  children,
  onClick,
  kind = "",
  disabled = false,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${kind}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
export function Field({
  label: caption,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  const fieldId = useId();
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label htmlFor={fieldId}>{caption}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<any>, {
            id: fieldId,
            "aria-describedby": hint ? `${fieldId}-hint` : undefined,
          })
        : children}
      {hint && <small id={`${fieldId}-hint`}>{hint}</small>}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => {
      d?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function JsonPanel({
  title,
  value,
  open = false,
}: {
  title: string;
  value: any;
  open?: boolean;
}) {
  return (
    <details className="json-panel" open={open}>
      <summary>
        {title}
        <ChevronRight size={16} />
      </summary>
      <pre>{json(value)}</pre>
    </details>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}
export function InlineError({ error }: { error: any }) {
  return error ? <ErrorBox error={error} /> : null;
}
export function AsyncButton({
  children,
  action,
  onDone,
  kind = "",
  disabled = false,
}: {
  children: ReactNode;
  action: () => Promise<any>;
  onDone?: (data: any) => void;
  kind?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<any>(null);
  return (
    <div className="async-button">
      <Button
        kind={kind}
        disabled={busy || disabled}
        onClick={() => {
          setBusy(true);
          setError(null);
          void action()
            .then((r) => {
              notify("操作已完成");
              onDone?.(r.data ?? r);
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <Loader2 size={15} className="spin" /> : null}
        {children}
      </Button>
      {error && <ErrorBox error={error} />}
    </div>
  );
}
export function Timeline({ events }: { events: Item[] }) {
  return (
    <ol className="event-list">
      {[...events].reverse().map((e) => (
        <li key={e.id}>
          <span className="event-dot" />
          <div>
            <strong>{label(e.type)}</strong>
            <time>{date(e.createdAt)}</time>
            {e.error && <ErrorBox error={e.error} />}
            <JsonPanel title="事件记录" value={e} />
          </div>
        </li>
      ))}
    </ol>
  );
}
