import { ModelPicker } from "./ai-settings";
import { useState } from "react";
import { Plus, Copy, FlaskConical, GitBranch, ArrowRight } from "lucide-react";
import { api, send, Item, date, json } from "../api";
import {
  useData,
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

export function PresetsPage() {
  const { data, error, reload } = useData<Item[]>("/presets?limit=100"),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [job, setJob] = useState<string | null>(null);
  return (
    <>
      <PageHead
        eyebrow="CONTENT PLAYBOOKS"
        title="内容预设"
        description="配置写作方向、来源和边界，文章由批准模型逐篇组织。"
        actions={
          <Button kind="primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            新建预设
          </Button>
        }
      />
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.length ? (
        <div className="preset-grid">
          {data.map((p) => (
            <article className="panel preset-card" key={p.id}>
              <div className="preset-card-top">
                <span className="preset-symbol">
                  <GitBranch size={22} />
                </span>
                <Badge value={p.enabled ? "active" : "disabled"} />
              </div>
              <h2>{p.name}</h2>
              <p>{p.description || p.draftRules.direction}</p>
              <div className="preset-meta">
                <span>
                  {p.draftRules.preferredMin}—{p.draftRules.maxChars} 字符
                </span>
                <span>
                  {p.draftRules.image.mode === "library"
                    ? "已有图库"
                    : p.draftRules.image.mode === "generate"
                      ? "GPT Image 2"
                      : "图库 / 生图"}
                </span>
              </div>
              <div className="preset-card-foot">
                <span className="mono">
                  {p.publishedNumber
                    ? `PUBLISHED v${p.publishedNumber}`
                    : "DRAFT"}
                </span>
                <Button kind="text" onClick={() => setSelected(p.id)}>
                  编辑规则 <ArrowRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          action={
            <Button kind="primary" onClick={() => setCreating(true)}>
              创建预设
            </Button>
          }
        >
          先登记批准的模型，再创建第一个内容预设。
        </Empty>
      )}
      {(selected || creating) && (
        <PresetEditor
          presetId={selected}
          onClose={() => {
            setSelected(null);
            setCreating(false);
            reload();
          }}
          onJob={(j) => setJob(j)}
        />
      )}
      {job && <JobDetail jobId={job} onClose={() => setJob(null)} />}
    </>
  );
}
function PresetEditor({
  presetId,
  onClose,
  onJob,
}: {
  presetId: string | null;
  onClose: () => void;
  onJob: (j: string) => void;
}) {
  const {
      data: existing,
      error,
      reload,
    } = useData(
      presetId ? `/presets/${presetId}` : "/presets/example-rules",
      presetId,
      0,
    ),
    { data: models } = useData<Item[]>("/models?limit=100"),
    { data: sources } = useData<Item[]>("/data-sources?limit=100");
  if (error)
    return (
      <Modal title="预设" onClose={onClose}>
        <ErrorBox error={error} />
      </Modal>
    );
  if (!existing || !models || !sources)
    return (
      <Modal title="读取预设" onClose={onClose}>
        <Loading />
      </Modal>
    );
  return (
    <PresetForm
      key={`${presetId}-${existing.version || 0}`}
      existing={presetId ? existing : null}
      initialRules={presetId ? existing.draftRules : existing}
      models={models}
      sources={sources}
      onClose={onClose}
      onReload={reload}
      onJob={onJob}
    />
  );
}
function PresetForm({
  existing,
  initialRules,
  models,
  sources,
  onClose,
  onReload,
  onJob,
}: {
  existing: any;
  initialRules: any;
  models: Item[];
  sources: Item[];
  onClose: () => void;
  onReload: () => void;
  onJob: (j: string) => void;
}) {
  const [name, setName] = useState(existing?.name || ""),
    [description, setDescription] = useState(existing?.description || ""),
    [rules, setRules] = useState<any>({
      ...initialRules,
      modelId:
        initialRules.modelId === "configure-text-model"
          ? models.find((m) => m.type === "text" && m.approved)?.id || ""
          : initialRules.modelId,
    }),
    [enabled, setEnabled] = useState(existing?.enabled ?? true),
    [tab, setTab] = useState("content"),
    [includeImage, setIncludeImage] = useState(false),
    [error, setError] = useState<any>(null),
    [saved, setSaved] = useState<any>(null),
    [advanced, setAdvanced] = useState(json(initialRules)),
    [busy, setBusy] = useState(false);
  const p = saved || existing,
    patch = (k: string, v: any) => setRules((r: any) => ({ ...r, [k]: v })),
    image = (k: string, v: any) =>
      setRules((r: any) => ({ ...r, image: { ...r.image, [k]: v } }));
  return (
    <Modal
      title={existing ? "编辑内容预设" : "新建内容预设"}
      onClose={onClose}
      wide
    >
      <div className="form-grid">
        <Field label="预设名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="启用状态">
          <select
            value={String(enabled)}
            onChange={(e) => setEnabled(e.target.value === "true")}
          >
            <option value="true">启用</option>
            <option value="false">停用</option>
          </select>
        </Field>
        <Field label="描述" wide>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
      <div className="tabs" role="tablist">
        {[
          ["content", "内容与文字"],
          ["sources", "数据与素材"],
          ["image", "配图规则"],
          ["quality", "模型与质量"],
          ["versions", "版本与预览"],
          ["advanced", "完整规则"],
        ].map(([id, title]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => {
              if (id === "advanced") setAdvanced(json(rules));
              setTab(id);
            }}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "content" && (
        <div className="form-grid">
          <Field label="内容方向" wide>
            <textarea
              rows={4}
              value={rules.direction}
              onChange={(e) => patch("direction", e.target.value)}
            />
          </Field>
          <Field label="语言">
            <input
              value={rules.language}
              onChange={(e) => patch("language", e.target.value)}
            />
          </Field>
          <Field label="叙述视角">
            <input
              value={rules.perspective}
              onChange={(e) => patch("perspective", e.target.value)}
            />
          </Field>
          <Field label="语气与态度" wide>
            <textarea
              value={rules.tone}
              onChange={(e) => patch("tone", e.target.value)}
            />
          </Field>
          <Field label="优先最少字符">
            <input
              type="number"
              min={1}
              value={rules.preferredMin}
              onChange={(e) => patch("preferredMin", Number(e.target.value))}
            />
          </Field>
          <Field label="优先最多字符">
            <input
              type="number"
              min={1}
              value={rules.preferredMax}
              onChange={(e) => patch("preferredMax", Number(e.target.value))}
            />
          </Field>
          <Field label="硬上限（含空白和标签）">
            <input
              type="number"
              min={1}
              value={rules.maxChars}
              onChange={(e) => patch("maxChars", Number(e.target.value))}
            />
          </Field>
          <Field label="分段偏好">
            <input
              value={rules.paragraphs}
              onChange={(e) => patch("paragraphs", e.target.value)}
            />
          </Field>
          <Field label="选题方式">
            <select
              value={rules.selection}
              onChange={(e) => patch("selection", e.target.value)}
            >
              <option value="market_top5">涨跌榜前五</option>
              <option value="fixed">固定币种</option>
              <option value="topic">自定义主题</option>
            </select>
          </Field>
          <Field label="币种数">
            <input
              type="number"
              min={0}
              max={10}
              value={rules.tokenCount}
              onChange={(e) => patch("tokenCount", Number(e.target.value))}
            />
          </Field>
          <Field label="固定币种，逗号分隔">
            <input
              value={rules.tokens.join(",")}
              onChange={(e) =>
                patch(
                  "tokens",
                  e.target.value
                    .toUpperCase()
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
          <Field label="完整标签数量">
            <input
              type="number"
              min={0}
              value={rules.tagCount}
              onChange={(e) => patch("tagCount", Number(e.target.value))}
            />
          </Field>
          <label className="check-field">
            <input
              type="checkbox"
              checked={rules.bothSides}
              onChange={(e) => patch("bothSides", e.target.checked)}
            />
            兼顾涨跌两榜
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={rules.requiredPercent}
              onChange={(e) => patch("requiredPercent", e.target.checked)}
            />
            逐币标注滚动24小时涨跌幅
          </label>
        </div>
      )}
      {tab === "sources" && (
        <>
          <div className="form-grid">
            <Field label="事实最大时效（秒）">
              <input
                type="number"
                min={1}
                value={rules.factsMaxAgeSeconds}
                onChange={(e) =>
                  patch("factsMaxAgeSeconds", Number(e.target.value))
                }
              />
            </Field>
            <Field label="参考材料" wide>
              <textarea
                rows={5}
                value={rules.material}
                onChange={(e) => patch("material", e.target.value)}
              />
            </Field>
          </div>
          <h3>可使用的数据源</h3>
          {sources.map((s) => {
            const entry = rules.sourceRules.find(
              (r: any) => r.sourceId === s.id,
            );
            const change = (v: any) =>
              patch(
                "sourceRules",
                rules.sourceRules.map((r: any) =>
                  r.sourceId === s.id ? { ...r, ...v } : r,
                ),
              );
            return (
              <div className="source-rule" key={s.id}>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={!!entry}
                    onChange={(e) =>
                      patch(
                        "sourceRules",
                        e.target.checked
                          ? [
                              ...rules.sourceRules,
                              {
                                sourceId: s.id,
                                required: false,
                                maxAgeSeconds: s.maxAgeSeconds,
                                priority: rules.sourceRules.length + 1,
                              },
                            ]
                          : rules.sourceRules.filter(
                              (r: any) => r.sourceId !== s.id,
                            ),
                      )
                    }
                  />
                  {s.name}
                </label>
                {entry && (
                  <>
                    <label>
                      必需{" "}
                      <input
                        type="checkbox"
                        checked={entry.required}
                        onChange={(e) => change({ required: e.target.checked })}
                      />
                    </label>
                    <label>
                      时效秒{" "}
                      <input
                        type="number"
                        value={entry.maxAgeSeconds}
                        min={1}
                        onChange={(e) =>
                          change({ maxAgeSeconds: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      优先级{" "}
                      <input
                        type="number"
                        value={entry.priority}
                        onChange={(e) =>
                          change({ priority: Number(e.target.value) })
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            );
          })}
          <p className="help-text">
            必需来源缺失会阻塞任务；可选新闻不可核实时省略并留记录。
          </p>
        </>
      )}
      {tab === "image" && (
        <div className="form-grid">
          <Field label="图片来源">
            <select
              value={rules.image.mode}
              onChange={(e) => image("mode", e.target.value)}
            >
              <option value="library">只用已有图库</option>
              <option value="generate">每次 GPT Image 2 生图</option>
              <option value="library_or_generate">优先图库，缺图时生成</option>
            </select>
          </Field>
          <Field label="图库集合">
            <input
              value={rules.image.collection}
              onChange={(e) => image("collection", e.target.value)}
            />
          </Field>
          <Field label="风格">
            <input
              value={rules.image.style}
              onChange={(e) => image("style", e.target.value)}
            />
          </Field>
          <Field label="比例（如 1:1）">
            <input
              value={rules.image.aspectRatio}
              onChange={(e) => image("aspectRatio", e.target.value)}
            />
          </Field>
          <Field label="匹配标签">
            <input
              value={rules.image.tags.join(",")}
              onChange={(e) =>
                image(
                  "tags",
                  e.target.value
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
          <Field label="复用窗口（秒）">
            <input
              type="number"
              min={0}
              value={rules.image.reuseSeconds}
              onChange={(e) => image("reuseSeconds", Number(e.target.value))}
            />
          </Field>
          <ModelPicker
            label="批准的 GPT Image 2 模型"
            value={rules.image.modelId}
            onChange={(v) => image("modelId", v)}
            models={models}
            type="image"
          />
          <Field label="图库匹配为空时">
            <select
              value={rules.image.fallback}
              onChange={(e) => image("fallback", e.target.value)}
            >
              <option value="block">按来源模式处理，不跨集合回退</option>
              <option value="any_library">明确允许其他图库图片</option>
            </select>
          </Field>
          <Field label="生图要求" wide>
            <textarea
              rows={4}
              value={rules.image.prompt}
              onChange={(e) => image("prompt", e.target.value)}
            />
          </Field>
          <Field
            label="生图参数 JSON"
            hint="例如 size、quality，须在模型允许参数中登记。比例不符的产物会阻塞发送。"
            wide
          >
            <textarea
              spellCheck={false}
              defaultValue={json(rules.image.parameters || {})}
              onBlur={(e) => {
                try {
                  image("parameters", JSON.parse(e.target.value));
                  setError(null);
                } catch {
                  setError(new Error("生图参数不是有效 JSON。"));
                }
              }}
            />
          </Field>
        </div>
      )}
      {tab === "quality" && (
        <div className="form-grid">
          <ModelPicker
            label="批准的文字模型"
            value={rules.modelId}
            onChange={(v) => patch("modelId", v)}
            models={models}
            type="text"
          />
          <Field label="最多 AI 修复次数">
            <input
              type="number"
              min={0}
              max={3}
              value={rules.repairAttempts}
              onChange={(e) => patch("repairAttempts", Number(e.target.value))}
            />
          </Field>
          <Field
            label="成稿 AI 校对"
            hint="通过数字与格式检查后，再调用批准模型校对事实、中文表达和与历史文章的差异。"
          >
            <select
              value={String(rules.semanticReview ?? true)}
              onChange={(e) =>
                patch("semanticReview", e.target.value === "true")
              }
            >
              <option value="true">启用（额外一次模型请求）</option>
              <option value="false">仅运行规则检查</option>
            </select>
          </Field>
          <Field label="预设禁词，逗号分隔">
            <input
              value={rules.bannedWords.join(",")}
              onChange={(e) =>
                patch(
                  "bannedWords",
                  e.target.value.split(/[,，]/).filter(Boolean),
                )
              }
            />
          </Field>
          <Field label="历史比对篇数">
            <input
              type="number"
              min={1}
              max={500}
              value={rules.dedupWindow}
              onChange={(e) => patch("dedupWindow", Number(e.target.value))}
            />
          </Field>
          <Field label="相似度阈值">
            <input
              type="number"
              min={0.1}
              max={1}
              step={0.01}
              value={rules.similarityThreshold}
              onChange={(e) =>
                patch("similarityThreshold", Number(e.target.value))
              }
            />
          </Field>
          <Field label="质量提示（每行一条）" wide>
            <textarea
              value={rules.qualityHints.join("\n")}
              onChange={(e) =>
                patch(
                  "qualityHints",
                  e.target.value.split("\n").filter(Boolean),
                )
              }
            />
          </Field>
          <Field label="模型参数 JSON" wide>
            <textarea
              spellCheck={false}
              defaultValue={json(rules.parameters)}
              onBlur={(e) => {
                try {
                  patch("parameters", JSON.parse(e.target.value));
                  setError(null);
                } catch {
                  setError(new Error("模型参数不是有效 JSON。"));
                }
              }}
            />
          </Field>
        </div>
      )}
      {tab === "advanced" && (
        <>
          <Field
            label="完整预设规则 JSON"
            hint="应用后仍需保存草稿，并单独发布版本。"
          >
            <textarea
              className="code-input"
              rows={20}
              value={advanced}
              onChange={(e) => setAdvanced(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Button
            onClick={() => {
              try {
                setRules(JSON.parse(advanced));
                setError(null);
              } catch {
                setError(new Error("规则不是有效 JSON。"));
              }
            }}
          >
            应用到编辑器
          </Button>
        </>
      )}
      {tab === "versions" && (
        <>
          <div className="notice">
            <GitBranch size={18} />
            <div>
              <strong>草稿与生产版本分开</strong>
              <span>保存不会改变已有任务；发布新版本只影响后续认领。</span>
            </div>
          </div>
          {p ? (
            <>
              <div className="button-row">
                <AsyncButton
                  kind="primary"
                  action={() =>
                    send(`/presets/${p.id}/publish-version`, {
                      expectedVersion: p.version,
                      changeNote: "Dashboard 发布规则版本",
                    })
                  }
                  onDone={(r) => {
                    setSaved(r);
                    onReload();
                  }}
                >
                  发布新版本
                </AsyncButton>
                <AsyncButton
                  action={() => send(`/presets/${p.id}/clone`, {})}
                  onDone={onClose}
                >
                  <Copy size={14} />
                  复制预设
                </AsyncButton>
                <AsyncButton
                  disabled={!p.publishedVersionId}
                  action={() =>
                    send(`/presets/${p.id}/preview`, {
                      includeImageGeneration: includeImage,
                    })
                  }
                  onDone={(r) => onJob(r.id)}
                >
                  <FlaskConical size={14} />
                  测试已发布版本
                </AsyncButton>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={includeImage}
                  onChange={(e) => setIncludeImage(e.target.checked)}
                />
                预览包含新生图（会调用图片模型）
              </label>
              {existing?.versions?.map((v: Item) => (
                <JsonPanel
                  key={v.id}
                  title={`v${v.number} · ${date(v.createdAt)}`}
                  value={v}
                />
              ))}
              <JsonPanel
                title="草稿与当前版本差异"
                value={diff(
                  existing?.versions?.find(
                    (v: Item) => v.id === p.publishedVersionId,
                  )?.rules || {},
                  rules,
                )}
              />
              <p className="help-text">
                绑定账号：{existing?.boundAccounts?.length || 0} 个
              </p>
            </>
          ) : (
            <p className="help-text">先保存草稿。</p>
          )}
        </>
      )}
      {error && <ErrorBox error={error} />}
      <div className="form-actions sticky-actions">
        <span className="muted">
          {p?.publishedNumber
            ? `当前生产 v${p.publishedNumber}`
            : "尚无生产版本"}
        </span>
        <Button onClick={onClose}>关闭</Button>
        <Button
          kind="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void (
              p
                ? send(
                    `/presets/${p.id}`,
                    {
                      expectedVersion: p.version,
                      name,
                      description,
                      enabled,
                      rules,
                    },
                    "PATCH",
                  )
                : send("/presets", { name, description, rules })
            )
              .then((r) => {
                setSaved(r.data);
                setTab("versions");
              })
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          保存草稿
        </Button>
      </div>
    </Modal>
  );
}
function diff(a: any, b: any, prefix = ""): any[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (json(a[k]) === json(b[k])) return [];
    if (
      a[k] &&
      b[k] &&
      !Array.isArray(a[k]) &&
      typeof a[k] === "object" &&
      typeof b[k] === "object"
    )
      return diff(a[k], b[k], path);
    return [{ field: path, from: a[k], to: b[k] }];
  });
}
