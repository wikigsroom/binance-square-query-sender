import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  Database,
  configFromEnv,
  Doc,
  Fault,
  now,
  passwordHash,
} from "../src/core.js";
import { buildServer } from "../src/server.js";
import { exampleRules } from "../src/rules.js";
import type { SquarePort } from "../src/square.js";

export async function fixture() {
  const parent = path.resolve("data/tests");
  await (await import("node:fs/promises")).mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, "case-"));
  const state: {
    calls: number;
    modelCalls: number;
    imageCalls: number;
    failure: any;
    beforeUpload: (() => Promise<void>) | null;
    badText: boolean;
    modelFailure: boolean;
    reviewFailure: boolean;
    responses: Map<string, Doc>;
    textRequests: Doc[];
    imageRequests: Doc[];
    authorTexts: string[];
  } = {
    calls: 0,
    modelCalls: 0,
    imageCalls: 0,
    failure: null,
    beforeUpload: null,
    badText: false,
    modelFailure: false,
    reviewFailure: false,
    responses: new Map(),
    textRequests: [],
    imageRequests: [],
    authorTexts: [],
  };
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#edb43e" },
  })
    .png()
    .toBuffer();
  const http = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/api/v3/exchangeInfo"))
      return res.end(
        JSON.stringify({
          symbols: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].map((token) => ({
            symbol: `${token}USDT`,
            baseAsset: token,
            quoteAsset: "USDT",
            status: "TRADING",
            isSpotTradingAllowed: true,
          })),
        }),
      );
    if (req.url === "/api/v3/ticker/24hr")
      return res.end(
        JSON.stringify(
          ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].map((token, i) => ({
            symbol: `${token}USDT`,
            priceChangePercent: [12.34, 7.89, 2.34, -1.25, -4.56, -9.87][i],
            quoteVolume: "1000000",
            closeTime: Date.now(),
          })),
        ),
      );
    if (req.url === "/models")
      return res.end(
        JSON.stringify({
          data: [{ id: "fixture-text" }, { id: "fixture-image" }],
        }),
      );
    if (req.url === "/article") {
      res.setHeader("content-type", "text/html");
      return res.end(
        `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: "AAA 计划测试协议升级", datePublished: now(), articleBody: "AAA 团队计划测试新的协议升级。这是一个开发用的新闻数据夹具，测试不代表已正式实施，预计仍需社区讨论。" })}</script></head><body><nav>ZZZ 推荐区</nav><article>AAA 团队计划测试新的协议升级。这是一个开发用的新闻数据夹具，测试不代表已正式实施，预计仍需社区讨论。</article></body></html>`,
      );
    }
    if (req.url === "/jinse")
      return res.end(
        JSON.stringify({
          bottom_id: 0,
          list: [
            {
              lives: [
                {
                  id: 100,
                  content_prefix: "AAA 计划测试协议升级",
                  content:
                    "【AAA 计划测试协议升级】AAA 团队计划测试新的协议升级，目前尚未宣布正式上线。这是一条本地开发快讯样本。",
                  created_at: Math.floor(Date.now() / 1000),
                },
                {
                  id: 101,
                  content_prefix: "以太坊开发进展",
                  content:
                    "【以太坊开发进展】以太坊开发者讨论测试计划，目前仍需观察，不能据此声称已经在主网正式实施。",
                  created_at: Math.floor(Date.now() / 1000),
                },
              ],
            },
          ],
        }),
      );
    if (req.url === "/newsflash") {
      res.setHeader("content-type", "text/html");
      return res.end('<a href="/news/123">AAA 计划测试协议升级</a>');
    }
    if (req.url === "/news/123") {
      res.setHeader("content-type", "text/html");
      return res.end(
        `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: "AAA 计划测试协议升级", datePublished: now(), articleBody: "AAA 团队计划测试新的协议升级，目前尚未宣布正式上线。这是一条本地律动来源开发样本。" })}</script>`,
      );
    }
    let raw = "";
    for await (const c of req) raw += c;
    const b = raw ? JSON.parse(raw) : {};
    if (
      ["/chat/completions", "/responses", "/messages"].includes(req.url || "")
    ) {
      state.textRequests.push({
        path: req.url,
        body: b,
        bearer: !!req.headers.authorization,
        apiKeyHeader: !!req.headers["x-api-key"],
        apiVersion: req.headers["anthropic-version"],
      });
      const end = res.end.bind(res);
      res.end = ((chunk: string) => {
        let payload = JSON.parse(chunk);
        const output = payload.choices?.[0]?.message?.content;
        if (output && req.url === "/responses")
          payload = {
            id: payload.id,
            model: payload.model,
            status: "completed",
            usage: payload.usage,
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: output }],
              },
            ],
          };
        if (output && req.url === "/messages")
          payload = {
            id: payload.id,
            model: payload.model,
            stop_reason: "end_turn",
            usage: payload.usage,
            content: [{ type: "text", text: output }],
          };
        return end(JSON.stringify(payload));
      }) as any;
      const userMessage = (b.input || b.messages).find(
        (m: Doc) => m.role === "user",
      );
      const requested = JSON.parse(userMessage.content);
      if (requested.stage === "review")
        return res.end(
          JSON.stringify({
            id: "fixture-review",
            model: "fixture-review-reported",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    passed: !state.reviewFailure,
                    issues: state.reviewFailure
                      ? [
                          {
                            code: "STYLE",
                            message: "fixture: unsupported conclusion",
                            quote: "涨得猛",
                          },
                        ]
                      : [],
                  }),
                },
              },
            ],
          }),
        );
      state.modelCalls++;
      if (state.modelFailure) {
        res.statusCode = 503;
        return res.end(
          JSON.stringify({
            error: { message: "fixture: temporarily unavailable" },
          }),
        );
      }
      const input = JSON.parse(userMessage.content),
        tokens = input.task.tokens;
      const quotes = input.facts.map(
        (f: Doc) =>
          `$${f.token} ${f.roundedPercent >= 0 ? "+" : ""}${f.roundedPercent.toFixed(2)}%`,
      );
      const text = state.authorTexts.shift() ?? (state.badText
        ? "情绪上来了"
        : state.modelCalls % 2 === 0
          ? `这24小时看得我直挠头：${quotes.join("，")}。\n\n我不想天天追着榜单跑。项目到底做成了什么，得把数据摆出来。拉起来就喊未来、跌下去就说归零，这种故事我真听够了。`
          : `看完这轮24小时榜单，我还是有点不服气。${quotes.join("，")}。\n\n涨得猛就能说明项目好？我更想看真实进展。跌的也别急着判死刑，得拿出具体的东西再聊。${input.task.revision ? "这次先把观察重点留给后续兑现。" : ""}`);
      return res.end(
        JSON.stringify({
          id: `fixture-${state.modelCalls}`,
          model: "fixture-provider-reported",
          usage: { total_tokens: 300 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text,
                  tokens,
                  claims: input.facts.map((f: Doc, i: number) => ({
                    token: f.token,
                    changePercent: f.roundedPercent,
                    quote: quotes[i],
                  })),
                  usedSourceIds: [],
                  newsClaims: [],
                }),
              },
            },
          ],
        }),
      );
    }
    if (req.url === "/images/generations") {
      state.imageRequests.push(b);
      state.imageCalls++;
      return res.end(
        JSON.stringify({
          model: "fixture-image-reported",
          data: [{ b64_json: png.toString("base64") }],
        }),
      );
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as any).port;
  const square: SquarePort = {
    async upload() {
      if (state.beforeUpload) await state.beforeUpload();
      return "https://media.example.invalid/fixture.png";
    },
    async publish(key, text, images) {
      state.calls++;
      if (state.failure) throw state.failure;
      const remoteId = String(100000 + state.calls);
      state.responses.set(remoteId, {
        id: remoteId,
        text,
        tokens: [...text.matchAll(/\$([A-Z0-9]+)/g)].map((m) => m[1]),
        images,
      });
      return {
        id: remoteId,
        url: `https://example.invalid/post/${remoteId}`,
        receipt: { id: remoteId },
        confirmedAt: now(),
      };
    },
    async verify(remoteId) {
      const r = state.responses.get(remoteId);
      if (!r)
        throw new Fault("PUBLIC_POST_UNAVAILABLE", "fixture: not found", 502);
      return r;
    },
  };
  const config = {
    ...configFromEnv(),
    dataDir: dir,
    databaseUrl: "",
    encryptionKey: crypto.randomBytes(32).toString("base64"),
    origin: "http://localhost:4300",
    runWorker: false,
    publishEnabled: true,
    proxy: "",
  };
  const db = await Database.connect(undefined, ":memory:"),
    services = await buildServer(config, { db, square });
  await db.update("sources", "source_binance", {
    url: `http://127.0.0.1:${port}`,
    allowedHosts: ["127.0.0.1"],
    allowPrivateNetwork: true,
  });
  await db.update("sources", "source_blockbeats", { enabled: false });
  await db.update("sources", "source_jinse", { enabled: false });
  const connId = "fixture_connection",
    credential = await db.transaction((t) =>
      services.control.credential(
        t,
        "model",
        connId,
        "fixture-model-key-no-real-value",
      ),
    );
  const connection = await db.insert(
    "connections",
    {
      name: "Fixture connection",
      baseUrl: `http://127.0.0.1:${port}`,
      allowPrivateNetwork: true,
      enabled: true,
      concurrency: 4,
      timeoutMs: 10000,
      credentialId: credential.id,
      credentialMask: credential.mask,
    },
    connId,
  );
  const model = await db.insert("models", {
    name: "Fixture text",
    externalId: "fixture-text",
    type: "text",
    approved: true,
    connectionId: connection.id,
    defaultParameters: {},
    allowedParameters: [],
  });
  const imageModel = await db.insert("models", {
    name: "Fixture image",
    externalId: "fixture-image",
    type: "image",
    family: "gpt-image-2",
    approved: true,
    connectionId: connection.id,
    defaultParameters: {},
    allowedParameters: [],
  });
  let preset = await services.control.savePreset({
    name: "行情与新闻",
    rules: {
      ...exampleRules(model.id),
      image: { ...exampleRules(model.id).image, reuseSeconds: 0 },
    },
  });
  preset = await services.control.publishPreset(preset.id, {
    expectedVersion: preset.version,
  });
  const account = await services.control.createAccount({
    name: "Fixture account",
    apiKey: "fixture-square-key-no-real-value",
    tags: ["test"],
  });
  await services.control.bindings(account.id, {
    expectedVersion: 1,
    bindings: [{ presetId: preset.id, weight: 1, enabled: true }],
  });
  const asset = await services.media.ingest(
    png,
    { name: "Fixture asset" },
    { type: "library" },
  );
  await db.insert("admin_users", {
    username: "owner",
    passwordHash: await passwordHash("fixture-password-1234"),
  });
  async function resume() {
    const r = await db.need("runtime", "main");
    await services.control.runtime({
      expectedVersion: r.version,
      paused: false,
    });
  }
  async function job() {
    await resume();
    return services.control.newJob(account.id, "manual", {
      idempotencyKey: crypto.randomUUID(),
    });
  }
  async function execute() {
    const claimed = await services.pipeline.claim();
    if (!claimed) throw new Error("No job to claim");
    await services.pipeline.run(claimed);
    return db.need("jobs", claimed.id);
  }
  async function close() {
    await services.app.close();
    await db.close();
    await new Promise<void>((r) => http.close(() => r()));
    if (dir.startsWith(parent + path.sep))
      await rm(dir, { recursive: true, force: true });
  }
  return {
    ...services,
    config,
    db,
    account,
    preset,
    model,
    imageModel,
    connection,
    asset,
    state,
    port,
    resume,
    job,
    execute,
    close,
  };
}
