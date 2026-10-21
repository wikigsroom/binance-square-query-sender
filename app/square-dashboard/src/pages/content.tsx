import { ModelPicker } from "./ai-settings";
import { useState } from "react";
import {
  Plus,
  Upload,
  Search,
  ArrowUpRight,
  ImagePlus,
  Filter,
  ExternalLink,
  RefreshCw,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api, apiUrl, send, Item, date, json } from "../api";
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
  Timeline,
  label,
} from "../components";

export function MediaPage() {
  const [q, setQ] = useState(""),
    [source, setSource] = useState(""),
    [create, setCreate] = useState(false),
    [asset, setAsset] = useState<string | null>(null),
    [tab, setTab] = useState("library"),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState<any>(null),
    [imageJob, setImageJob] = useState<string | null>(null);
  const debouncedQ = useDebouncedValue(q);
  const {
      data,
      reload,
      error: loadError,
    } = useData<Item[]>(
      `/assets?limit=100&q=${encodeURIComponent(debouncedQ)}&source=${source}`,
    ),
    { data: jobs, reload: reloadJobs } = useData<Item[]>(
      "/image-jobs?limit=100",
    );
  return (
    <>
      <PageHead
        eyebrow="MEDIA LIBRARY"
        title="图库与生图"
        description="发送时只引用已入库图片。电脑里的图片需先上传到服务器图库。"
        actions={
          <>
            <label className="button">
              <Upload size={15} />
              {uploading ? "上传中…" : "上传已有图片"}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.append("file", file);
                  setUploading(true);
                  setError(null);
                  void api("/assets/upload", { method: "POST", body: form })
                    .then(reload)
                    .catch(setError)
                    .finally(() => {
                      setUploading(false);
                      e.target.value = "";
                    });
                }}
              />
            </label>
            <Button kind="primary" onClick={() => setCreate(true)}>
              <ImagePlus size={16} />
              新建生图任务
            </Button>
          </>
        }
      />
      <div className="tabs">
        <button
          aria-selected={tab === "library"}
          onClick={() => setTab("library")}
        >
          已有图库
        </button>
        <button aria-selected={tab === "jobs"} onClick={() => setTab("jobs")}>
          GPT Image 2 任务 <span>{jobs?.length || 0}</span>
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      <div className="toolbar">
        <label className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索图片"
            placeholder="搜索图片名称或标签"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          aria-label="图片来源"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">全部来源</option>
          <option value="library">已有图库</option>
          <option value="gpt_image_2">GPT Image 2</option>
        </select>
        <span className="toolbar-meta">{data?.length || 0} 张图片</span>
      </div>
      {loadError ? (
        <ErrorBox error={loadError} />
      ) : tab === "library" ? (
        !data ? (
          <Loading />
        ) : data.length ? (
          <div className="media-grid">
            {data.map((a) => (
              <button
                key={a.id}
                className={`media-card ${!a.enabled ? "disabled" : ""}`}
                onClick={() => setAsset(a.id)}
              >
                <div className="media-thumb">
                  <img
                    src={apiUrl(`/assets/${a.id}/content`)}
                    alt={a.name}
                    loading="lazy"
                  />
                  <span className="media-ratio mono">
                    {a.width} × {a.height}
                  </span>
                </div>
                <div className="media-caption">
                  <strong>{a.name}</strong>
                  <div>
                    <Badge value={a.provenance.type} />
                    <span className="muted">{a.collection || "未分类"}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty>上传已有图片，或创建批准的 GPT Image 2 任务。</Empty>
        )
      ) : jobs?.length ? (
        <section className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>提示词</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>产物 / 错误</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <button
                      className="link truncate"
                      onClick={() => setImageJob(j.id)}
                    >
                      {j.prompt.slice(0, 60)}
                    </button>
                  </td>
                  <td>
                    <Badge value={j.state} />
                  </td>
                  <td>{date(j.createdAt)}</td>
                  <td>{j.error?.message || j.assetId?.slice(0, 18) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <Empty>尚无生图任务。生成中或结果不明的任务不会伪装成可发图片。</Empty>
      )}
      {create && (
        <ImageCreate
          onClose={() => setCreate(false)}
          onDone={() => {
            setCreate(false);
            setTab("jobs");
            reloadJobs();
          }}
        />
      )}
      {asset && (
        <AssetDetail
          assetId={asset}
          onClose={() => {
            setAsset(null);
            reload();
          }}
        />
      )}
      {imageJob && (
        <Modal title="生图任务记录" onClose={() => setImageJob(null)} wide>
          <ImageJobDetail id={imageJob} />
        </Modal>
      )}
    </>
  );
}
function AssetDetail({
  assetId,
  onClose,
}: {
  assetId: string;
  onClose: () => void;
}) {
  const { data: a, error, reload } = useData(`/assets/${assetId}`);
  if (error)
    return (
      <Modal title="图片" onClose={onClose}>
        <ErrorBox error={error} />
      </Modal>
    );
  return (
    <Modal title={a?.name || "图片详情"} onClose={onClose} wide>
      {!a ? (
        <Loading />
      ) : (
        <div className="asset-detail">
          <img src={apiUrl(`/assets/${a.id}/content`)} alt={a.name} />
          <AssetForm key={a.version} asset={a} onSave={reload} />
        </div>
      )}
    </Modal>
  );
}
function AssetForm({ asset: a, onSave }: { asset: Item; onSave: () => void }) {
  const [name, setName] = useState(a.name),
    [collection, setCollection] = useState(a.collection),
    [tags, setTags] = useState(a.tags.join(", ")),
    [style, setStyle] = useState(a.style),
    [enabled, setEnabled] = useState(a.enabled);
  return (
    <div>
      <Badge value={a.provenance.type} />
      <div className="form-grid">
        <Field label="名称" wide>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="集合">
          <input
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          />
        </Field>
        <Field label="风格">
          <input value={style} onChange={(e) => setStyle(e.target.value)} />
        </Field>
        <Field label="标签" wide>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <label className="check-field">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          允许新任务使用
        </label>
      </div>
      <AsyncButton
        kind="primary"
        action={() =>
          send(
            `/assets/${a.id}`,
            {
              expectedVersion: a.version,
              name,
              collection,
              tags: tags
                .split(/[,，]/)
                .map((s: string) => s.trim())
                .filter(Boolean),
              style,
              enabled,
            },
            "PATCH",
          )
        }
        onDone={onSave}
      >
        保存图片信息
      </AsyncButton>
      <dl className="info-list">
        <div>
          <dt>尺寸与格式</dt>
          <dd>
            {a.width}×{a.height} · {a.format}
          </dd>
        </div>
        <div>
          <dt>最近使用</dt>
          <dd>{date(a.lastUsedAt)}</dd>
        </div>
      </dl>
      <JsonPanel
        title="来源与文件摘要"
        value={{ sha256: a.sha256, provenance: a.provenance, usedBy: a.usedBy }}
      />
    </div>
  );
}
function ImageCreate({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: models } = useData<Item[]>("/models?limit=100"),
    [modelId, setModel] = useState("@default"),
    [prompt, setPrompt] = useState(""),
    [size, setSize] = useState("");
  return (
    <Modal title="新建 GPT Image 2 任务" onClose={onClose}>
      <ModelPicker
        label="批准的图片模型"
        value={modelId}
        onChange={setModel}
        models={models || []}
        type="image"
      />
      <Field label="生图要求">
        <textarea
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>
      <Field label="尺寸（仅填写连接已允许的参数）">
        <input
          placeholder="例如 1024x1024，留空使用服务默认"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
      </Field>
      <p className="help-text">
        会请求选中模型。返回的图片先校验并入库，不会直接发布。
      </p>
      <AsyncButton
        kind="primary"
        disabled={!modelId || !prompt.trim()}
        action={() =>
          send("/image-jobs", {
            modelId,
            prompt,
            parameters: size ? { size } : {},
          })
        }
        onDone={onDone}
      >
        创建生图任务
      </AsyncButton>
    </Modal>
  );
}
function ImageJobDetail({ id }: { id: string }) {
  const { data, error } = useData(`/image-jobs/${id}`);
  return error ? (
    <ErrorBox error={error} />
  ) : !data ? (
    <Loading />
  ) : (
    <>
      <Badge value={data.state} />
      {data.error && <ErrorBox error={data.error} />}
      <JsonPanel title="完整生图记录" value={data} open />
      {data.assetId && (
        <img
          className="preview-image"
          src={apiUrl(`/assets/${data.assetId}/content`)}
          alt="生成产物"
        />
      )}
    </>
  );
}

export function PostsPage() {
  const initial = Object.fromEntries(new URLSearchParams(location.search)),
    [filters, setFilters] = useState<Record<string, string>>(initial),
    [advanced, setAdvanced] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [cursors, setCursors] = useState<string[]>([]);
  const debouncedFilters = useDebouncedValue(filters);
  const query = new URLSearchParams({
      ...debouncedFilters,
      limit: "20",
    }).toString(),
    { data, meta, error, loading } = useData<Item[]>(`/posts?${query}`),
    { data: accounts } = useData<Item[]>("/accounts?limit=100"),
    { data: presets } = useData<Item[]>("/presets?limit=100"),
    { data: models } = useData<Item[]>("/models?limit=100");
  const change = (k: string, v: string) => {
    setCursors([]);
    setFilters((f) => {
      const n = { ...f, [k]: v, cursor: "" };
      history.replaceState({}, "", `/posts?${new URLSearchParams(n)}`);
      return n;
    });
  };
  return (
    <>
      <PageHead
        eyebrow="POST ARCHIVE"
        title="帖子中心"
        description="搜索系统创建的内容，追溯到模型、事实来源、配图与发布回执。"
      />
      <div className="toolbar">
        <label className="search-input grow">
          <Search size={17} />
          <input
            aria-label="搜索正文"
            placeholder="搜索中文正文、观点或关键词"
            value={filters.q || ""}
            onChange={(e) => change("q", e.target.value)}
          />
        </label>
        <select
          aria-label="筛选账号"
          value={filters.accountIds || ""}
          onChange={(e) => change("accountIds", e.target.value)}
        >
          <option value="">全部账号</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button onClick={() => setAdvanced(!advanced)}>
          <Filter size={15} />
          更多条件
        </Button>
      </div>
      {advanced && (
        <div className="filter-panel form-grid">
          <Field label="代币标签（多个用逗号）">
            <input
              value={filters.tokens || ""}
              onChange={(e) => change("tokens", e.target.value)}
            />
          </Field>
          <Field label="预设">
            <select
              value={filters.presetId || ""}
              onChange={(e) => change("presetId", e.target.value)}
            >
              <option value="">全部预设</option>
              {presets?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="文字模型">
            <select
              value={filters.modelId || ""}
              onChange={(e) => change("modelId", e.target.value)}
            >
              <option value="">全部模型</option>
              {models?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="发布状态">
            <select
              value={filters.publishStatus || ""}
              onChange={(e) => change("publishStatus", e.target.value)}
            >
              <option value="">全部状态</option>
              {[
                "published",
                "submission_unknown",
                "failed",
                "blocked",
                "preview_ready",
              ].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="核验状态">
            <select
              value={filters.verificationStatus || ""}
              onChange={(e) => change("verificationStatus", e.target.value)}
            >
              <option value="">全部核验状态</option>
              {[
                "verified",
                "pending",
                "mismatch",
                "unavailable",
                "not_started",
              ].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="时间字段">
            <select
              value={filters.dateField || "createdAt"}
              onChange={(e) => change("dateField", e.target.value)}
            >
              <option value="createdAt">创建时间</option>
              <option value="publishedAt">确认发布时间</option>
            </select>
          </Field>
          <Field label="起始时间">
            <input
              type="datetime-local"
              value={localInput(filters.from)}
              onChange={(e) =>
                change(
                  "from",
                  e.target.value ? new Date(e.target.value).toISOString() : "",
                )
              }
            />
          </Field>
          <Field label="截止时间">
            <input
              type="datetime-local"
              value={localInput(filters.to)}
              onChange={(e) =>
                change(
                  "to",
                  e.target.value ? new Date(e.target.value).toISOString() : "",
                )
              }
            />
          </Field>
          <Field label="预设版本 ID">
            <input
              value={filters.presetVersionId || ""}
              onChange={(e) => change("presetVersionId", e.target.value)}
            />
          </Field>
          <Field label="来源快照 ID">
            <input
              value={filters.sourceId || ""}
              onChange={(e) => change("sourceId", e.target.value)}
            />
          </Field>
          <Field label="远端帖子 ID 或已存链接">
            <input
              value={filters.remotePostId || ""}
              onChange={(e) => change("remotePostId", e.target.value)}
            />
          </Field>
          <Field label="账号标签">
            <input
              value={filters.accountTags || ""}
              onChange={(e) => change("accountTags", e.target.value)}
            />
          </Field>
          <Button
            onClick={() => {
              setFilters({});
              history.replaceState({}, "", "/posts");
            }}
          >
            清空筛选
          </Button>
        </div>
      )}
      {error ? (
        <ErrorBox error={error} />
      ) : loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <div className="post-list">
          {data.map((p) => (
            <article className="panel post-row" key={p.id}>
              <div className="post-row-main">
                <div className="post-meta">
                  <strong>{p.accountName}</strong>
                  <time>{date(p.createdAt)}</time>
                  <Badge value={p.publishStatus} />
                  <Badge value={p.verificationStatus} />
                </div>
                <button className="post-text" onClick={() => setSelected(p.id)}>
                  {p.text}
                </button>
                <div className="post-bottom">
                  <span className="mono">
                    {(p.tokens || []).map((t: string) => `$${t}`).join(" ")}
                  </span>
                  <Button kind="text" onClick={() => setSelected(p.id)}>
                    查看来源与回执 <ArrowRightIcon />
                  </Button>
                </div>
              </div>
              {p.assetId && (
                <img
                  src={apiUrl(`/assets/${p.assetId}/content`)}
                  alt="帖子配图"
                  loading="lazy"
                />
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty>
          当前条件没有匹配内容。早于文字产出的失败记录请在任务中心查看。
        </Empty>
      )}
      <div className="pagination">
        <Button
          disabled={!filters.cursor}
          onClick={() => {
            const prev = [...cursors],
              cursor = prev.pop() || "";
            setCursors(prev);
            setFilters((f) => ({ ...f, cursor }));
          }}
        >
          <ChevronLeft size={14} />
          上一页
        </Button>
        <Button
          disabled={!meta.hasMore}
          onClick={() => {
            setCursors((c) => [...c, filters.cursor || ""]);
            setFilters((f) => ({ ...f, cursor: meta.nextCursor }));
          }}
        >
          下一页
          <ChevronRight size={14} />
        </Button>
      </div>
      {selected && (
        <PostDetail postId={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
function localInput(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function ArrowRightIcon() {
  return <ArrowUpRight size={14} />;
}
function PostDetail({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const { data: p, error, reload } = useData(`/posts/${postId}`),
    [job, setJob] = useState<string | null>(null);
  return (
    <Modal title="内容与发布记录" onClose={onClose} wide>
      {error ? (
        <ErrorBox error={error} />
      ) : !p ? (
        <Loading />
      ) : (
        <>
          <div className="post-detail-grid">
            <div>
              <div className="post-meta">
                <strong>{p.account?.name || "预览"}</strong>
                <Badge value={p.publishStatus} />
                <Badge value={p.verificationStatus} />
              </div>
              <div className="article-preview">{p.content.text}</div>
              {p.assetId && (
                <img
                  className="preview-image"
                  src={apiUrl(`/assets/${p.assetId}/content`)}
                  alt="帖子配图"
                />
              )}
            </div>
            <div>
              <dl className="info-list">
                <div>
                  <dt>字符数</dt>
                  <dd>{p.content.characterCount}</dd>
                </div>
                <div>
                  <dt>模型</dt>
                  <dd className="mono">{p.content.modelId}</dd>
                </div>
                <div>
                  <dt>预设版本</dt>
                  <dd className="mono">{p.content.presetVersionId}</dd>
                </div>
                <div>
                  <dt>确认发布时间</dt>
                  <dd>{date(p.publishedAt)}</dd>
                </div>
                <div>
                  <dt>远端 ID</dt>
                  <dd className="mono">{p.remoteId || "—"}</dd>
                </div>
              </dl>
              <div className="button-row">
                {p.url && (
                  <a
                    className="button"
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    公开帖子
                    <ExternalLink size={14} />
                  </a>
                )}
                <Button onClick={() => setJob(p.jobId)}>
                  任务与完整提示词
                </Button>
                {p.remoteId && (
                  <AsyncButton
                    action={() => send(`/posts/${p.id}/verify`, {})}
                    onDone={reload}
                  >
                    <RefreshCw size={14} />
                    重新核验
                  </AsyncButton>
                )}
              </div>
              <h3>引用与读取记录</h3>
              {p.sources?.length ? (
                p.sources.map((s: Item) => (
                  <div className="source-card" key={s.id}>
                    <strong>{s.title || s.name}</strong>
                    <span>{date(s.publishedAt || s.fetchedAt)}</span>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        读取原文 <ExternalLink size={12} />
                      </a>
                    )}
                    <JsonPanel title="来源事实" value={s} />
                  </div>
                ))
              ) : (
                <p className="muted">没有引用外部新闻。</p>
              )}
              <JsonPanel title="远端回执" value={p.attempts} />
              <JsonPanel title="独立核验结果" value={p.verifications} />
              <JsonPanel title="AI 成稿摘要" value={p.content} />
            </div>
          </div>
          {job && <JobDetail jobId={job} onClose={() => setJob(null)} />}
        </>
      )}
    </Modal>
  );
}

export function JobsPage() {
  const [state, setState] = useState(""),
    [selected, setSelected] = useState<string | null>(
      new URLSearchParams(location.search).get("job"),
    ),
    { data, error, reload } = useData<Item[]>(
      `/publication-jobs?limit=100&state=${state}`,
    ),
    { data: health } = useData("/health");
  return (
    <>
      <PageHead
        eyebrow="EXECUTION LOG"
        title="任务与日志"
        description="按阶段定位失败。只对确认未提交的安全步骤开放重试。"
        actions={
          <Button onClick={reload}>
            <RefreshCw size={15} />
            刷新记录
          </Button>
        }
      />
      <div className="service-strip">
        <span className={`status-text ${health?.worker ? "live" : "paused"}`}>
          <i />
          {health?.worker ? "Worker 有效心跳" : "没有有效 Worker 心跳"}
        </span>
        <span>最近心跳 {date(health?.worker?.at)}</span>
        <span>
          真实发布传输 {health?.publishTransportEnabled ? "已启用" : "未启用"}
        </span>
      </div>
      <div className="toolbar">
        <select
          aria-label="筛选任务状态"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">全部阶段</option>
          {[
            "queued",
            "generating_text",
            "validating",
            "preparing_media",
            "submitting",
            "submission_unknown",
            "published",
            "preview_ready",
            "retry_wait",
            "failed",
            "blocked",
            "cancelled",
          ].map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.length ? (
        <section className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>任务 / 创建时间</th>
                <th>触发</th>
                <th>当前阶段</th>
                <th>尝试 / 租约</th>
                <th>具体原因</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id}>
                  <td>
                    <button
                      className="link mono"
                      onClick={() => setSelected(j.id)}
                    >
                      {j.id.slice(0, 21)}
                    </button>
                    <small className="block muted">{date(j.createdAt)}</small>
                  </td>
                  <td>
                    <Badge value={j.kind} />
                  </td>
                  <td>
                    <Badge value={j.state} />
                  </td>
                  <td className="mono">
                    {j.attempt} 次
                    <small className="block muted">
                      {j.leaseUntil ? date(j.leaseUntil) : "无活动租约"}
                    </small>
                  </td>
                  <td>
                    {j.error?.message || "—"}
                    {j.error?.details?.errors?.[0] && (
                      <small className="block muted">
                        {j.error.details.errors[0].code} ·{" "}
                        {j.error.details.errors[0].message}
                      </small>
                    )}
                  </td>
                  <td>
                    <Button kind="text" onClick={() => setSelected(j.id)}>
                      详情
                      <ArrowUpRight size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <Empty>没有符合条件的任务。</Empty>
      )}
      {selected && (
        <JobDetail
          jobId={selected}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        />
      )}
    </>
  );
}
export function JobDetail({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const { data: j, error, reload } = useData(`/publication-jobs/${jobId}`),
    [tab, setTab] = useState("content"),
    [instructions, setInstructions] = useState(""),
    [remoteId, setRemoteId] = useState(""),
    [child, setChild] = useState<string | null>(null);
  return (
    <Modal title="执行任务" onClose={onClose} wide>
      {error ? (
        <ErrorBox error={error} />
      ) : !j ? (
        <Loading />
      ) : (
        <>
          <div className="detail-top">
            <span className="mono">{j.id}</span>
            <div>
              <Badge value={j.kind} /> <Badge value={j.state} />
            </div>
          </div>
          {j.error && <ErrorBox error={j.error} />}
          {j.state === "submission_unknown" && (
            <div className="notice">
              <div>
                <strong>保留原提交，先核对公开记录</strong>
                <Field
                  label="候选远端帖子 ID"
                  hint="只读取并比对原正文、标签、图片及可用作者标识，不会重发。"
                >
                  <input
                    className="mono"
                    value={remoteId}
                    onChange={(e) => setRemoteId(e.target.value)}
                  />
                </Field>
                <AsyncButton
                  disabled={!/^\d+$/.test(remoteId)}
                  action={() =>
                    send(`/publication-jobs/${j.id}/reconcile`, { remoteId })
                  }
                  onDone={reload}
                >
                  读取并关联原提交
                </AsyncButton>
              </div>
            </div>
          )}
          <div className="button-row">
            {j.capabilities.cancel && (
              <AsyncButton
                action={() => send(`/publication-jobs/${j.id}/cancel`, {})}
                onDone={reload}
              >
                取消未提交任务
              </AsyncButton>
            )}
            {j.capabilities.retry && (
              <AsyncButton
                action={() => send(`/publication-jobs/${j.id}/retry`, {})}
                onDone={reload}
              >
                重试安全步骤
              </AsyncButton>
            )}
            <span className="muted">预设已冻结 · fencing {j.fence}</span>
          </div>
          <div className="tabs">
            {[
              ["content", "正文与校验"],
              ["prompt", "实际提示词"],
              ["sources", "来源与选择"],
              ["events", "阶段日志"],
            ].map(([id, name]) => (
              <button
                key={id}
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {name}
              </button>
            ))}
          </div>
          {tab === "content" && (
            <>
              <div className="post-detail-grid">
                <div>
                  {j.content ? (
                    <>
                      <div className="article-preview">{j.content.text}</div>
                      <small className="mono muted">
                        {j.content.characterCount} 个 Unicode 字符
                      </small>
                    </>
                  ) : (
                    <Empty>任务尚未产生 AI 成稿。</Empty>
                  )}
                  {j.assetId && (
                    <img
                      className="preview-image"
                      src={apiUrl(`/assets/${j.assetId}/content`)}
                      alt="任务配图"
                    />
                  )}
                </div>
                <div>
                  {j.validation && (
                    <>
                      <Badge
                        value={j.validation.passed ? "verified" : "failed"}
                      />
                      <JsonPanel
                        title="事实、长度与同质化校验"
                        value={j.validation}
                        open
                      />
                    </>
                  )}
                  {j.validationHistory?.length > 1 && (
                    <JsonPanel
                      title={`全部校验记录（${j.validationHistory.length}轮）`}
                      value={j.validationHistory}
                    />
                  )}
                  {j.content && (
                    <>
                      <Field
                        label="AI 修改要求"
                        hint="保存新预览任务，经模型成稿后再次校验，不直接编辑已发正文。"
                      >
                        <textarea
                          rows={4}
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                        />
                      </Field>
                      <AsyncButton
                        disabled={!instructions.trim()}
                        action={() =>
                          send(`/publication-jobs/${j.id}/ai-revisions`, {
                            instructions,
                          })
                        }
                        onDone={(r) => setChild(r.id)}
                      >
                        调用 AI 改稿
                      </AsyncButton>
                    </>
                  )}
                  <JsonPanel title="发布意图与回执" value={j.attempts} />
                </div>
              </div>
            </>
          )}
          {tab === "prompt" &&
            (j.generationRuns.length ? (
              j.generationRuns.map((r: Item) => (
                <section key={r.id} className="generation-record">
                  <div className="post-meta">
                    <strong>{r.requestedModel}</strong>
                    <span>
                      {r.type === "text_review"
                        ? "成稿校对"
                        : r.type === "image"
                          ? "图片生成"
                          : "正文写作"}
                    </span>
                    <Badge value={r.state} />
                    <time>{date(r.createdAt)}</time>
                  </div>
                  <dl className="info-list">
                    <div>
                      <dt>实际请求地址</dt>
                      <dd className="mono">
                        {r.requestUrl || "历史记录未保存地址快照"}
                      </dd>
                    </div>
                    <div>
                      <dt>连接 / 凭据版本</dt>
                      <dd>
                        {r.connectionVersion || "—"} /{" "}
                        {r.credentialVersion || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>上游报告的模型</dt>
                      <dd>{r.reportedModel || "未返回，仅有请求参数"}</dd>
                    </div>
                    <div>
                      <dt>请求标识</dt>
                      <dd className="mono">{r.requestId || "未返回"}</dd>
                    </div>
                    <div>
                      <dt>提示词版本</dt>
                      <dd className="mono">{r.promptVersion}</dd>
                    </div>
                  </dl>
                  <JsonPanel
                    title="实际发送的完整提示词"
                    value={r.messages}
                    open
                  />
                  <JsonPanel
                    title="请求参数、用量与原始输出"
                    value={{
                      parameters: r.parameters,
                      usage: r.usage,
                      output: r.output,
                      error: r.error,
                    }}
                  />
                  {r.requestBody && (
                    <JsonPanel
                      title="实际发送的请求体（不含认证头）"
                      value={r.requestBody}
                    />
                  )}
                </section>
              ))
            ) : (
              <Empty>尚无模型调用记录。</Empty>
            ))}
          {tab === "sources" && (
            <>
              <JsonPanel
                title="候选权重、随机抽样和冻结版本"
                value={j.selection}
                open
              />
              <JsonPanel title="任务规则快照" value={j.rules} />
              {j.modelSelection && (
                <JsonPanel
                  title="创建任务时固定的 AI 选择"
                  value={j.modelSelection}
                />
              )}
              {j.sources.map((s: Item) => (
                <JsonPanel
                  key={s.id}
                  title={s.title || `${s.name} · ${date(s.fetchedAt)}`}
                  value={s}
                />
              ))}
              <JsonPanel title="可选来源缺失原因" value={j.sourceWarnings} />
            </>
          )}
          {tab === "events" && <Timeline events={j.events} />}
          {child && <JobDetail jobId={child} onClose={() => setChild(null)} />}
        </>
      )}
    </Modal>
  );
}
