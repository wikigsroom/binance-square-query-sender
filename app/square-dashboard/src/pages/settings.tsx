import { AISettings } from "./ai-settings";
import { SourceSettings } from "./source-settings";
import { useState } from "react";
import {
  PlugZap,
  Database,
  ShieldCheck,
  KeyRound,
  Settings2,
} from "lucide-react";
import { send, Item, date } from "../api";
import {
  useData,
  PageHead,
  Loading,
  Field,
  AsyncButton,
  JsonPanel,
} from "../components";

export function SettingsPage({ onChange }: { onChange: () => void }) {
  const [tab, setTab] = useState(
    new URLSearchParams(location.search).get("section") || "models",
  );
  const { data: runtime, reload: reloadRuntime } = useData("/runtime"),
    { data: health } = useData("/health");
  return (
    <>
      <PageHead
        eyebrow="WORKSPACE SETTINGS"
        title="系统设置"
        description="把 AI 接入、内容来源和运行方式，配置成适合你的工作流。"
      />
      <div className="tabs settings-tabs" role="tablist" aria-label="设置分类">
        {[
          ["models", "AI 接入"],
          ["sources", "数据源"],
          ["runtime", "运行控制"],
          ["admin", "管理员与审计"],
        ].map(([id, name]) => (
          <button
            role="tab"
            id={`settings-tab-${id}`}
            aria-controls="settings-panel"
            aria-selected={tab === id}
            key={id}
            onClick={() => {
              setTab(id);
              history.replaceState({}, "", `/settings?section=${id}`);
            }}
          >
            {id === "models" ? (
              <PlugZap size={16} />
            ) : id === "sources" ? (
              <Database size={16} />
            ) : id === "runtime" ? (
              <Settings2 size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
            {name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={`settings-tab-${tab}`}
      >
        {tab === "models" && <AISettings />}
        {tab === "sources" && <SourceSettings />}
        {tab === "runtime" &&
          (!runtime ? (
            <Loading />
          ) : (
            <RuntimeForm
              key={runtime.version}
              runtime={runtime}
              health={health}
              onSave={() => {
                reloadRuntime();
                onChange();
              }}
            />
          ))}
        {tab === "admin" && <AdminSettings />}
      </div>
    </>
  );
}
function RuntimeForm({
  runtime: r,
  health,
  onSave,
}: {
  runtime: any;
  health: any;
  onSave: () => void;
}) {
  const [values, setValues] = useState<any>({
      concurrency: r.concurrency,
      textConcurrency: r.textConcurrency,
      imageConcurrency: r.imageConcurrency,
      leaseSeconds: r.leaseSeconds,
      stepRetries: r.stepRetries,
      contentValidationMode: r.contentValidationMode || "strict",
    }),
    [banned, setBanned] = useState(r.globalBannedWords.join(", "));
  return (
    <section className="panel settings-panel">
      <h2>运行参数</h2>
      <div className="form-grid">
        {[
          ["concurrency", "任务最大并发"],
          ["textConcurrency", "文字模型最大并发"],
          ["imageConcurrency", "图片模型最大并发"],
          ["leaseSeconds", "执行租约（秒）"],
          ["stepRetries", "步骤自动重试上限"],
        ].map(([key, title]) => (
          <Field label={title} key={key}>
            <input
              type="number"
              min={key === "stepRetries" ? 0 : 1}
              max={1000}
              value={values[key]}
              onChange={(e) =>
                setValues((v: any) => ({ ...v, [key]: Number(e.target.value) }))
              }
            />
          </Field>
        ))}
        <Field
          label="内容校验模式"
          hint="发送优先：关闭 AI 审稿，内容问题记为提示，不阻止发布。"
          wide
        >
          <select
            value={values.contentValidationMode}
            onChange={(e) =>
              setValues((v: any) => ({
                ...v,
                contentValidationMode: e.target.value,
              }))
            }
          >
            <option value="publish_first">发送优先 · 内容问题仅提示</option>
            <option value="strict">严格校验 · 内容问题阻止发布</option>
          </select>
        </Field>
        <Field
          label="全局禁词（继承的“情绪”不可移除）"
          hint={
            values.contentValidationMode === "publish_first"
              ? "当前只记录禁词提示，不会阻止发布。"
              : undefined
          }
          wide
        >
          <input value={banned} onChange={(e) => setBanned(e.target.value)} />
        </Field>
      </div>
      <AsyncButton
        kind="primary"
        action={() =>
          send(
            "/runtime",
            {
              expectedVersion: r.version,
              ...values,
              globalBannedWords: banned
                .split(/[,，]/)
                .map((s: string) => s.trim())
                .filter(Boolean),
            },
            "PATCH",
          )
        }
        onDone={onSave}
      >
        保存运行参数
      </AsyncButton>
      <div className="divider" />
      <dl className="info-list">
        <div>
          <dt>数据库</dt>
          <dd>
            {health?.databaseMode === "embedded_development"
              ? "开发嵌入模式"
              : "PostgreSQL"}
          </dd>
        </div>
        <div>
          <dt>真实发布传输</dt>
          <dd>{health?.publishTransportEnabled ? "已启用" : "未启用"}</dd>
        </div>
        <div>
          <dt>服务器存储</dt>
          <dd>{health?.storage || "读取中"}</dd>
        </div>
        <div>
          <dt>最近 Worker 心跳</dt>
          <dd>{date(health?.worker?.at)}</dd>
        </div>
      </dl>
    </section>
  );
}
function AdminSettings() {
  const { data: events } = useData<Item[]>("/audit-events?limit=30"),
    [oldPassword, setOld] = useState(""),
    [newPassword, setNew] = useState(""),
    [result, setResult] = useState("");
  return (
    <>
      <section className="panel settings-panel">
        <h2>
          <ShieldCheck size={20} />
          修改管理员密码
        </h2>
        <div className="form-grid">
          <Field label="当前密码">
            <input
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOld(e.target.value)}
            />
          </Field>
          <Field label="新密码（至少12字符）">
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </Field>
        </div>
        <AsyncButton
          kind="primary"
          disabled={newPassword.length < 12 || !oldPassword}
          action={() => send("/auth/password", { oldPassword, newPassword })}
          onDone={() => {
            setOld("");
            setNew("");
            setResult("密码已更新。其他会话已失效。");
          }}
        >
          更新密码
        </AsyncButton>
        {result && (
          <p className="success-text" role="status">
            {result}
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>最近操作审计</h2>
        </div>
        {events?.map((e) => (
          <div className="audit-row" key={e.id}>
            <strong>{e.type}</strong>
            <time>{date(e.createdAt)}</time>
            <JsonPanel title="审计详情" value={e} />
          </div>
        ))}
      </section>
    </>
  );
}
