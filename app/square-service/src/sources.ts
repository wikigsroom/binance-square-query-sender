import {
  Database,
  Row,
  Doc,
  now,
  hash,
  random,
  requireThat,
  errorInfo,
  Fault,
} from "./core.js";
import { Rules } from "./rules.js";
import { Http } from "./http.js";
import { SourceReaders } from "./source-readers.js";
import { relatedTokens } from "./news-parsers.js";

export class Sources {
  private pending = new Map<string, Promise<Doc>>();
  private readers: SourceReaders;
  constructor(
    private db: Database,
    http: Http,
  ) {
    this.readers = new SourceReaders(http);
  }
  summary(read: Row | null) {
    if (!read) return null;
    return {
      status: read.status,
      checkedAt: read.checkedAt,
      lastSuccessAt: read.lastSuccessAt,
      expiresAt: read.expiresAt,
      error: read.error,
      durationMs: read.durationMs,
      transport:
        read.payload?.transport ||
        (read.payload?.type === "market" ? "binance_spot" : null),
      itemCount:
        read.payload?.articles?.length ?? read.payload?.symbolsCount ?? 0,
      failures: read.payload?.failures || [],
      stale: read.status === "failed",
    };
  }
  async read(source: Row, force = false): Promise<Doc> {
    const configHash = hash(
      JSON.stringify([
        source.type,
        source.url,
        source.allowedHosts,
        source.allowPrivateNetwork,
        source.maxAgeSeconds,
      ]),
    );
    const key = `${source.id}:${configHash}`,
      old = await this.db.get("source_reads", source.id);
    if (
      !force &&
      old?.configHash === configHash &&
      Date.parse(old.expiresAt) > Date.now()
    ) {
      if (old.status === "failed")
        throw new Fault(
          old.error.code,
          old.error.message,
          502,
          old.error.details,
          old.error.retryable,
        );
      return { ...old.payload, cached: true };
    }
    const active = this.pending.get(key);
    if (active) return active;
    const execute = async () => {
      const started = Date.now();
      let values: Doc;
      try {
        const payload: Doc =
          source.type === "binance_market"
            ? await this.readers.market(source)
            : await this.readers.feed(source);
        if (payload.articles)
          requireThat(
            payload.articles.some((a: Doc) => {
              const age = Date.now() - Date.parse(a.publishedAt);
              return age >= -60000 && age <= source.maxAgeSeconds * 1000;
            }),
            "SOURCE_STALE",
            "读取到的新闻均超出配置的时效窗口。",
            502,
          );
        values = {
          configHash,
          status: payload.failures?.length ? "degraded" : "healthy",
          payload,
          checkedAt: now(),
          lastSuccessAt: now(),
          error: null,
          durationMs: Date.now() - started,
          expiresAt: new Date(
            Date.now() + Math.min(60, source.maxAgeSeconds) * 1000,
          ).toISOString(),
        };
      } catch (e) {
        values = {
          configHash,
          status: "failed",
          payload: old?.configHash === configHash ? old.payload : null,
          checkedAt: now(),
          lastSuccessAt: old?.lastSuccessAt || null,
          error: errorInfo(e),
          durationMs: Date.now() - started,
          expiresAt: new Date(Date.now() + 30000).toISOString(),
        };
        await this.saveRead(source.id, values);
        throw e;
      }
      await this.saveRead(source.id, values);
      return { ...values.payload, cached: false };
    };
    const promise = execute();
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }
  private async saveRead(sourceId: string, data: Doc) {
    await this.db.sql(
      `INSERT INTO source_reads(id,data) VALUES($1,$2::jsonb)
      ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,version=source_reads.version+1,updated_at=clock_timestamp()`,
      [sourceId, JSON.stringify(data)],
    );
  }
  async market(source: Row, force = false) {
    return this.read(source, force);
  }
  async article(url: string, source: Row) {
    return this.readers.article(url, source);
  }
  async news(source: Row, tokens: string[], maxAgeSeconds: number) {
    const result = await this.read(source);
    const articles = result.articles
      .filter((a: Doc) => {
        const age = Date.now() - Date.parse(a.publishedAt);
        return (
          age >= -60000 &&
          age <= Math.min(maxAgeSeconds, source.maxAgeSeconds) * 1000
        );
      })
      .map((a: Doc) => ({ ...a, relatedTokens: relatedTokens(a, tokens) }))
      .filter((a: Doc) => a.relatedTokens.length)
      .slice(0, 6);
    return {
      articles,
      fetchedAt: result.fetchedAt,
      transport: result.transport,
      failures: result.failures,
      reason: articles.length
        ? null
        : "来源已读取，时效窗口内没有直接关联所选代币的新闻。",
    };
  }
  async content(source: Row, query: Doc): Promise<Doc> {
    const result = await this.read(source),
      keyword = String(query.q || "")
        .toLowerCase()
        .slice(0, 200);
    const tokens = String(query.tokens || "")
      .split(/[,，\s]+/)
      .map((t) => t.replace(/^\$/, "").toUpperCase())
      .filter(Boolean)
      .slice(0, 20);
    requireThat(
      tokens.every((t) => /^[A-Z0-9]{1,20}$/.test(t)),
      "INVALID_TOKENS",
      "币种须使用代币代码，例如 BTC,ETH。",
      400,
    );
    if (result.type === "market") {
      const { symbols, ...meta } = result;
      const items = symbols.filter(
        (a: Doc) =>
          (!keyword ||
            `${a.token} ${a.symbol}`.toLowerCase().includes(keyword)) &&
          (!tokens.length || tokens.includes(a.token)),
      );
      return { ...meta, items: items.slice(0, 200), total: items.length };
    }
    const maxAgeSeconds = Math.min(
      source.maxAgeSeconds,
      Math.max(1, Number(query.hours) || source.maxAgeSeconds / 3600) * 3600,
    );
    const items = result.articles
      .map((a: Doc) => ({ ...a, relatedTokens: relatedTokens(a, tokens) }))
      .filter((a: Doc) => {
        const age = Date.now() - Date.parse(a.publishedAt);
        return (
          age >= -60000 &&
          age <= maxAgeSeconds * 1000 &&
          (!tokens.length || a.relatedTokens.length) &&
          (!keyword || `${a.title} ${a.body}`.toLowerCase().includes(keyword))
        );
      });
    const { articles, ...meta } = result;
    return {
      ...meta,
      items,
      total: items.length,
      scannedCount: articles.length,
      maxAgeSeconds,
    };
  }
  async collect(job: Row) {
    const rules = job.rules as Rules,
      snapshots: Row[] = [],
      warnings: Doc[] = [];
    let market: Doc | undefined;
    const sourceRules = [...rules.sourceRules].sort(
      (a, b) => a.priority - b.priority,
    );
    for (const sr of sourceRules) {
      const s = await this.db.get("sources", sr.sourceId);
      if (!s?.enabled) {
        if (sr.required) throw sourceFault(sr.sourceId);
        warnings.push({ sourceId: sr.sourceId, reason: "数据源未启用" });
        continue;
      }
      if (s.type === "binance_market") {
        try {
          market = await this.market(s);
          if (
            Date.now() - Date.parse(market.fetchedAt) >
            Math.min(rules.factsMaxAgeSeconds, sr.maxAgeSeconds) * 1000
          )
            market = await this.market(s, true);
          const stored = await this.db.insert("source_snapshots", {
            ...market,
            jobId: job.id,
            expiresAt: new Date(
              Date.parse(market.fetchedAt) +
                Math.min(rules.factsMaxAgeSeconds, sr.maxAgeSeconds) * 1000,
            ).toISOString(),
          });
          snapshots.push(stored);
        } catch (e) {
          if (sr.required) throw sourceFault(sr.sourceId, e);
          warnings.push({ sourceId: sr.sourceId, error: errorInfo(e) });
        }
      }
    }
    const tokens = selectTokens(rules, market);
    for (const sr of sourceRules) {
      const s = await this.db.get("sources", sr.sourceId);
      if (!s?.enabled || s.type === "binance_market") continue;
      try {
        if (["blockbeats", "jinse"].includes(s.type)) {
          const n = await this.news(s, tokens, sr.maxAgeSeconds);
          if (sr.required && !n.articles.length)
            throw sourceFault(s.id, new Error(n.reason || ""));
          warnings.push({
            sourceId: s.id,
            reason: n.reason,
            failures: n.failures,
          });
          for (const a of n.articles)
            snapshots.push(
              await this.db.insert("source_snapshots", {
                ...a,
                jobId: job.id,
                expiresAt: new Date(
                  Math.min(
                    Date.parse(a.publishedAt) + sr.maxAgeSeconds * 1000,
                    Date.now() + rules.factsMaxAgeSeconds * 1000,
                  ),
                ).toISOString(),
              }),
            );
        } else if (s.type === "article") {
          const a = await this.article(s.url, s);
          requireThat(
            Date.now() - Date.parse(a.publishedAt) <= sr.maxAgeSeconds * 1000,
            "SOURCE_STALE",
            "新闻超出时间窗口。",
          );
          const related = relatedTokens(a, tokens);
          snapshots.push(
            await this.db.insert("source_snapshots", {
              ...a,
              relatedTokens: related,
              jobId: job.id,
              expiresAt: new Date(
                Math.min(
                  Date.parse(a.publishedAt) + sr.maxAgeSeconds * 1000,
                  Date.now() + rules.factsMaxAgeSeconds * 1000,
                ),
              ).toISOString(),
            }),
          );
        } else throw sourceFault(s.id, new Error("未实现的数据源类型"));
      } catch (e) {
        if (sr.required) throw sourceFault(sr.sourceId, e);
        warnings.push({ sourceId: s.id, error: errorInfo(e) });
      }
    }
    if ((rules.selection === "market_top5" || rules.requiredPercent) && !market)
      throw sourceFault("market");
    const facts = tokens.map((token) => {
      const item = [
        ...(market?.symbols || []),
        ...(market?.topGainers || []),
        ...(market?.topLosers || []),
      ].find((p: Doc) => p.token === token);
      if (rules.requiredPercent)
        requireThat(item, "TOKEN_NOT_IN_MARKET", `${token} 缺少有效行情。`);
      return item
        ? {
            ...item,
            roundedPercent: Number(item.changePercent.toFixed(2)),
            window: "rolling_24h",
            snapshotAt: market!.fetchedAt,
          }
        : { token };
    });
    return { snapshots, tokens, facts, warnings };
  }
}
export function selectTokens(rules: Rules, market?: Doc): string[] {
  if (rules.selection !== "market_top5") return rules.tokens;
  requireThat(
    market,
    "REQUIRED_SOURCE_UNAVAILABLE",
    "榜单预设必须配置行情源。",
  );
  const g = shuffle<Doc>(
      market.topGainers.filter((x: Doc) => x.changePercent > 0),
    ),
    l = shuffle<Doc>(market.topLosers.filter((x: Doc) => x.changePercent < 0));
  const choices: Doc[] = [];
  if (rules.bothSides) {
    requireThat(
      rules.tokenCount >= 2 && g.length && l.length,
      "MARKET_SIDE_UNAVAILABLE",
      "涨跌两榜必须各有可用代币。",
    );
    choices.push(g[0], l[0]);
  }
  for (const x of shuffle([...g, ...l]))
    if (
      choices.length < rules.tokenCount &&
      !choices.some((v) => v.token === x.token)
    )
      choices.push(x);
  requireThat(
    choices.length === rules.tokenCount,
    "MARKET_INSUFFICIENT",
    "榜单中不同代币不足。",
  );
  return shuffle(choices).map((x) => x.token);
}
function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function sourceFault(sourceId: string, e?: any) {
  return new (class extends Error {
    code = "REQUIRED_SOURCE_UNAVAILABLE";
    status = 503;
    retryable = true;
    details = { sourceId, error: e ? errorInfo(e) : undefined };
  })(`必需数据源不可用：${sourceId}`);
}
export function strip(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
