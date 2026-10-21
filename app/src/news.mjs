import { config } from './config.mjs';

const HOST = 'https://www.theblockbeats.info';
const USER_AGENT = 'binance-square-autoposter/1.0 (public-news-reader)';

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonLd(html) {
  const results = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1].trim());
      if (Array.isArray(value)) results.push(...value);
      else results.push(value);
    } catch { /* Some pages contain malformed analytics JSON-LD. */ }
  }
  return results.flatMap(value => value?.['@graph'] ?? value).filter(Boolean);
}

function absoluteUrl(value) {
  try {
    const url = new URL(value, HOST);
    return url.hostname === 'www.theblockbeats.info' ? url.href : null;
  } catch { return null; }
}

function collectLinks(html) {
  const links = [];
  for (const match of html.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(match[1]);
    const text = stripHtml(match[2]);
    if (url && /\/news\/\d+|\/flash\/\d+/.test(new URL(url).pathname)) links.push({ url, anchor: text });
  }
  return links;
}

async function readPage(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });
  if (!response.ok) throw new Error(`BlockBeats HTTP ${response.status}`);
  const html = await response.text();
  const structured = parseJsonLd(html);
  const article = structured.find(value => ['NewsArticle', 'Article'].includes(value?.['@type'])) ?? {};
  const body = stripHtml(html).slice(0, 10000);
  return {
    url, title: article.headline || article.name || '', publishedAt: article.datePublished || null,
    modifiedAt: article.dateModified || null, description: article.description || '', body,
  };
}

function isRecent(date) {
  const timestamp = Date.parse(date || '');
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
}

function relevant(article, tokens) {
  const haystack = `${article.title} ${article.description} ${article.body}`.toUpperCase();
  return tokens.filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Require a token boundary so symbols such as W and S do not match
    // ordinary words like "Wang" or the plural possessive suffix.
    return new RegExp(`(?:\\$|\\b)${escaped}(?:USDT|USD|\\b)`, 'i').test(haystack);
  });
}

export async function collectNews(tokens) {
  const checkedAt = new Date().toISOString();
  try {
    const homeResponse = await fetch(`${HOST}/newsflash`, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(config.llmTimeoutMs),
    });
    if (!homeResponse.ok) throw new Error(`BlockBeats newsflash HTTP ${homeResponse.status}`);
    const home = await homeResponse.text();
    const links = [...new Map(collectLinks(home).map(link => [link.url, link])).values()]
      .slice(0, config.newsMaxLinks);
    const pages = await Promise.allSettled(links.map(link => readPage(link.url)));
    const directItems = [];
    const sectorItems = [];
    for (const result of pages) {
      if (result.status !== 'fulfilled' || !isRecent(result.value.publishedAt)) continue;
      const relatedTokens = relevant(result.value, tokens);
      const item = {
        id: `blockbeats-${Buffer.from(result.value.url).toString('base64url').slice(-20)}`,
        source: '区块律动（BlockBeats）', title: result.value.title || result.value.description,
        url: result.value.url, publishedAt: result.value.publishedAt, eventAt: null,
        checkedAt, relatedTokens, relationship: relatedTokens.length ? '直接' : '板块',
        facts: [result.value.description || result.value.body.slice(0, 500)], usedBy: [],
      };
      (relatedTokens.length ? directItems : sectorItems).push(item);
    }
    const items = [...directItems, ...sectorItems.slice(0, 4)].slice(0, 12);
    return {
      checkedAt, items,
      reason: items.length ? null : '近7天可读取的律动页面中未找到正文明确提及所选代币的消息；本轮可仅依据行情写作。',
    };
  } catch (error) {
    return { checkedAt, items: [], reason: `律动公开页面读取失败（${error.message}）；本轮可仅依据行情写作。` };
  }
}
