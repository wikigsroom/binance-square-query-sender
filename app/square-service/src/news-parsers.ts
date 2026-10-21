import { load } from "cheerio";
import { Doc, requireThat } from "./core.js";

export function cleanText(html: string) {
  const $ = load(String(html || ""));
  $("script, style, nav, aside").remove();
  $("br").replaceWith("\n");
  return $.root().text().replace(/\s+/g, " ").trim();
}

export function newsDate(value: string | number) {
  const raw = String(value || "");
  const ms = /^\d{10,13}$/.test(raw)
    ? Number(raw) * (raw.length === 10 ? 1000 : 1)
    : Date.parse(
        /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
          ? raw.replace(" ", "T") + "+08:00"
          : raw,
      );
  requireThat(
    Number.isFinite(ms) && ms > 0,
    "NEWS_DATE_INVALID",
    "新闻缺少可核实的报道时间。",
    502,
  );
  return {
    publishedAt: new Date(ms).toISOString(),
    publishedDate: new Date(ms + 8 * 3600000).toISOString().slice(0, 10),
    timezone: "Asia/Shanghai",
  };
}

export function safeNewsLink(value: unknown, base: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(String(value || ""), base);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function parseJinse(payload: Doc, home: string) {
  requireThat(
    Array.isArray(payload.list),
    "NEWS_FORMAT_CHANGED",
    "金色快讯响应格式已变化。",
    502,
  );
  return payload.list
    .flatMap((day: Doc) => (Array.isArray(day.lives) ? day.lives : []))
    .flatMap((item: Doc) => {
      try {
        const body = cleanText(item.content || ""),
          title = cleanText(
            item.content_prefix || body.match(/^【([^】]+)】/)?.[1] || "",
          );
        if (!item.id || body.length < 30 || !title) return [];
        return [
          {
            externalId: String(item.id),
            title,
            body,
            ...newsDate(item.created_at),
            url: new URL(`/lives/${item.id}.html`, home).href,
            originalUrl: safeNewsLink(item.link, home),
            importance: Number(item.grade) || null,
            attribution: "金色财经",
            readVia: "public_api",
            eventAt: null,
          },
        ];
      } catch {
        return [];
      }
    });
}

export function parseArticle(html: string, url: string) {
  const $ = load(html),
    entries: Doc[] = [];
  $("script[type='application/ld+json']").each((_i, node) => {
    try {
      const value = JSON.parse($(node).text());
      entries.push(
        ...(Array.isArray(value) ? value : value["@graph"] || [value]),
      );
    } catch {}
  });
  const data =
    entries.find((x) =>
      [x["@type"]]
        .flat()
        .some((v) => ["Article", "NewsArticle", "BlogPosting"].includes(v)),
    ) || {};
  const title = cleanText(
    data.headline ||
      data.name ||
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text(),
  );
  const main = $(
    "article, .article-content, .flash-detail-content, .news-content, .article-detail-content, .js-lives-detail__content",
  ).first();
  const body = cleanText(data.articleBody || main.html() || "");
  const published =
    data.datePublished ||
    $("meta[property='article:published_time']").attr("content") ||
    $("time[datetime]").first().attr("datetime");
  requireThat(
    body.length >= 30 && title && published,
    "ARTICLE_UNREADABLE",
    "无法从正文区域核实新闻内容或日期。",
    502,
    { url },
  );
  return {
    title,
    body: body.slice(0, 18000),
    ...newsDate(published),
    url,
    eventAt: null,
    readVia: "article_html",
  };
}

export function parseFeed(xml: string, base: string) {
  const $ = load(xml, { xmlMode: true });
  return $("item")
    .toArray()
    .flatMap((node) => {
      const item = $(node);
      try {
        const title = cleanText(item.find("title").first().text()),
          body = cleanText(item.find("description").first().text()),
          url = safeNewsLink(item.find("link").first().text(), base);
        if (
          !url ||
          !title ||
          body.length < 30 ||
          /(?:\.{3}|…|阅读全文)\s*$/.test(body)
        )
          return [];
        return [
          {
            title,
            body,
            url,
            ...newsDate(item.find("pubDate").first().text()),
            eventAt: null,
            attribution: "律动",
            readVia: "official_rss",
          },
        ];
      } catch {
        return [];
      }
    });
}

export function parseBlockbeatsChannel(html: string, channelUrl: string) {
  const $ = load(html);
  return $(".tgme_widget_message")
    .toArray()
    .flatMap((node) => {
      const item = $(node),
        content = item.find(".tgme_widget_message_text").first();
      try {
        const links = content
          .find("a[href]")
          .toArray()
          .map((a) => safeNewsLink($(a).attr("href"), channelUrl))
          .filter(Boolean) as string[];
        const url = links.find(
          (v) =>
            /^(?:www\.|m\.)?theblockbeats\.info$/.test(new URL(v).hostname) &&
            /\/(flash|news)\/\d+/.test(new URL(v).pathname),
        );
        const title = cleanText(
          content.find("b, strong").first().html() ||
            content.text().split("\n")[0],
        );
        const body = cleanText(content.html() || "");
        if (!url || !title || body.length < 30 || /(?:\.{3}|…)\s*$/.test(body))
          return [];
        return [
          {
            title: title.replace(/^【|】$/g, "").slice(0, 240),
            body: body.slice(0, 18000),
            url,
            ...newsDate(item.find("time[datetime]").attr("datetime") || ""),
            eventAt: null,
            attribution: "律动",
            readVia: "official_channel",
            evidenceUrl:
              safeNewsLink(
                item.find(".tgme_widget_message_date").attr("href"),
                channelUrl,
              ) || channelUrl,
            externalId: item.attr("data-post") || url,
          },
        ];
      } catch {
        return [];
      }
    });
}

const aliases: Record<string, string[]> = {
  BTC: ["比特币", "Bitcoin"],
  ETH: ["以太坊", "Ethereum"],
  SOL: ["Solana", "索拉纳"],
  BNB: ["BNB Chain", "币安币"],
  ADA: ["Cardano", "艾达币"],
  XRP: ["瑞波", "Ripple"],
  DOGE: ["狗狗币", "Dogecoin"],
  AVAX: ["Avalanche", "雪崩链"],
  LINK: ["Chainlink"],
  DOT: ["Polkadot", "波卡"],
  BCH: ["Bitcoin Cash", "比特币现金"],
  LTC: ["Litecoin", "莱特币"],
  HYPE: ["Hyperliquid"],
  TAO: ["Bittensor"],
  ZEC: ["Zcash"],
  WLD: ["Worldcoin"],
};
export function relatedTokens(article: Doc, tokens: string[]) {
  const text = `${article.title} ${article.body}`;
  return tokens.filter((token) =>
    [token, ...(aliases[token] || [])].some((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /[\u3400-\u9fff]/.test(word)
        ? text.includes(word)
        : new RegExp(
            `(^|[^A-Za-z0-9])${escaped}(?:USDT|USD)?(?=$|[^A-Za-z0-9])`,
            "i",
          ).test(text);
    }),
  );
}
