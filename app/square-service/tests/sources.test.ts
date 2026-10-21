import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixture } from "./fixture.js";
import { Http } from "../src/http.js";
import { SourceReaders } from "../src/source-readers.js";
import { Sources } from "../src/sources.js";
import { Doc, Row, Fault, hash, now } from "../src/core.js";
import {
  parseJinse,
  parseBlockbeatsChannel,
  parseFeed,
  newsDate,
  relatedTokens,
} from "../src/news-parsers.js";
import { validate } from "../src/validation.js";
import { ensureSources } from "../src/source-catalog.js";

const response = (value: any) => ({
  bytes: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
  json: () => value,
  text: () => (typeof value === "string" ? value : JSON.stringify(value)),
});
const row = (data: Doc) =>
  ({
    id: "test_source",
    name: "测试新闻",
    enabled: true,
    maxAgeSeconds: 259200,
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    ...data,
  }) as Row;
const jinse = () => ({
  bottom_id: 0,
  list: [
    {
      lives: [
        {
          id: 101,
          content_prefix: "以太坊计划测试升级",
          content:
            "【以太坊计划测试升级】以太坊开发者计划测试新的协议升级，当前仍处于讨论阶段，尚未宣布正式上线。",
          created_at: Math.floor(Date.now() / 1000),
          link: "https://example.com/announcement",
        },
        {
          id: 102,
          content_prefix: "比特币链上数据更新",
          content:
            "【比特币链上数据更新】比特币链上统计数据公布，相关指标仍需结合统计口径进一步观察，不能直接推断价格。",
          created_at: Math.floor(Date.now() / 1000),
        },
      ],
    },
  ],
});

test("Binance reads exchange metadata above 8 MB and excludes inactive, non-spot, stale and empty pairs", async (t) => {
  const symbols = [
    "AAA",
    "BBB",
    "CCC",
    "HALT",
    "FUT",
    "OLD",
    "ZERO",
    "NAN",
  ].map((token) => ({
    symbol: `${token}USDT`,
    baseAsset: token,
    quoteAsset: "USDT",
    status: token === "HALT" ? "BREAK" : "TRADING",
    isSpotTradingAllowed: token !== "FUT",
  }));
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/api/v3/exchangeInfo"))
      res.end(
        JSON.stringify({ symbols, padding: "x".repeat(9 * 1024 * 1024) }),
      );
    else
      res.end(
        JSON.stringify(
          symbols.map((s, i) => ({
            symbol: s.symbol,
            quoteVolume: s.baseAsset === "ZERO" ? "0" : "12345",
            priceChangePercent:
              s.baseAsset === "NAN"
                ? "oops"
                : [8.2, -4, 1.5, 500, 600, 700, 800, 900][i],
            closeTime: Date.now() - (s.baseAsset === "OLD" ? 3600000 : 0),
            lastPrice: "1.23",
          })),
        ),
      );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const http = new Http(),
    port = (server.address() as any).port;
  t.after(async () => {
    await http.close();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const market = await new SourceReaders(http).market(
    row({
      type: "binance_market",
      url: `http://127.0.0.1:${port}`,
      allowedHosts: ["127.0.0.1"],
      allowPrivateNetwork: true,
    }),
  );
  assert.equal(market.symbolsCount, 3);
  assert.deepEqual(
    market.topGainers.map((r) => r.token),
    ["AAA", "CCC"],
  );
  assert.deepEqual(
    market.topLosers.map((r) => r.token),
    ["BBB"],
  );
  assert.equal(market.window, "rolling_24h");
  assert.equal(market.symbols[0].lastPrice, "1.23");
});

test("Binance uses its official data endpoint on network failure and keeps a compact exchange query", async () => {
  const calls: { url: string; policy: Doc }[] = [];
  const http = {
    request: async (url: string, _options: Doc, policy: Doc) => {
      calls.push({ url, policy });
      if (url.startsWith("https://api.binance.com"))
        throw new Fault(
          "UPSTREAM_NETWORK_ERROR",
          "fixture network failure",
          502,
        );
      return response(
        url.includes("exchangeInfo")
          ? {
              symbols: [
                {
                  symbol: "AAAUSDT",
                  baseAsset: "AAA",
                  quoteAsset: "USDT",
                  status: "TRADING",
                },
              ],
            }
          : [
              {
                symbol: "AAAUSDT",
                priceChangePercent: "5",
                quoteVolume: "100",
                closeTime: Date.now(),
              },
            ],
      );
    },
  } as unknown as Http;
  const m = await new SourceReaders(http).market(
    row({
      url: "https://api.binance.com",
      allowedHosts: ["api.binance.com", "data-api.binance.vision"],
    }),
  );
  assert.ok(m.url.startsWith("https://data-api.binance.vision/"));
  assert.ok(
    calls.some(
      (c) =>
        c.url.includes("showPermissionSets=false") &&
        c.policy.maxBytes > 8 * 1024 * 1024,
    ),
  );
  assert.equal(m.failures[0].code, "UPSTREAM_NETWORK_ERROR");
});

test("Jinse parses full news and epochs safely, matches aliases, and rejects malformed dates", () => {
  const news = parseJinse(jinse(), "https://www.jinse2.com/lives");
  assert.equal(news.length, 2);
  assert.equal(news[0].url, "https://www.jinse2.com/lives/101.html");
  assert.deepEqual(relatedTokens(news[0], ["ETH", "BTC", "S"]), ["ETH"]);
  assert.equal(news[0].attribution, "金色财经");
  assert.equal(news[1].originalUrl, null);
  assert.equal(
    newsDate("2026-10-22 00:05:00").publishedAt,
    "2026-10-21T16:05:00.000Z",
  );
  assert.equal(newsDate("2026-10-22 00:05:00").publishedDate, "2026-10-22");
  assert.throws(() => parseJinse({ list: {} }, "https://www.jinse2.com"), {
    code: "NEWS_FORMAT_CHANGED",
  });
  const invalid = jinse();
  invalid.list[0].lives[0].created_at = NaN;
  assert.equal(parseJinse(invalid, "https://www.jinse2.com").length, 1);
});

test("BlockBeats RSS/channel retain attributable body, precise date and actual evidence URL", () => {
  const body =
    "BlockBeats 消息，Solana 团队计划测试新升级，仍需要继续观察测试结果，不能据此声称已正式上线。";
  const html = `<div class="tgme_widget_message" data-post="theblockbeats/123"><div class="tgme_widget_message_text"><b>Solana 升级测试</b><br>${body}<a href="https://m.theblockbeats.info/flash/123?from=telegram">原文链接</a></div><a class="tgme_widget_message_date" href="https://t.me/theblockbeats/123"><time datetime="2026-10-21T17:01:00+00:00"></time></a></div>`;
  const items = parseBlockbeatsChannel(html, "https://t.me/s/theblockbeats");
  assert.equal(items.length, 1);
  assert.ok(items[0].body.includes(body));
  assert.equal(items[0].publishedDate, "2026-10-22");
  assert.equal(items[0].evidenceUrl, "https://t.me/theblockbeats/123");
  assert.deepEqual(relatedTokens(items[0], ["SOL", "W"]), ["SOL"]);
  const feed = parseFeed(
    `<rss><channel><item><title>Solana 升级测试</title><description><![CDATA[${body}]]></description><link>https://m.theblockbeats.info/flash/123</link><pubDate>Thu, 22 Oct 2026 01:01:00 +0800</pubDate></item></channel></rss>`,
    "https://api.theblockbeats.news/v2/rss/newsflash",
  );
  assert.equal(feed.length, 1);
  assert.equal(feed[0].body, body);
  assert.equal(
    parseFeed('{"status":0,"data":[]}', "https://example.com").length,
    0,
  );
});

test("shared source reads coalesce concurrent accounts and retain failure evidence without serving stale success", async (t) => {
  const f = await fixture();
  t.after(f.close);
  let calls = 0,
    failed = false;
  const http = {
    request: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      if (failed)
        throw new Fault(
          "UPSTREAM_NETWORK_ERROR",
          "fixture source offline",
          502,
        );
      return response(jinse());
    },
  } as unknown as Http;
  const sources = new Sources(f.db, http),
    source = row({
      type: "jinse",
      url: "https://example.com/lives",
      allowedHosts: ["example.com"],
    });
  const [a, b] = await Promise.all([
    sources.news(source, ["ETH"], 259200),
    sources.news(source, ["BTC"], 259200),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a.articles[0].relatedTokens, ["ETH"]);
  assert.deepEqual(b.articles[0].relatedTokens, ["BTC"]);
  const restarted = new Sources(f.db, http);
  const search = await restarted.content(source, {
    q: "升级",
    tokens: "ETH",
    hours: "24",
  });
  assert.equal(calls, 1);
  assert.equal(search.total, 1);
  assert.equal(search.cached, true);
  failed = true;
  await assert.rejects(() => restarted.read(source, true), {
    code: "NEWS_READ_FAILED",
  });
  const read = await f.db.need("source_reads", source.id);
  assert.equal(read.status, "failed");
  assert.ok(read.lastSuccessAt);
  assert.ok(
    read.error.details.failures[0].message.includes("fixture source offline"),
  );
  await assert.rejects(() => restarted.content(source, {}), {
    code: "NEWS_READ_FAILED",
  });
  assert.equal(calls, 2);
  assert.equal(f.state.calls, 0);
});

test("default source upgrade preserves user settings and Jinse enters immutable job evidence", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const s = await f.db.need("sources", "source_blockbeats");
  await f.db.update("sources", s.id, {
    enabled: false,
    name: "我自己的律动名称",
    adapterVersion: null,
    allowedHosts: ["www.theblockbeats.info"],
  });
  await f.db.transaction(ensureSources);
  const upgraded = await f.db.need("sources", s.id);
  assert.equal(upgraded.enabled, false);
  assert.equal(upgraded.name, "我自己的律动名称");
  assert.ok(upgraded.allowedHosts.includes("t.me"));
  const market = await f.sources.market(
    await f.db.need("sources", "source_binance"),
  );
  assert.equal(market.symbolsCount, 6);
  const j = await f.job();
  const key = await f.db.need("sources", "source_jinse");
  await f.db.update("sources", key.id, {
    enabled: true,
    url: `http://127.0.0.1:${f.port}/jinse`,
    allowedHosts: ["127.0.0.1"],
    allowPrivateNetwork: true,
  });
  const input = await f.sources.collect({
    ...j,
    rules: {
      ...j.rules,
      selection: "fixed",
      tokens: ["AAA"],
      tokenCount: 1,
      bothSides: false,
    },
  });
  assert.equal(input.tokens[0], "AAA");
  assert.ok(input.snapshots.some((r) => r.sourceId === "source_jinse"));
  assert.equal(input.facts[0].changePercent, 12.34);
});

test("source API exposes persisted status, content filters, input errors and isolates bulk failures", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const login = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: f.config.origin },
    payload: { username: "owner", password: "fixture-password-1234" },
  });
  const headers = {
    cookie: `square_session=${login.cookies[0].value}`,
    origin: f.config.origin,
    "x-csrf-token": login.json().data.csrf,
  };
  const unauth = await f.app.inject({
    url: "/api/v1/data-sources/source_binance/content",
  });
  assert.equal(unauth.statusCode, 401);
  const catalog = await f.app.inject({
    url: "/api/v1/data-sources/catalog",
    headers,
  });
  assert.ok(catalog.json().data.some((s: Doc) => s.type === "jinse"));
  const bad = await f.app.inject({
    method: "POST",
    url: "/api/v1/data-sources",
    headers: { ...headers, "idempotency-key": "source-invalid-url" },
    payload: { type: "article", url: "not a url" },
  });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().error.code, "INVALID_SOURCE");
  const probe = await f.app.inject({
    method: "POST",
    url: "/api/v1/data-sources/source_binance/probe",
    headers,
    payload: {},
  });
  assert.equal(probe.statusCode, 200);
  const filtered = await f.app.inject({
    url: "/api/v1/data-sources/source_binance/content?tokens=AAA",
    headers,
  });
  assert.equal(filtered.json().data.items.length, 1);
  const list = await f.app.inject({ url: "/api/v1/data-sources", headers });
  assert.equal(
    list.json().data.find((s: Doc) => s.id === "source_binance").lastRead
      .status,
    "healthy",
  );
  await f.db.update("sources", "source_jinse", {
    enabled: true,
    url: `http://127.0.0.1:${f.port}/missing`,
    allowPrivateNetwork: true,
    allowedHosts: ["127.0.0.1"],
  });
  const bulk = await f.app.inject({
    method: "POST",
    url: "/api/v1/data-sources/probe-all",
    headers,
    payload: {},
  });
  assert.equal(bulk.statusCode, 200);
  assert.equal(
    bulk.json().data.find((s: Doc) => s.sourceId === "source_binance").ok,
    true,
  );
  assert.equal(
    bulk.json().data.find((s: Doc) => s.sourceId === "source_jinse").ok,
    false,
  );
  assert.equal(f.state.modelCalls, 0);
  assert.equal(f.state.calls, 0);
});

test("news attribution uses the publisher's China date rather than the previous UTC date", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const j = await f.job(),
    input = await f.sources.collect(j);
  const source = {
    id: "news_midnight",
    type: "news",
    name: "自定义金色名称",
    attribution: "金色财经",
    publishedAt: "2026-10-21T16:05:00.000Z",
    publishedDate: "2026-10-22",
    body: "以太坊开发者计划测试新的协议升级。",
  };
  const text = "金色财经10月22日报道，以太坊开发者计划测试新的协议升级。";
  const result = validate(
    row({
      text,
      tokens: input.tokens,
      claims: [],
      contentHash: hash(text),
      usedSourceIds: [source.id],
      newsClaims: [
        {
          sourceId: source.id,
          quote: "以太坊开发者计划测试新的协议升级。",
          evidenceQuote: source.body,
        },
      ],
    }),
    j.rules,
    { ...input, snapshots: [source] },
    [],
    [],
  );
  assert.ok(
    !result.errors.some((e: Doc) =>
      ["NEWS_DATE", "NEWS_ATTRIBUTION"].includes(e.code),
    ),
  );
});
