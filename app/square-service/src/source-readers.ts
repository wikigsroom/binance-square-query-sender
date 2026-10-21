import { load } from "cheerio";
import { Doc, Row, Fault, now, hash, requireThat, errorInfo } from "./core.js";
import { Http } from "./http.js";
import {
  parseArticle,
  parseJinse,
  parseFeed,
  parseBlockbeatsChannel,
} from "./news-parsers.js";

export class SourceReaders {
  constructor(private http: Http) {}
  private request(source: Row, url: string, extra: Doc = {}) {
    return this.http.request(
      url,
      {
        headers: {
          "user-agent": "SquareDesk/0.3 (public-news-reader)",
          accept: "application/json,text/html,application/rss+xml",
          language: "cn",
        },
      },
      {
        allowedHosts: source.allowedHosts,
        allowPrivateNetwork: !!source.allowPrivateNetwork,
        timeoutMs: 12000,
        maxBytes: 6 * 1024 * 1024,
        ...extra,
      },
    );
  }
  async market(source: Row) {
    const first = source.url.replace(/\/$/, ""),
      bases = [first];
    if (
      new URL(first).hostname === "api.binance.com" &&
      source.allowedHosts.includes("data-api.binance.vision")
    )
      bases.push("https://data-api.binance.vision");
    const failures: Doc[] = [];
    for (const base of bases) {
      try {
        const compact = /(?:^|\.)(?:binance\.com|binance\.vision)$/.test(
          new URL(base).hostname,
        )
          ? "?permissions=SPOT&showPermissionSets=false"
          : "";
        const [ticker, exchange] = await Promise.all([
          this.request(source, `${base}/api/v3/ticker/24hr`, {
            maxBytes: 12 * 1024 * 1024,
          }),
          this.request(source, `${base}/api/v3/exchangeInfo${compact}`, {
            maxBytes: 24 * 1024 * 1024,
          }),
        ]);
        const tickers = ticker.json(),
          info = exchange.json();
        requireThat(
          Array.isArray(tickers) && Array.isArray(info.symbols),
          "MARKET_INVALID",
          "币安行情响应格式不正确。",
          502,
        );
        const pairs = new Map<string, string>(
          info.symbols
            .filter(
              (s: Doc) =>
                s.status === "TRADING" &&
                s.quoteAsset === "USDT" &&
                s.isSpotTradingAllowed !== false,
            )
            .map((s: Doc) => [s.symbol, s.baseAsset]),
        );
        const symbols = tickers
          .filter(
            (t: Doc) =>
              pairs.has(t.symbol) &&
              Number(t.quoteVolume) > 0 &&
              Number.isFinite(Number(t.priceChangePercent)) &&
              Number.isFinite(Number(t.closeTime)) &&
              Math.abs(Date.now() - Number(t.closeTime)) <= 900000,
          )
          .map((t: Doc) => ({
            token: pairs.get(t.symbol),
            symbol: t.symbol,
            changePercent: Number(t.priceChangePercent),
            quoteVolume: String(t.quoteVolume),
            lastPrice: t.lastPrice === undefined ? null : String(t.lastPrice),
            openTime: t.openTime || null,
            closeTime: Number(t.closeTime),
          }))
          .sort(
            (a: Doc, b: Doc) =>
              b.changePercent - a.changePercent ||
              a.symbol.localeCompare(b.symbol),
          );
        requireThat(
          symbols.length > 0,
          "MARKET_EMPTY_OR_STALE",
          "没有可用且在15分钟以内的 USDT 现货行情。",
          502,
        );
        return {
          type: "market",
          sourceId: source.id,
          name: source.name,
          url: `${base}/api/v3/ticker/24hr`,
          exchangeInfoUrl: `${base}/api/v3/exchangeInfo${compact}`,
          fetchedAt: now(),
          window: "rolling_24h",
          market: "Binance spot USDT",
          symbolsCount: symbols.length,
          symbols,
          topGainers: symbols
            .filter((t: Doc) => t.changePercent > 0)
            .slice(0, 5),
          topLosers: symbols
            .filter((t: Doc) => t.changePercent < 0)
            .slice(-5)
            .reverse(),
          failures,
          rawHash: hash(Buffer.concat([ticker.bytes, exchange.bytes])),
        };
      } catch (e) {
        failures.push({ url: base, ...errorInfo(e) });
        if ((e as any).code === "REMOTE_RATE_LIMITED") throw e;
      }
    }
    throw new Fault(
      "MARKET_READ_FAILED",
      "币安现货读取失败，请查看各接口的具体错误。",
      502,
      { failures },
      true,
    );
  }
  async article(url: string, source: Row) {
    const r = await this.request(source, url);
    return {
      type: "news",
      sourceId: source.id,
      name: source.name,
      ...parseArticle(r.text(), url),
      fetchedAt: now(),
      rawHash: hash(r.bytes),
    };
  }
  async feed(source: Row) {
    if (source.type === "jinse") return this.jinse(source);
    if (source.type === "article") {
      const article = await this.article(source.url, source);
      return {
        type: "news_feed",
        articles: [article],
        fetchedAt: now(),
        transport: "article_html",
        failures: [],
      };
    }
    return this.blockbeats(source);
  }
  private async jinse(source: Row) {
    const official = new URL(source.url).hostname === "www.jinse2.com";
    const articles: Doc[] = [],
      failures: Doc[] = [];
    let cursor = 0;
    for (let page = 0; page < 3; page++) {
      const url = official
        ? `https://api.jinse2.com/noah/v2/lives?limit=20&reading=false&source=web&flag=down&id=${cursor}&category=0`
        : source.url;
      try {
        const r = await this.request(source, url),
          data = r.json(),
          items = parseJinse(data, source.url);
        articles.push(
          ...items.map((a) => ({
            ...a,
            evidenceUrl: url,
            rawHash: hash(r.bytes),
          })),
        );
        const next = Number(data.bottom_id);
        if (
          !official ||
          !items.length ||
          !next ||
          next === cursor ||
          items.some(
            (a) =>
              Date.now() - Date.parse(a.publishedAt) >
              source.maxAgeSeconds * 1000,
          )
        )
          break;
        cursor = next;
      } catch (e) {
        failures.push({ url, ...errorInfo(e) });
        break;
      }
    }
    requireThat(
      articles.length,
      "NEWS_READ_FAILED",
      "金色快讯没有返回可核实的正文与日期。",
      502,
      { failures },
    );
    return this.result(source, articles, "public_api", failures);
  }
  private async blockbeats(source: Row) {
    const official = /^(?:www\.|m\.)?theblockbeats\.info$/.test(
      new URL(source.url).hostname,
    );
    const failures: Doc[] = [];
    if (official && source.allowedHosts.includes("api.theblockbeats.news")) {
      const url = "https://api.theblockbeats.news/v2/rss/newsflash";
      try {
        const r = await this.request(source, url),
          articles = parseFeed(r.text(), url);
        requireThat(
          articles.length,
          "NEWS_FEED_EMPTY",
          "律动官方 RSS 返回空内容；不视为采集成功。",
          502,
        );
        return this.result(
          source,
          articles.map((a) => ({
            ...a,
            evidenceUrl: url,
            rawHash: hash(r.bytes),
          })),
          "official_rss",
          failures,
        );
      } catch (e) {
        failures.push({ url, ...errorInfo(e) });
      }
    }
    if (official && source.allowedHosts.includes("t.me")) {
      const articles: Doc[] = [];
      let cursor = "";
      for (let page = 0; page < 3; page++) {
        const url =
          "https://t.me/s/theblockbeats" + (cursor ? `?before=${cursor}` : "");
        try {
          const r = await this.request(source, url),
            items = parseBlockbeatsChannel(r.text(), url);
          articles.push(
            ...items.map((a) => ({ ...a, rawHash: hash(r.bytes) })),
          );
          const ids = items
              .map((a) => Number(a.externalId.split("/").at(-1)))
              .filter(Number.isFinite),
            next = ids.length ? String(Math.min(...ids)) : "";
          if (
            !items.length ||
            !next ||
            next === cursor ||
            items.some(
              (a) =>
                Date.now() - Date.parse(a.publishedAt) >
                source.maxAgeSeconds * 1000,
            )
          )
            break;
          cursor = next;
        } catch (e) {
          failures.push({ url, ...errorInfo(e) });
          break;
        }
      }
      if (articles.length)
        return this.result(source, articles, "official_channel", failures);
    }
    try {
      const r = await this.request(source, source.url),
        rss = parseFeed(r.text(), source.url);
      if (rss.length)
        return this.result(
          source,
          rss.map((a) => ({
            ...a,
            rawHash: hash(r.bytes),
            evidenceUrl: source.url,
          })),
          "official_rss",
          failures,
        );
      const $ = load(r.text()),
        links = [
          ...new Set(
            $("a[href]")
              .toArray()
              .map((a) => {
                try {
                  return new URL($(a).attr("href") || "", source.url).href;
                } catch {
                  return "";
                }
              })
              .filter((u) => /\/(flash|news)\/\d+/.test(u)),
          ),
        ].slice(0, 10);
      const articles: Doc[] = [];
      for (let i = 0; i < links.length; i += 3) {
        const results = await Promise.allSettled(
          links.slice(i, i + 3).map((url) => this.article(url, source)),
        );
        for (const result of results) {
          if (result.status === "fulfilled") articles.push(result.value);
          else failures.push(errorInfo(result.reason));
        }
      }
      if (articles.length)
        return this.result(source, articles, "article_html", failures);
      failures.push({
        url: source.url,
        code: "NEWS_FORMAT_CHANGED",
        message: "页面中未找到可核实正文与时间的快讯。",
      });
    } catch (e) {
      failures.push({ url: source.url, ...errorInfo(e) });
    }
    throw new Fault(
      "NEWS_READ_FAILED",
      "律动公开来源读取失败；网页、RSS 和官方频道的原因见详情。",
      502,
      { failures },
      true,
    );
  }
  private result(
    source: Row,
    items: Doc[],
    transport: string,
    failures: Doc[],
  ) {
    const articles: Doc[] = [
      ...new Map(
        items.map((a) => [
          a.url,
          {
            ...a,
            type: "news",
            sourceId: source.id,
            name: source.name,
            fetchedAt: now(),
          } as Doc,
        ]),
      ).values(),
    ].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return {
      type: "news_feed",
      sourceId: source.id,
      name: source.name,
      fetchedAt: now(),
      transport,
      articles,
      failures,
    };
  }
}
