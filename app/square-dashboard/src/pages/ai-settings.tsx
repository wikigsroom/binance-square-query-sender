import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Cpu,
  Eye,
  EyeOff,
  Image,
  KeyRound,
  Loader2,
  Plus,
  PlugZap,
  Search,
  Settings2,
  Sparkles,
  TextCursorInput,
  X,
} from "lucide-react";
import { Item, date, json, send } from "../api";
import {
  AsyncButton,
  Badge,
  Button,
  Empty,
  ErrorBox,
  Field,
  JsonPanel,
  Loading,
  Modal,
  notify,
  useData,
} from "../components";

export function AISettings() {
  const connections = useData<Item[]>("/model-connections?limit=100"),
    models = useData<Item[]>("/models?limit=100"),
    settings = useData("/ai/settings"),
    catalog = useData("/ai/catalog", 0, 0);
  const [editing, setEditing] = useState<Item | null | false>(false),
    [discover, setDiscover] = useState<Item | null>(null),
    [register, setRegister] = useState<any>(null),
    [filter, setFilter] = useState("");
  const refresh = () => {
    connections.reload();
    models.reload();
    settings.reload();
  };
  const error =
    connections.error || models.error || settings.error || catalog.error;
  if (error) return <ErrorBox error={error} />;
  if (!connections.data || !models.data || !settings.data || !catalog.data)
    return <Loading />;
  const cs = connections.data,
    ms = models.data,
    defaults = settings.data;
  const readyModels = ms.filter(
    (m) => m.approved && cs.some((c) => c.id === m.connectionId && c.enabled),
  );
  return (
    <>
      <section className="ai-intro panel">
        <div className="ai-intro-copy">
          <span className="feature-mark">
            <Sparkles size={22} />
          </span>
          <div>
            <span className="eyebrow">YOUR MODELS. YOUR CONTENT.</span>
            <h2>让合适的 AI，写出你的内容。</h2>
            <p>接入服务，选好模型，再把它交给内容预设。</p>
          </div>
        </div>
        <Button kind="primary" onClick={() => setEditing(null)}>
          <Plus size={16} />
          添加 AI 连接
        </Button>
        <ol className="setup-steps">
          {[
            ["01", "接入服务", cs.some((c) => c.enabled)],
            ["02", "批准模型", !!readyModels.length],
            ["03", "设置默认", defaults.text.available],
          ].map(([n, label, complete]) => (
            <li key={String(n)} className={complete ? "complete" : ""}>
              {complete ? <CheckCircle2 size={17} /> : <span>{n}</span>}
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
      </section>
      <DefaultModels
        key={defaults.version + ":" + readyModels.map((m) => m.id).join()}
        settings={defaults}
        models={ms}
        connections={cs}
        onDone={settings.reload}
      />
      <div className="section-title">
        <div>
          <h2>
            服务连接 <span className="count-pill">{cs.length}</span>
          </h2>
          <p className="help-text">
            支持自有网关、OpenAI 和 Anthropic，按实际协议发送请求。
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus size={15} />
          添加连接
        </Button>
      </div>
      {cs.length ? (
        <div className="connection-grid ai-connections">
          {cs.map((c) => {
            const profile = catalog.data.providers.find(
                (p: any) => p.id === (c.provider || "custom"),
              ),
              protocol = catalog.data.protocols.find(
                (p: any) => p.id === c.protocol,
              ),
              probe = c.lastProbe;
            return (
              <article className="panel connection-card" key={c.id}>
                <div className="connection-title">
                  <div className="provider-avatar">
                    {profile?.short || "API"}
                  </div>
                  <div className="grow">
                    <h3>{c.name}</h3>
                    <span className="muted">
                      {profile?.name || "自定义网关"}
                    </span>
                  </div>
                  <Badge value={c.enabled ? "active" : "disabled"} />
                </div>
                <div className="endpoint-box">
                  <span className="mini-label">API 基础地址</span>
                  <span className="mono wrap">{c.baseUrl}</span>
                  <small>{protocol?.name || c.protocol}</small>
                </div>
                <div className="connection-meta">
                  <span>
                    <KeyRound size={13} />
                    {c.credentialMask}
                  </span>
                  <span>
                    并发 {c.concurrency} · {c.timeoutMs / 1000}s
                  </span>
                </div>
                <div
                  className={`probe-line ${probe?.state === "failed" ? "danger" : ""}`}
                >
                  {probe?.state === "completed" ? (
                    <>
                      <CheckCircle2 size={14} />
                      模型列表可读 · {probe.modelCount} 个 · {probe.latencyMs}ms
                    </>
                  ) : probe?.state === "failed" ? (
                    <>
                      <Circle size={13} />
                      检查失败 · {probe.error?.code}
                    </>
                  ) : (
                    <>
                      <Circle size={13} />
                      尚未检查模型列表
                    </>
                  )}
                  <small>
                    {probe?.checkedAt
                      ? date(probe.checkedAt)
                      : "生成能力待预览验证"}
                  </small>
                </div>
                <div className="button-row">
                  <Button onClick={() => setDiscover(c)}>
                    <Search size={14} />
                    检查并选模型
                  </Button>
                  <Button kind="text" onClick={() => setEditing(c)}>
                    <Settings2 size={15} />
                    配置
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          action={
            <Button kind="primary" onClick={() => setEditing(null)}>
              接入第一个 AI 服务
              <ArrowRight size={15} />
            </Button>
          }
        >
          连接你使用的 AI 服务，保留自己的地址、Key 和实际模型 ID。
        </Empty>
      )}
      <div className="section-title">
        <div>
          <h2>
            批准模型 <span className="count-pill">{ms.length}</span>
          </h2>
          <p className="help-text">
            只有批准且连接已启用的模型，才可用于新任务。
          </p>
        </div>
        <div className="button-row">
          <label className="compact-search">
            <Search size={15} />
            <input
              aria-label="搜索模型"
              placeholder="搜索模型或服务连接"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <Button disabled={!cs.length} onClick={() => setRegister({})}>
            <Plus size={15} />
            登记模型
          </Button>
        </div>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>模型 / 实际 ID</th>
              <th>用途</th>
              <th>服务连接</th>
              <th>使用状态</th>
              <th className="align-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {ms
              .filter((m) =>
                `${m.name} ${m.externalId} ${cs.find((c) => c.id === m.connectionId)?.name}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="model-name">
                      {m.type === "text" ? (
                        <Cpu size={17} />
                      ) : (
                        <Image size={17} />
                      )}
                      <div>
                        <strong>{m.name}</strong>
                        <small className="mono block muted">
                          {m.externalId}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {m.type === "text" ? "文字创作 / 校对" : "GPT Image 2"}
                  </td>
                  <td>
                    {cs.find((c) => c.id === m.connectionId)?.name ||
                      m.connectionId}
                  </td>
                  <td>
                    <Badge value={m.approved ? "active" : "disabled"}>
                      {m.approved ? "已批准" : "未批准"}
                    </Badge>
                    {[
                      defaults.defaultTextModelId,
                      defaults.defaultImageModelId,
                    ].includes(m.id) && (
                      <span className="default-pill">默认</span>
                    )}
                  </td>
                  <td className="align-right">
                    <AsyncButton
                      action={() =>
                        send(
                          `/models/${m.id}`,
                          { expectedVersion: m.version, approved: !m.approved },
                          "PATCH",
                        )
                      }
                      onDone={refresh}
                    >
                      {m.approved ? "撤销批准" : "批准使用"}
                    </AsyncButton>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!ms.length && (
          <Empty>从连接读取模型列表，或手动登记你有权限使用的模型。</Empty>
        )}
      </section>
      <p className="help-text">
        模型列表检查不产生生成任务。服务商报告的模型身份、实际请求与输出，可在任务详情中追溯。
      </p>
      {editing !== false && (
        <ConnectionDialog
          existing={editing}
          catalog={catalog.data}
          onClose={() => setEditing(false)}
          onDone={(c) => {
            setEditing(false);
            refresh();
            if (!editing) setDiscover(c);
          }}
        />
      )}
      {discover && (
        <DiscoveryDialog
          connection={discover}
          catalog={catalog.data}
          onClose={() => {
            setDiscover(null);
            connections.reload();
          }}
          onChange={connections.reload}
          onRegister={(id, type) => {
            setRegister({ connectionId: discover.id, externalId: id, type });
            setDiscover(null);
          }}
        />
      )}
      {register && (
        <ModelDialog
          initial={register}
          connections={cs}
          catalog={catalog.data}
          onClose={() => setRegister(null)}
          onDone={() => {
            setRegister(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function DefaultModels({
  settings,
  models,
  connections,
  onDone,
}: {
  settings: any;
  models: Item[];
  connections: Item[];
  onDone: () => void;
}) {
  const [text, setText] = useState(settings.defaultTextModelId),
    [image, setImage] = useState(settings.defaultImageModelId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<any>(null);
  const changed =
    text !== settings.defaultTextModelId ||
    image !== settings.defaultImageModelId;
  return (
    <section className="panel defaults-panel">
      <div className="panel-head">
        <div>
          <h2>默认 AI 模型</h2>
          <p>预设选择「跟随默认」后，在创建任务时固定当时的模型。</p>
        </div>
        <span className="subtle-tag">新任务生效</span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await send(
              "/ai/settings",
              {
                expectedVersion: settings.version,
                defaultTextModelId: text,
                defaultImageModelId: image,
              },
              "PATCH",
            );
            notify("默认 AI 模型已保存");
            onDone();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="default-grid">
          {[
            ["text", text, setText, "文字创作与校对", settings.text],
            ["image", image, setImage, "GPT Image 2 配图", settings.image],
          ].map(([type, value, change, title, status]: any) => (
            <div className="default-model" key={type}>
              <div className="default-icon">
                {type === "text" ? (
                  <TextCursorInput size={23} />
                ) : (
                  <Image size={23} />
                )}
              </div>
              <div className="grow">
                <Field label={`默认${type === "text" ? "文字" : "图片"}模型`}>
                  <select
                    value={value}
                    onChange={(e) => change(e.target.value)}
                  >
                    <option value="">暂不设置</option>
                    {modelOptions(models, connections, type, value)}
                  </select>
                </Field>
                <small className={status.available ? "muted" : "help-text"}>
                  {status.available
                    ? `${title} · ${status.externalId}`
                    : status.error?.message ||
                      `尚未配置可用的默认${type === "text" ? "文字" : "图片"}模型`}
                </small>
              </div>
            </div>
          ))}
        </div>
        {error && <ErrorBox error={error} />}
        <div className="defaults-footer">
          <span>固定模型的已有预设仍使用原选择。</span>
          <Button kind="primary" type="submit" disabled={busy || !changed}>
            {busy && <Loader2 size={15} className="spin" />}保存默认模型
          </Button>
        </div>
      </form>
    </section>
  );
}
export function modelOptions(
  models: Item[],
  connections: Item[],
  type: string,
  current = "",
) {
  const available = models.filter(
    (m) =>
      m.type === type &&
      m.approved &&
      connections.some((c) => c.id === m.connectionId && c.enabled),
  );
  return (
    <>
      {current &&
        current !== "@default" &&
        !available.some((m) => m.id === current) && (
          <option value={current} disabled>
            当前模型不可用 ·{" "}
            {models.find((m) => m.id === current)?.name || current}
          </option>
        )}
      {connections
        .filter((c) => c.enabled)
        .map((c) => (
          <optgroup key={c.id} label={c.name}>
            {available
              .filter((m) => m.connectionId === c.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.externalId}
                </option>
              ))}
          </optgroup>
        ))}
    </>
  );
}
export function ModelPicker({
  value,
  onChange,
  models,
  type = "text",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  models: Item[];
  type?: string;
  label: string;
}) {
  const { data: connections, error: connectionError } = useData<Item[]>(
      "/model-connections?limit=100",
    ),
    { data: defaults, error: defaultError } = useData("/ai/settings");
  if (connectionError || defaultError)
    return <ErrorBox error={connectionError || defaultError} />;
  if (!connections || !defaults) return <Loading />;
  const connectionId =
    value === "@default"
      ? "@default"
      : models.find((m) => m.id === value)?.connectionId || "";
  const currentDefault = defaults[type];
  return (
    <div className="model-picker wide">
      <div className="form-grid">
        <Field label={`${label}的服务连接`}>
          <select
            value={connectionId}
            onChange={(e) => {
              const id = e.target.value;
              onChange(
                id === "@default"
                  ? "@default"
                  : models.find(
                      (m) =>
                        m.type === type && m.approved && m.connectionId === id,
                    )?.id || "",
              );
            }}
          >
            <option value="">选择服务连接</option>
            <option value="@default">跟随系统默认模型</option>
            {connections.map((c) => (
              <option
                key={c.id}
                value={c.id}
                disabled={
                  !c.enabled ||
                  !models.some(
                    (m) =>
                      m.type === type && m.approved && m.connectionId === c.id,
                  )
                }
              >
                {c.name}
                {!c.enabled
                  ? " · 已停用"
                  : !models.some(
                        (m) =>
                          m.type === type &&
                          m.approved &&
                          m.connectionId === c.id,
                      )
                    ? " · 尚无批准模型"
                    : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={label}>
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={value === "@default"}
          >
            <option value="">选择批准模型</option>
            {value === "@default" ? (
              <option value="@default">
                {currentDefault.available
                  ? `${currentDefault.name} · ${currentDefault.externalId}`
                  : "默认模型尚未配置"}
              </option>
            ) : (
              modelOptions(
                models.filter(
                  (m) => !connectionId || m.connectionId === connectionId,
                ),
                connections,
                type,
                value,
              )
            )}
          </select>
        </Field>
      </div>
      <p className="help-text">
        {value === "@default"
          ? currentDefault.available
            ? `当前通过「${currentDefault.connectionName}」调用，创建任务时固定模型。`
            : "请先在系统设置中配置可用的默认模型。"
          : "此预设固定使用所选模型；实际请求和输出记录在任务详情。"}{" "}
        <a href="/settings?section=models">
          管理 AI 接入
          <ChevronRight size={12} />
        </a>
      </p>
    </div>
  );
}

function ConnectionDialog({
  existing,
  catalog,
  onClose,
  onDone,
}: {
  existing: Item | null;
  catalog: any;
  onClose: () => void;
  onDone: (v: Item) => void;
}) {
  const [form, setForm] = useState<any>({
      name: existing?.name || "",
      provider: existing?.provider || "custom",
      protocol: existing?.protocol || "openai_chat_images",
      baseUrl: existing?.baseUrl || "",
      apiKey: "",
      enabled: existing?.enabled ?? true,
      concurrency: existing?.concurrency || 2,
      timeoutMs: existing?.timeoutMs || 120000,
      allowPrivateNetwork: existing?.allowPrivateNetwork || false,
      assetHosts: (existing?.assetHosts || []).join(", "),
    }),
    [showKey, setShowKey] = useState(false),
    [rotate, setRotate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<any>(null);
  const patch = (key: string, value: any) =>
    setForm((p: any) => ({ ...p, [key]: value }));
  return (
    <Modal
      title={existing ? "配置 AI 连接" : "添加 AI 连接"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body = {
              ...form,
              assetHosts: form.assetHosts.split(/[,，\s]+/).filter(Boolean),
              expectedVersion: existing?.version,
            };
            delete body.apiKey;
            if (!existing || rotate) body.apiKey = form.apiKey;
            let r = await send(
              existing
                ? `/model-connections/${existing.id}`
                : "/model-connections",
              body,
              existing ? "PATCH" : "POST",
            );
            patch("apiKey", "");
            notify("AI 连接已保存");
            onDone(r.data);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="dialog-intro">
          选择接入方式。自有服务或代理请选择「自定义」，模型 ID
          按上游实际名称填写。
        </p>
        <div className="provider-choices" role="group" aria-label="AI 服务商">
          {catalog.providers.map((p: any) => (
            <button
              type="button"
              key={p.id}
              aria-label={p.name}
              aria-pressed={form.provider === p.id}
              className={`provider-choice ${form.provider === p.id ? "selected" : ""}`}
              onClick={() =>
                setForm((f: any) => ({
                  ...f,
                  provider: p.id,
                  protocol: p.protocol,
                  baseUrl: p.baseUrl,
                  name: f.name || p.name,
                }))
              }
            >
              <span className="provider-avatar">{p.short}</span>
              <strong>{p.name}</strong>
              {form.provider === p.id && <Check size={15} />}
            </button>
          ))}
        </div>
        <p className="help-text">
          {
            catalog.providers.find((p: any) => p.id === form.provider)
              ?.description
          }
        </p>
        <div className="form-grid">
          <Field label="连接名称">
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => patch("name", e.target.value)}
              placeholder="例如：我的 Luna 网关"
              autoComplete="off"
            />
          </Field>
          <Field label="请求协议">
            <select
              value={form.protocol}
              onChange={(e) => patch("protocol", e.target.value)}
            >
              {catalog.protocols.map((p: any) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="API 基础地址"
            hint="填写到 API 版本路径，例如 https://api.example.com/v1，系统自动补齐请求接口。"
            wide
          >
            <input
              type="url"
              required
              value={form.baseUrl}
              onChange={(e) => patch("baseUrl", e.target.value)}
              placeholder="https://your-gateway.example/v1"
              autoComplete="url"
            />
          </Field>
          {(!existing || rotate) && (
            <Field
              label={existing ? "新的 API Key" : "API Key"}
              hint="仅用于这个 AI 连接；保存后只显示末尾字符。"
              wide
            >
              <div className="password-field">
                <input
                  aria-label={existing ? "新的 API Key" : "API Key"}
                  type={showKey ? "text" : "password"}
                  required
                  minLength={12}
                  value={form.apiKey}
                  onChange={(e) => patch("apiKey", e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>
          )}
        </div>
        {existing && (
          <div className="credential-row">
            <KeyRound size={16} />
            <span className="mono">{existing.credentialMask}</span>
            <label className="check">
              <input
                type="checkbox"
                checked={rotate}
                onChange={(e) => {
                  setRotate(e.target.checked);
                  patch("apiKey", "");
                }}
              />
              替换 API Key
            </label>
          </div>
        )}
        <details className="advanced-settings">
          <summary>
            <Settings2 size={15} />
            高级接入设置
          </summary>
          <div className="form-grid">
            <Field label="连接并发上限">
              <input
                type="number"
                min={1}
                max={100}
                value={form.concurrency}
                onChange={(e) => patch("concurrency", +e.target.value)}
              />
            </Field>
            <Field label="请求超时（秒）">
              <input
                type="number"
                min={1}
                max={600}
                value={form.timeoutMs / 1000}
                onChange={(e) => patch("timeoutMs", +e.target.value * 1000)}
              />
            </Field>
            <Field
              label="图片下载域名"
              hint="上游返回图片 URL 时使用，多个域名用逗号分隔。"
              wide
            >
              <input
                value={form.assetHosts}
                onChange={(e) => patch("assetHosts", e.target.value)}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={form.allowPrivateNetwork}
                onChange={(e) => patch("allowPrivateNetwork", e.target.checked)}
              />
              允许访问自有内网服务
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => patch("enabled", e.target.checked)}
              />
              启用此连接
            </label>
          </div>
        </details>
        {error && <ErrorBox error={error} />}
        <div className="form-actions">
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button kind="primary" type="submit" disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <PlugZap size={15} />
            )}
            保存连接
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DiscoveryDialog({
  connection,
  catalog,
  onClose,
  onChange,
  onRegister,
}: {
  connection: Item;
  catalog: any;
  onClose: () => void;
  onChange: () => void;
  onRegister: (id: string, type: string) => void;
}) {
  const [probe, setProbe] = useState<any>(
      connection.lastProbe?.state === "completed" ? connection.lastProbe : null,
    ),
    [filter, setFilter] = useState("");
  const protocol = catalog.protocols.find(
    (p: any) => p.id === connection.protocol,
  );
  return (
    <Modal title="检查连接与选择模型" onClose={onClose} wide>
      <div className="discovery-heading">
        <div className="provider-avatar">
          <PlugZap size={20} />
        </div>
        <div>
          <h3>{connection.name}</h3>
          <p className="mono muted wrap">{connection.baseUrl}</p>
        </div>
      </div>
      <p>
        只读请求模型列表，不创建生成任务。列表不可读时，也可以手动登记模型。
      </p>
      <div className="button-row">
        <AsyncButton
          kind="primary"
          action={() =>
            send(`/model-connections/${connection.id}/probe`, {
              billable: false,
            })
          }
          onDone={(r) => {
            setProbe(r);
            onChange();
          }}
        >
          读取可用模型
        </AsyncButton>
        <Button onClick={() => onRegister("", "text")}>手动登记</Button>
      </div>
      {probe && (
        <>
          <div className="discovery-status">
            <CheckCircle2 size={18} />
            <div>
              <strong>模型列表可读 · {probe.modelCount} 个</strong>
              <small>
                {date(probe.checkedAt)} · 耗时 {probe.latencyMs}ms ·
                生成能力尚未验证{probe.partial ? " · 列表仅展示部分结果" : ""}
              </small>
            </div>
          </div>
          <label className="compact-search full">
            <Search size={16} />
            <input
              aria-label="筛选发现的模型"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="输入模型名称筛选"
            />
          </label>
          <div className="discovered-models">
            {probe.models
              .filter((m: any) =>
                `${m.id} ${m.name}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((m: any) => (
                <div key={m.id}>
                  <div>
                    <strong>{m.name}</strong>
                    <small className="mono muted">{m.id}</small>
                  </div>
                  <div className="button-row">
                    <Button onClick={() => onRegister(m.id, "text")}>
                      登记文字模型
                    </Button>
                    {protocol?.images && (
                      <Button
                        kind="text"
                        onClick={() => onRegister(m.id, "image")}
                      >
                        作为图片模型
                      </Button>
                    )}
                  </div>
                </div>
              ))}
          </div>
          {!probe.models.length && (
            <Empty>列表为空；可手动填写实际模型 ID。</Empty>
          )}
        </>
      )}
    </Modal>
  );
}
function ModelDialog({
  initial,
  connections,
  catalog,
  onClose,
  onDone,
}: {
  initial: any;
  connections: Item[];
  catalog: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<any>({
      connectionId: initial.connectionId || connections[0]?.id || "",
      externalId: initial.externalId || "",
      name: "",
      type: initial.type || "text",
      approved: true,
    }),
    [parameters, setParameters] = useState("{}"),
    [allowed, setAllowed] = useState(
      initial.type === "image"
        ? "size, quality, output_format, background"
        : "temperature, max_tokens, reasoning_effort",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<any>(null);
  const patch = (key: string, value: any) =>
    setForm((f: any) => ({ ...f, [key]: value }));
  const c = connections.find((c) => c.id === form.connectionId),
    supportsImages = catalog.protocols.find(
      (p: any) => p.id === c?.protocol,
    )?.images;
  return (
    <Modal title="登记实际模型" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await send("/models", {
              ...form,
              family: form.type === "image" ? "gpt-image-2" : "text",
              allowedParameters: allowed.split(/[,，\s]+/).filter(Boolean),
              defaultParameters: JSON.parse(parameters),
            });
            notify("模型已登记");
            onDone();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="服务连接" wide>
            <select
              required
              value={form.connectionId}
              onChange={(e) => patch("connectionId", e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模型用途">
            <select
              value={form.type}
              onChange={(e) => {
                patch("type", e.target.value);
                setAllowed(
                  e.target.value === "image"
                    ? "size, quality, output_format, background"
                    : "temperature, max_tokens, reasoning_effort",
                );
              }}
            >
              <option value="text">文字创作与校对</option>
              <option value="image" disabled={!supportsImages}>
                GPT Image 2 配图
              </option>
            </select>
          </Field>
          <Field label="显示名称">
            <input
              value={form.name}
              onChange={(e) => patch("name", e.target.value)}
              placeholder="不填则使用实际模型 ID"
            />
          </Field>
          <Field
            label="实际模型 ID"
            wide
            hint="保持服务端原始 ID，例如你网关的 gpt-6-luna；不会替换或映射为其他模型。"
          >
            <input
              required
              value={form.externalId}
              onChange={(e) => patch("externalId", e.target.value)}
              placeholder="填写已获准使用的模型 ID"
              list="discovered-options"
              autoComplete="off"
            />
          </Field>
          <datalist id="discovered-options">
            {c?.lastProbe?.models?.map((m: any) => (
              <option value={m.id} key={m.id} />
            ))}
          </datalist>
        </div>
        {form.type === "image" && (
          <p className="notice compact">
            此登记声明上游实际提供 GPT Image 2；其他图像模型不能用该用途发布。
          </p>
        )}
        <details className="advanced-settings">
          <summary>
            <Settings2 size={15} />
            模型参数
          </summary>
          <Field
            label="允许的参数名"
            hint="按服务商和协议填写；不支持的参数会阻塞任务，不会静默删除。"
          >
            <input
              value={allowed}
              onChange={(e) => setAllowed(e.target.value)}
            />
          </Field>
          <Field label="默认参数 JSON">
            <textarea
              rows={5}
              className="mono"
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
            />
          </Field>
        </details>
        <label className="check">
          <input
            type="checkbox"
            checked={form.approved}
            onChange={(e) => patch("approved", e.target.checked)}
          />
          批准此模型用于内容任务
        </label>
        {error && <ErrorBox error={error} />}
        <div className="form-actions">
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" kind="primary" disabled={busy}>
            {busy && <Loader2 size={15} className="spin" />}登记模型
          </Button>
        </div>
      </form>
    </Modal>
  );
}
