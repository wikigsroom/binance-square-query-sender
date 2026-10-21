import { useState } from "react";
import {
  Plus,
  Search,
  KeyRound,
  ArrowRight,
  Shuffle,
  Pause,
  Play,
  Send,
  Upload,
  Archive,
} from "lucide-react";
import { api, send, Item, date } from "../api";
import {
  useData,
  useDebouncedValue,
  PageHead,
  Button,
  Badge,
  ErrorBox,
  Loading,
  Empty,
  Modal,
  Field,
  AsyncButton,
  JsonPanel,
} from "../components";
import { JobDetail } from "./content";

export function AccountsPage({ refreshKey }: { refreshKey: any }) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [selected, select] = useState<string | null>(null),
    [create, setCreate] = useState(false),
    [importing, setImporting] = useState(false),
    [job, setJob] = useState<string | null>(null);
  const debouncedQ = useDebouncedValue(q);
  const { data, error, loading, reload } = useData<Item[]>(
    `/accounts?q=${encodeURIComponent(debouncedQ)}&status=${status}&limit=100`,
    refreshKey,
  );
  return (
    <>
      <PageHead
        eyebrow="ACCOUNTS & SCHEDULES"
        title="账号与计划"
        description="一个账号，一份独立规则。新账号默认暂停自动计划。"
        actions={
          <>
            <Button onClick={() => setImporting(true)}>
              <Upload size={15} />
              批量导入
            </Button>
            <Button kind="primary" onClick={() => setCreate(true)}>
              <Plus size={16} />
              添加账号
            </Button>
          </>
        }
      />
      <div className="toolbar">
        <label className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索账号"
            placeholder="搜索名称、UID、标签"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          aria-label="账号状态"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="active">可用</option>
          <option value="disabled">停用</option>
          <option value="archived">归档</option>
        </select>
        <span className="toolbar-meta">{data?.length || 0} 个账号</span>
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <section className="panel table-wrap">
          <table className="account-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>凭据</th>
                <th>计划与区间</th>
                <th>下一次执行</th>
                <th>最近确认发布</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((a, i) => (
                <tr key={a.id}>
                  <td>
                    <button
                      className="account-name"
                      onClick={() => select(a.id)}
                    >
                      <span className="avatar" data-color={i % 4}>
                        {a.name.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{a.name}</strong>
                        <small>{a.tags.join(" / ") || a.uid || "未分组"}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="mono key-mask">{a.credentialMask}</span>
                    <Badge value={a.credentialHealth} />
                  </td>
                  <td>
                    <span
                      className={`status-text ${a.schedule.enabled ? "live" : "paused"}`}
                    >
                      <i />
                      {a.schedule.enabled ? "已启用" : "已暂停"}
                    </span>
                    <small className="block muted">
                      {a.schedule.minIntervalSeconds / 60}—
                      {a.schedule.maxIntervalSeconds / 60} 分钟
                    </small>
                  </td>
                  <td>
                    <span className="mono">{date(a.schedule.nextDueAt)}</span>
                    {a.blockReason && (
                      <small className="block danger">{a.blockReason}</small>
                    )}
                  </td>
                  <td>{date(a.lastPublishedAt)}</td>
                  <td>
                    <Button kind="text" onClick={() => select(a.id)}>
                      管理 <ArrowRight size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <Empty
          action={
            <Button kind="primary" onClick={() => setCreate(true)}>
              添加第一个账号
            </Button>
          }
        >
          还没有账号。录入凭据不会自动启动发布。
        </Empty>
      )}
      {create && (
        <AccountCreate
          onClose={() => setCreate(false)}
          onDone={() => {
            setCreate(false);
            reload();
          }}
        />
      )}
      {importing && (
        <ImportAccounts onClose={() => setImporting(false)} onDone={reload} />
      )}
      {selected && (
        <AccountDetail
          accountId={selected}
          onClose={() => {
            select(null);
            reload();
          }}
          onJob={(j) => {
            select(null);
            setJob(j);
          }}
        />
      )}
      {job && <JobDetail jobId={job} onClose={() => setJob(null)} />}
    </>
  );
}
function AccountCreate({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(""),
    [uid, setUid] = useState(""),
    [tags, setTags] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [error, setError] = useState<any>(null),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="添加广场账号" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void send("/accounts", {
            name,
            uid,
            tags: tags
              .split(/[,，]/)
              .map((s: string) => s.trim())
              .filter(Boolean),
            apiKey,
          })
            .then(() => {
              setApiKey("");
              onDone();
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <div className="form-grid">
          <Field label="账号名称">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <Field label="平台 UID（可选）">
            <input value={uid} onChange={(e) => setUid(e.target.value)} />
          </Field>
          <Field label="标签，逗号分隔" wide>
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field
            label="Square API Key"
            hint="保存后仅展示掩码。账号和自动计划分别控制。"
            wide
          >
            <input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              minLength={12}
            />
          </Field>
        </div>
        {error && <ErrorBox error={error} />}
        <div className="form-actions">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" kind="primary" disabled={busy}>
            保存账号
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ImportAccounts({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(""),
    [result, setResult] = useState<any[] | null>(null);
  const lines = text
    .split(/\r\n?|\n/)
    .map((apiKey, index) => ({ apiKey: apiKey.trim(), line: index + 1 }))
    .filter((item) => item.apiKey);
  return (
    <Modal title="批量导入账号" onClose={onClose}>
      <p className="help-text">
        每行粘贴一个 API Key
        即可，账号名称会自动生成。空行自动忽略，导入后自动计划默认暂停。
      </p>
      <Field label="API Key 列表" hint="每行一个，单次最多1000个">
        <textarea
          rows={10}
          value={text}
          placeholder={"在此粘贴 API Key，每行一个"}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
      <p className="help-text" role="status">
        待导入 {lines.length} 个 API Key
        {lines.length > 1000 ? "，请拆分为每批最多1000个" : ""}
      </p>
      <AsyncButton
        kind="primary"
        disabled={!lines.length || lines.length > 1000}
        action={async () => {
          const accounts = lines.map(({ apiKey }) => ({ apiKey }));
          const r = await send("/accounts/import", { accounts });
          setText("");
          return {
            ...r,
            data: r.data.map((item: any) => ({
              ...item,
              line: lines[item.line - 1]?.line ?? item.line,
            })),
          };
        }}
        onDone={(r) => {
          setResult(r);
          onDone();
        }}
      >
        开始导入
      </AsyncButton>
      {result && (
        <section aria-label="导入结果">
          <h3>导入结果</h3>
          <p role="status">
            成功导入 {result.filter((r) => r.status === "created").length} 个，
            重复{" "}
            {result.filter((r) => r.code === "DUPLICATE_CREDENTIAL").length}{" "}
            个， 失败{" "}
            {
              result.filter(
                (r) =>
                  r.status === "rejected" && r.code !== "DUPLICATE_CREDENTIAL",
              ).length
            }{" "}
            个。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th>结果</th>
                  <th>账号或说明</th>
                </tr>
              </thead>
              <tbody>
                {result.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>
                      {r.status === "created"
                        ? "已导入"
                        : r.code === "DUPLICATE_CREDENTIAL"
                          ? "重复"
                          : "失败"}
                    </td>
                    <td>{r.status === "created" ? r.name : r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Modal>
  );
}
function AccountDetail({
  accountId,
  onClose,
  onJob,
}: {
  accountId: string;
  onClose: () => void;
  onJob: (id: string) => void;
}) {
  const { data: a, error, reload } = useData(`/accounts/${accountId}`),
    { data: presets } = useData<Item[]>("/presets?limit=100"),
    [tab, setTab] = useState("schedule"),
    [editingKey, setEditingKey] = useState(false),
    [credentialProbe, setCredentialProbe] = useState<any>(null);
  if (error)
    return (
      <Modal title="账号" onClose={onClose}>
        <ErrorBox error={error} />
      </Modal>
    );
  if (!a)
    return (
      <Modal title="读取账号" onClose={onClose}>
        <Loading />
      </Modal>
    );
  return (
    <Modal title={a.name} onClose={onClose} wide>
      <div className="detail-top">
        <div>
          <Badge value={a.status} /> <Badge value={a.credentialHealth} />
          <p className="mono muted">{a.id}</p>
        </div>
        <span className="mono key-mask">
          <KeyRound size={14} />
          {a.credentialMask} · v{a.credentialVersion}
        </span>
      </div>
      {a.blockReason && (
        <ErrorBox
          error={{ message: "此账号的发布被阻塞。", code: a.blockReason }}
        />
      )}
      <div className="tabs" role="tablist">
        {[
          ["schedule", "独立计划"],
          ["bindings", "预设权重"],
          ["profile", "账号与凭据"],
          ["history", "最近任务"],
        ].map(([id, text]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "schedule" && (
        <ScheduleEditor
          key={a.schedule.version}
          account={a}
          onSave={reload}
          onJob={onJob}
        />
      )}
      {tab === "bindings" && (
        <BindingEditor
          key={a.bindings.bindingVersion}
          account={a}
          presets={presets || []}
          onSave={reload}
        />
      )}
      {tab === "profile" && (
        <>
          <ProfileEditor account={a} onSave={reload} />
          {credentialProbe && (
            <div className="notice compact" role="status">
              {credentialProbe.reason}
            </div>
          )}
          <div className="divider" />
          <div className="button-row">
            <Button onClick={() => setEditingKey(true)}>
              <KeyRound size={15} />
              轮换 API Key
            </Button>
            <AsyncButton
              action={() => send(`/accounts/${a.id}/credentials/verify`)}
              onDone={setCredentialProbe}
            >
              只读验证能力
            </AsyncButton>
            <AsyncButton
              action={() =>
                send(`/accounts/${a.id}/archive`, {
                  expectedVersion: a.version,
                })
              }
              onDone={onClose}
            >
              <Archive size={15} />
              归档账号
            </AsyncButton>
          </div>
        </>
      )}
      {tab === "history" &&
        (a.recentJobs.length ? (
          a.recentJobs.map((j: Item) => (
            <button
              className="task-line"
              key={j.id}
              onClick={() => onJob(j.id)}
            >
              <span className="mono">{j.id.slice(0, 20)}</span>
              <Badge value={j.state} />
              <span>{date(j.createdAt)}</span>
            </button>
          ))
        ) : (
          <Empty>没有最近任务。</Empty>
        ))}
      {editingKey && (
        <RotateKey
          account={a}
          onClose={() => setEditingKey(false)}
          onDone={() => {
            setEditingKey(false);
            reload();
          }}
        />
      )}
    </Modal>
  );
}
function ScheduleEditor({
  account,
  onSave,
  onJob,
}: {
  account: any;
  onSave: () => void;
  onJob: (id: string) => void;
}) {
  const s = account.schedule,
    [min, setMin] = useState(s.minIntervalSeconds),
    [max, setMax] = useState(s.maxIntervalSeconds),
    [enabled, setEnabled] = useState(s.enabled);
  return (
    <>
      <div className="form-grid">
        <Field label="最小间隔（秒）">
          <input
            type="number"
            min={1}
            step={1}
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
          />
        </Field>
        <Field label="最大间隔（秒）">
          <input
            type="number"
            min={min}
            step={1}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </Field>
        <Field label="自动计划">
          <select
            value={String(enabled)}
            onChange={(e) => setEnabled(e.target.value === "true")}
          >
            <option value="false">暂停</option>
            <option value="true">启用</option>
          </select>
        </Field>
        <Field label="下次已抽中时间">
          <output className="output mono">{date(s.nextDueAt)}</output>
        </Field>
      </div>
      <dl className="info-list inline">
        <div>
          <dt>抽样起点</dt>
          <dd>{date(s.anchorAt)}</dd>
        </div>
        <div>
          <dt>本次等待</dt>
          <dd>{s.sampledDelaySeconds ? `${s.sampledDelaySeconds} 秒` : "—"}</dd>
        </div>
      </dl>
      <p className="help-text">
        保存区间默认在下一次抽样生效。本次已抽中的到期时间保留；立即重排是独立操作。
      </p>
      <div className="button-row">
        <AsyncButton
          kind="primary"
          action={() =>
            send(
              `/accounts/${account.id}/schedule`,
              {
                expectedVersion: s.version,
                minIntervalSeconds: min,
                maxIntervalSeconds: max,
                enabled,
              },
              "PUT",
            )
          }
          onDone={onSave}
        >
          保存规则
        </AsyncButton>
        <AsyncButton
          action={() =>
            send(
              `/accounts/${account.id}/schedule/${s.enabled ? "pause" : "resume"}`,
              { expectedVersion: s.version },
            )
          }
          onDone={onSave}
        >
          {s.enabled ? <Pause size={14} /> : <Play size={14} />}{" "}
          {s.enabled ? "暂停计划" : "恢复计划"}
        </AsyncButton>
        <AsyncButton
          action={() =>
            send(`/accounts/${account.id}/schedule/resample`, {
              expectedVersion: s.version,
            })
          }
          onDone={onSave}
        >
          <Shuffle size={14} />
          立即重排
        </AsyncButton>
        <AsyncButton
          disabled={account.status !== "active" || !!account.blockReason}
          action={() => send(`/accounts/${account.id}/publications`, {})}
          onDone={(r) => onJob(r.id)}
        >
          <Send size={14} />
          按权重执行一次
        </AsyncButton>
      </div>
      <p className="help-text">
        暂停自动计划时仍可手动执行；全局暂停或停用账号会拦截提交。手动一次不会开启已暂停的计划。
      </p>
    </>
  );
}
function BindingEditor({
  account,
  presets,
  onSave,
}: {
  account: any;
  presets: Item[];
  onSave: () => void;
}) {
  const [bindings, setBindings] = useState<any[]>(
      account.bindings.bindings.map((b: any) => ({
        presetId: b.presetId,
        weight: b.weight,
        enabled: b.enabled,
      })),
    ),
    sum = bindings.filter((b) => b.enabled).reduce((n, b) => n + b.weight, 0);
  const update = (i: number, changes: any) =>
    setBindings((b) => b.map((v, j) => (i === j ? { ...v, ...changes } : v)));
  return (
    <>
      <p className="help-text">
        新任务跟随预设最新已发布版本，创建后冻结。权重为 0 的绑定不参与。
      </p>
      {bindings.map((b, i) => (
        <div className="binding-row" key={i}>
          <input
            aria-label={`启用绑定${i + 1}`}
            type="checkbox"
            checked={b.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
          />
          <select
            aria-label={`预设${i + 1}`}
            value={b.presetId}
            onChange={(e) => update(i, { presetId: e.target.value })}
          >
            {presets.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
                {!p.publishedVersionId ? " · 未发布" : ""}
              </option>
            ))}
          </select>
          <input
            aria-label={`权重${i + 1}`}
            type="number"
            min={0}
            step="any"
            value={b.weight}
            onChange={(e) => update(i, { weight: Number(e.target.value) })}
          />
          <span className="mono">
            {b.enabled && sum > 0 ? ((b.weight / sum) * 100).toFixed(1) : "0"}%
          </span>
          <Button
            kind="text"
            onClick={() => setBindings((x) => x.filter((_, j) => j !== i))}
          >
            移除
          </Button>
        </div>
      ))}
      <div className="button-row">
        <Button
          disabled={!presets.length}
          onClick={() =>
            setBindings((b) => [
              ...b,
              {
                presetId:
                  presets.find((p) => !b.some((v) => v.presetId === p.id))
                    ?.id || presets[0]?.id,
                weight: 1,
                enabled: true,
              },
            ])
          }
        >
          <Plus size={14} />
          添加预设
        </Button>
        <AsyncButton
          kind="primary"
          action={() =>
            send(
              `/accounts/${account.id}/preset-bindings`,
              { expectedVersion: account.bindings.bindingVersion, bindings },
              "PUT",
            )
          }
          onDone={onSave}
        >
          保存绑定
        </AsyncButton>
      </div>
      <JsonPanel
        title="服务端有效概率与排除原因"
        value={account.bindings.bindings}
      />
    </>
  );
}
function ProfileEditor({
  account: a,
  onSave,
}: {
  account: any;
  onSave: () => void;
}) {
  const [name, setName] = useState(a.name),
    [uid, setUid] = useState(a.uid),
    [notes, setNotes] = useState(a.notes),
    [tags, setTags] = useState(a.tags.join(", ")),
    [status, setStatus] = useState(a.status);
  return (
    <>
      <div className="form-grid">
        <Field label="名称">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="UID">
          <input value={uid} onChange={(e) => setUid(e.target.value)} />
        </Field>
        <Field label="标签">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="账号状态">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">可用</option>
            <option value="disabled">停用</option>
            {a.status === "archived" && (
              <option value="archived">已归档</option>
            )}
          </select>
        </Field>
        <Field label="备注" wide>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <AsyncButton
        kind="primary"
        action={() =>
          send(
            `/accounts/${a.id}`,
            {
              expectedVersion: a.version,
              name,
              uid,
              notes,
              tags: tags.split(/[,，]/).filter((s: string) => s.trim()),
              status,
            },
            "PATCH",
          )
        }
        onDone={onSave}
      >
        保存账号
      </AsyncButton>
    </>
  );
}
function RotateKey({
  account,
  onClose,
  onDone,
}: {
  account: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [key, setKey] = useState("");
  return (
    <Modal title="轮换凭据" onClose={onClose}>
      <Field
        label="新的 API Key"
        hint="保留账号 ID、历史和绑定。旧执行任务会重新检查控制版本。"
      >
        <input
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <AsyncButton
        kind="primary"
        action={() =>
          send(`/accounts/${account.id}/credentials/rotate`, { apiKey: key })
        }
        onDone={() => {
          setKey("");
          onDone();
        }}
      >
        保存新凭据
      </AsyncButton>
    </Modal>
  );
}
