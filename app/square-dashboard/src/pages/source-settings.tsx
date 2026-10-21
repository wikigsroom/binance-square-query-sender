import { useState } from "react";
import {
  Newspaper,
  Plus,
  RefreshCw,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import { Item, date, send } from "../api";
import {
  useData,
  useDebouncedValue,
  Button,
  Badge,
  ErrorBox,
  Loading,
  Modal,
  Field,
  AsyncButton,
  JsonPanel,
  Empty,
} from "../components";

const typeNames: Record<string, string> = {
  binance_market: "币安现货行情",
  jinse: "金色财经快讯",
  blockbeats: "律动快讯",
  article: "单篇新闻原文",
};
const transportNames: Record<string, string> = {
  binance_spot: "币安公开现货接口",
  public_api: "金色公开快讯接口",
  official_rss: "律动官方 RSS",
  official_channel: "律动官方公开频道",
  article_html: "新闻原文页面",
};
const age = (seconds: number) =>
  seconds >= 3600
    ? `${+(seconds / 3600).toFixed(1)} 小时`
    : `${Math.ceil(seconds / 60)} 分钟`;

export function SourceSettings() {
  const {
    data: sources,
    loading,
    error,
    reload,
  } = useData<Item[]>("/data-sources?limit=100");
  const { data: catalog } = useData<Item[]>("/data-sources/catalog", 0, 0);
  const [editing, setEditing] = useState<Item | null | false>(false),
    [selected, setSelected] = useState("source_binance"),
    [revision, setRevision] = useState(0),
    [batchResult, setBatchResult] = useState<any[] | null>(null);
  const active = sources?.find((s) => s.id === selected) || sources?.[0];
  const refreshed = () => {
    reload();
    setRevision((v) => v + 1);
  };
  return (
    <>
      <div className="section-title source-section-title">
        <div>
          <h2>素材与新闻来源</h2>
          <p className="help-text">
            核对行情与快讯原文，再交给 AI
            写作。这里的读取操作不会生成或发布帖子。
          </p>
        </div>
        <div className="button-row">
          <AsyncButton
            action={() => send("/data-sources/probe-all", {})}
            onDone={(data) => {
              setBatchResult(data);
              refreshed();
            }}
          >
            <RefreshCw size={15} /> 读取全部已启用来源
          </AsyncButton>
          <Button kind="primary" onClick={() => setEditing(null)}>
            <Plus size={15} /> 添加数据源
          </Button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !sources && <Loading />}
      {batchResult && (
        <div className="source-batch-result" role="status">
          {batchResult.map((r) => (
            <p key={r.sourceId}>
              <strong>{r.name}</strong>：
              {r.ok ? `已读取 ${r.count} 条` : r.error?.message}
            </p>
          ))}
          <Button onClick={() => setBatchResult(null)}>收起结果</Button>
        </div>
      )}
      <div className="connection-grid source-grid">
        {sources?.map((s) => (
          <article
            className={`panel connection-card source-card ${active?.id === s.id ? "source-selected" : ""}`}
            key={s.id}
          >
            <div className="panel-head">
              {s.type === "binance_market" ? (
                <TrendingUp size={22} />
              ) : (
                <Newspaper size={22} />
              )}
              <Badge
                value={
                  !s.enabled
                    ? "disabled"
                    : s.lastRead?.status === "healthy"
                      ? "active"
                      : s.lastRead?.status === "degraded"
                        ? "pending"
                        : s.lastRead?.status === "failed"
                          ? "failed"
                          : "unverified"
                }
              >
                {!s.enabled
                  ? "已停用"
                  : s.lastRead?.status === "healthy"
                    ? "读取正常"
                    : s.lastRead?.status === "degraded"
                      ? "备用来源可用"
                      : s.lastRead?.status === "failed"
                        ? "读取失败"
                        : "尚未读取"}
              </Badge>
            </div>
            <h3>{s.name}</h3>
            <p className="help-text">{s.description || typeNames[s.type]}</p>
            <a
              className="source-home mono wrap"
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              {s.url} <ArrowUpRight size={13} />
            </a>
            <div className="source-meta">
              <span>素材时效 {age(s.maxAgeSeconds)}</span>
              <span>
                {s.lastRead
                  ? `${s.lastRead.itemCount} 条${s.type === "binance_market" ? "行情" : "快讯"}`
                  : "等待首次检查"}
              </span>
            </div>
            <p className="help-text">
              上次成功：
              {s.lastRead?.lastSuccessAt
                ? date(s.lastRead.lastSuccessAt)
                : "暂无"}
            </p>
            {s.lastRead?.error && (
              <p className="source-error">{s.lastRead.error.message}</p>
            )}
            <div className="button-row">
              <Button
                kind={active?.id === s.id ? "primary" : ""}
                onClick={() => setSelected(s.id)}
              >
                {s.type === "binance_market" ? "查看行情" : "查看快讯"}
              </Button>
              <Button onClick={() => setEditing(s)}>编辑来源</Button>
            </div>
          </article>
        ))}
      </div>
      {sources && !sources.length && (
        <Empty>添加行情、新闻或文章来源，让 AI 使用可核实的材料。</Empty>
      )}
      {active && (
        <SourcePreview
          key={active.id}
          source={active}
          revision={revision}
          onRefresh={refreshed}
        />
      )}
      <p className="help-text source-preset-note">
        在「内容预设 →
        素材与来源」中选择要使用的来源。新增来源不会修改已经发布的预设版本；必需来源不可读会阻塞任务，可选新闻无匹配时会记录原因。
      </p>
      {editing !== false && (
        <SourceForm
          existing={editing}
          catalog={catalog || []}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            refreshed();
          }}
        />
      )}
    </>
  );
}

function SourcePreview({
  source,
  revision,
  onRefresh,
}: {
  source: Item;
  revision: number;
  onRefresh: () => void;
}) {
  const [keyword, setKeyword] = useState(""),
    [tokens, setTokens] = useState(""),
    [hours, setHours] = useState("72"),
    [visible, setVisible] = useState(20);
  const market = source.type === "binance_market",
    q = useDebouncedValue(keyword),
    symbols = useDebouncedValue(tokens);
  const query = new URLSearchParams({
    q,
    tokens: symbols,
    ...(market ? {} : { hours }),
  });
  const { data, error, loading, reload } = useData(
    `/data-sources/${source.id}/content?${query}`,
    revision,
    0,
  );
  return (
    <section
      className="panel source-preview"
      aria-label={`${source.name}内容预览`}
    >
      <div className="section-title">
        <div>
          <h3>
            {source.name} · {market ? "滚动24小时行情" : "快讯预览"}
          </h3>
          <p className="help-text">
            {market
              ? "仅统计交易中、有成交的 USDT 现货交易对；涨跌幅不是自然日涨跌幅。"
              : "支持币种代码与中英文项目名关联，保留原文和实际读取来源。搜索范围以“已扫描”数量为准。"}
          </p>
        </div>
        <AsyncButton
          action={() => send(`/data-sources/${source.id}/probe`, {})}
          onDone={() => {
            reload();
            onRefresh();
          }}
        >
          <RefreshCw size={15} /> 刷新读取
        </AsyncButton>
      </div>
      <div className="source-filters">
        <Field label={market ? "搜索币种或交易对" : "搜索标题或正文"}>
          <input
            value={keyword}
            placeholder={market ? "例如 BTC" : "例如升级、ETF、融资"}
            onChange={(e) => {
              setKeyword(e.target.value);
              setVisible(20);
            }}
          />
        </Field>
        <Field label="币种代码" hint="逗号分隔；留空查看全部">
          <input
            value={tokens}
            placeholder="BTC, ETH, SOL"
            onChange={(e) => {
              setTokens(e.target.value);
              setVisible(20);
            }}
          />
        </Field>
        {!market && (
          <Field label="报道时间范围">
            <select
              value={hours}
              onChange={(e) => {
                setHours(e.target.value);
                setVisible(20);
              }}
            >
              <option value="3">近3小时</option>
              <option value="24">近24小时</option>
              <option value="72">近72小时</option>
              <option value="168">近7天</option>
            </select>
          </Field>
        )}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {data && !loading && !error && (
        <>
          <div className="source-read-line">
            <span>读取于 {date(data.fetchedAt)}</span>
            <span>
              {transportNames[data.transport || "binance_spot"] ||
                data.transport}
            </span>
            <span>{data.cached ? "使用最近快照" : "刚刚读取"}</span>
          </div>
          {!!data.failures?.length && (
            <div className="source-fallback-note">
              部分读取方式不可用，已使用可用来源。具体原因保留在下方「读取详情」中。
            </div>
          )}
          {market ? (
            <>
              <div className="source-rankings">
                <Ranking title="涨幅榜 Top 5" rows={data.topGainers} />
                <Ranking title="跌幅榜 Top 5" rows={data.topLosers} />
              </div>
              <h4 className="source-result-title">
                匹配行情 {data.total} 条 · 全市场有效交易对 {data.symbolsCount}{" "}
                个
              </h4>
              {data.items.length ? (
                <div className="table-wrap">
                  <table className="source-market-table">
                    <thead>
                      <tr>
                        <th>代币 / 交易对</th>
                        <th>最新价 · USDT</th>
                        <th>24h 涨跌幅</th>
                        <th>24h 成交额 · USDT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((r: any) => (
                        <tr key={r.symbol}>
                          <td>
                            <strong>{r.token}</strong>
                            <small className="muted"> {r.symbol}</small>
                          </td>
                          <td className="mono">
                            {r.lastPrice === null
                              ? "—"
                              : Number(r.lastPrice).toLocaleString(undefined, {
                                  maximumFractionDigits: 10,
                                })}
                          </td>
                          <td
                            className={
                              r.changePercent >= 0
                                ? "source-up mono"
                                : "source-down mono"
                            }
                          >
                            {percent(r.changePercent)}
                          </td>
                          <td className="mono">
                            {Number(r.quoteVolume).toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>没有匹配的现货交易对，请调整币种或搜索条件。</Empty>
              )}
              {data.total > data.items.length && (
                <p className="help-text">
                  当前展示前 {data.items.length} 条，请搜索具体交易对。
                </p>
              )}
            </>
          ) : (
            <>
              <h4 className="source-result-title">
                匹配快讯 {data.total} 条 · 已扫描 {data.scannedCount} 条 ·
                有效时效不超过 {age(data.maxAgeSeconds)}
              </h4>
              {!data.items.length ? (
                <Empty>
                  来源已读取，但当前时间范围和筛选条件下没有匹配快讯。
                </Empty>
              ) : (
                <div className="news-list">
                  {data.items.slice(0, visible).map((item: any) => (
                    <article className="news-item" key={item.url}>
                      <div className="news-item-meta">
                        <time dateTime={item.publishedAt}>
                          {new Date(item.publishedAt).toLocaleString("zh-CN", {
                            timeZone: "Asia/Shanghai",
                            hour12: false,
                          })}{" "}
                          北京时间
                        </time>
                        <span>{item.attribution || source.name}</span>
                        {item.relatedTokens?.map((t: string) => (
                          <span className="token" key={t}>
                            ${t}
                          </span>
                        ))}
                      </div>
                      <h4>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.title} <ArrowUpRight size={14} />
                        </a>
                      </h4>
                      <p className="news-body">
                        {item.body.length <= 300
                          ? item.body
                          : `${item.body.slice(0, 300)}…`}
                      </p>
                      {item.body.length > 300 && (
                        <details className="news-full-text">
                          <summary>展开完整快讯</summary>
                          <p>{item.body}</p>
                        </details>
                      )}
                      <div className="news-links">
                        <a
                          href={item.evidenceUrl || item.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看读取来源
                        </a>
                        {item.originalUrl && (
                          <a
                            href={item.originalUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            报道引用链接
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {data.items.length > visible && (
                <Button onClick={() => setVisible((n) => n + 20)}>
                  显示更多快讯
                </Button>
              )}
            </>
          )}
          <JsonPanel title="读取详情" value={data} />
        </>
      )}
    </section>
  );
}
function percent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function Ranking({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="source-ranking">
      <h4>{title}</h4>
      {rows?.length ? (
        <ol>
          {rows.map((r) => (
            <li key={r.symbol}>
              <strong>{r.token}</strong>
              <span
                className={
                  r.changePercent >= 0 ? "source-up mono" : "source-down mono"
                }
              >
                {percent(r.changePercent)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="help-text">当前没有符合条件的代币</p>
      )}
    </div>
  );
}

function SourceForm({
  existing,
  catalog,
  onClose,
  onDone,
}: {
  existing: Item | null;
  catalog: Item[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<any>(
    existing || {
      name: "",
      description: "",
      type: "article",
      url: "",
      allowedHosts: [],
      maxAgeSeconds: 259200,
      enabled: true,
      allowPrivateNetwork: false,
    },
  );
  const [hosts, setHosts] = useState((existing?.allowedHosts || []).join(", "));
  const patch = (key: string, value: any) =>
    setForm((f: any) => ({ ...f, [key]: value }));
  const choose = (type: string) => {
    const template = catalog.find((c) => c.type === type);
    setForm((f: any) => ({
      ...f,
      ...(template
        ? {
            name: template.name,
            description: template.description,
            url: template.url,
            maxAgeSeconds: template.maxAgeSeconds,
          }
        : {}),
      type,
    }));
    setHosts(template?.allowedHosts.join(", ") || "");
  };
  return (
    <Modal title={existing ? "编辑数据源" : "添加数据源"} onClose={onClose}>
      <Field label="来源类型">
        <select value={form.type} onChange={(e) => choose(e.target.value)}>
          {Object.entries(typeNames).map(([id, name]) => (
            <option value={id} key={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="来源名称">
        <input
          value={form.name}
          maxLength={120}
          onChange={(e) => patch("name", e.target.value)}
        />
      </Field>
      <Field label="来源说明">
        <textarea
          value={form.description || ""}
          maxLength={800}
          rows={2}
          onChange={(e) => patch("description", e.target.value)}
        />
      </Field>
      <Field
        label="读取地址"
        hint={
          form.type === "binance_market"
            ? "填写基础域名；程序读取现货交易对与24小时行情。"
            : "选择内置新闻类型会自动填写官网与对应的公开读取域名。"
        }
      >
        <input
          type="url"
          value={form.url}
          placeholder="https://"
          onChange={(e) => patch("url", e.target.value)}
        />
      </Field>
      <Field
        label="允许域名（逗号分隔）"
        hint="只会访问列出的域名。律动官方公开频道使用 t.me；金色快讯使用 api.jinse2.com。"
      >
        <textarea
          rows={2}
          value={hosts}
          onChange={(e) => setHosts(e.target.value)}
        />
      </Field>
      <Field label="最大时效（分钟）">
        <input
          type="number"
          min={1}
          max={525600}
          value={form.maxAgeSeconds / 60}
          onChange={(e) => patch("maxAgeSeconds", Number(e.target.value) * 60)}
        />
      </Field>
      <label className="check-field">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => patch("enabled", e.target.checked)}
        />
        启用此来源
      </label>
      <details className="source-advanced">
        <summary>高级读取设置</summary>
        <label className="check-field">
          <input
            type="checkbox"
            checked={!!form.allowPrivateNetwork}
            onChange={(e) => patch("allowPrivateNetwork", e.target.checked)}
          />
          允许访问我配置的内网来源
        </label>
      </details>
      <AsyncButton
        kind="primary"
        disabled={
          !form.name.trim() || !form.url.trim() || form.maxAgeSeconds < 60
        }
        action={() =>
          send(
            existing ? `/data-sources/${existing.id}` : "/data-sources",
            {
              name: form.name,
              description: form.description,
              type: form.type,
              url: form.url,
              allowedHosts: hosts
                ? hosts.split(/[,，\s]+/).filter(Boolean)
                : undefined,
              maxAgeSeconds: form.maxAgeSeconds,
              enabled: form.enabled,
              allowPrivateNetwork: !!form.allowPrivateNetwork,
              expectedVersion: existing?.version,
            },
            existing ? "PATCH" : "POST",
          )
        }
        onDone={onDone}
      >
        保存数据源
      </AsyncButton>
    </Modal>
  );
}
