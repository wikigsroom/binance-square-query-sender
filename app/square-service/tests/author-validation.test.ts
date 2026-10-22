import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { Doc, Row, hash, now } from "../src/core.js";
import { validate } from "../src/validation.js";
import { writingHistory } from "../src/writing-context.js";

test("author receives literal required tags, conditional market claims and complete prior draft", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const job = await f.job();
  const input = await f.sources.collect(job);
  const previousDraft = {
    text: "标签遗漏的测试稿",
    tokens: input.tokens,
    claims: [],
    usedSourceIds: ["news_correct"],
    newsClaims: [
      { sourceId: "news_correct", quote: "测试稿", evidenceQuote: "原文" },
    ],
  };
  const messages = f.ai.prompt(job, input, [], {
    previousDraft,
    errors: [{ code: "TOKEN_TAGS" }],
  });
  const request = JSON.parse(messages[1].content);
  assert.deepEqual(
    request.task.requiredCashtags,
    input.tokens.map((token: string) => `$${token}`),
  );
  assert.equal(request.outputContract.exactCashtagCount, input.tokens.length);
  assert.equal(request.outputContract.marketClaims.length, input.tokens.length);
  assert.deepEqual(request.repairErrors.previousDraft, previousDraft);
  const withoutPercent = JSON.parse(
    f.ai.prompt(
      { ...job, rules: { ...job.rules, requiredPercent: false } },
      input,
      [],
      null,
    )[1].content,
  );
  assert.deepEqual(withoutPercent.outputContract.marketClaims, []);
  assert.equal(withoutPercent.outputContract.requiredPercent, false);
  assert.ok(messages[0].content.includes("不能把一条新闻的证据挂到另一条新闻"));
});

test("wrong news ID remains rejected with exact evidence location available for model repair", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const job = await f.job();
  const input = await f.sources.collect(job);
  const date = now().slice(0, 10);
  const quote = "律动" + date.slice(5) + "报道，Kalshi 与 BitGo 达成新协议。";
  const evidenceQuote = "Kalshi 与 BitGo 达成新协议。";
  const source = (id: string, title: string, body: string) =>
    ({
      id,
      title,
      body,
      name: "律动",
      type: "news",
      version: 1,
      createdAt: now(),
      updatedAt: now(),
      publishedAt: now(),
      publishedDate: date,
    }) as Row;
  const news = [
    source("news_kalshi", "Kalshi 抵押借款", evidenceQuote),
    source("news_mask", "MASK 交易数据", "MASK 的一条无关快讯。"),
  ];
  const text = `${quote}\n${input.tokens.map((token: string) => `$${token}`).join("、")}`;
  const content = {
    text,
    contentHash: hash(text),
    tokens: input.tokens,
    claims: [],
    usedSourceIds: ["news_mask"],
    newsClaims: [{ sourceId: "news_mask", quote, evidenceQuote }],
  } as unknown as Row;
  const result = validate(
    content,
    { ...job.rules, requiredPercent: false },
    { ...input, snapshots: news },
    [],
    [],
  );
  const issue = result.errors.find((e: Doc) => e.code === "NEWS_EVIDENCE");
  assert.equal(result.passed, false);
  assert.equal(issue.field, "evidenceQuote");
  assert.equal(issue.sourceId, "news_mask");
  assert.equal(issue.sourceTitle, "MASK 交易数据");
  assert.deepEqual(issue.matchingSourceIds, ["news_kalshi"]);
  const corrected = {
    ...content,
    usedSourceIds: ["news_kalshi"],
    newsClaims: [{ sourceId: "news_kalshi", quote, evidenceQuote }],
  };
  assert.equal(
    validate(
      corrected,
      { ...job.rules, requiredPercent: false },
      { ...input, snapshots: news },
      [],
      [],
    ).passed,
    true,
  );
  corrected.newsClaims[0].quote = "并不存在于成稿的改写句";
  assert.ok(
    validate(
      corrected,
      { ...job.rules, requiredPercent: false },
      { ...input, snapshots: news },
      [],
      [],
    ).errors.some(
      (e: Doc) => e.code === "NEWS_EVIDENCE" && e.field === "quote",
    ),
  );
});

test("job detail exposes failed validation history even for records without a validation link", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.badText = true;
  await f.job();
  const done = await f.execute();
  await f.db.update("jobs", done.id, { validationId: null });
  const login = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: f.config.origin },
    payload: { username: "owner", password: "fixture-password-1234" },
  });
  const response = await f.app.inject({
    url: `/api/v1/publication-jobs/${done.id}`,
    headers: { cookie: `square_session=${login.cookies[0].value}` },
  });
  assert.equal(response.statusCode, 200);
  const detail = response.json().data;
  assert.equal(detail.validation.id, done.error.details.validationId);
  assert.equal(detail.validation.contentId, done.contentId);
  assert.equal(detail.validationHistory.length, jobAttempts(done));
  assert.equal(detail.validation.passed, false);
  assert.equal(f.state.calls, 0);
});

function jobAttempts(job: Row) {
  return job.rules.repairAttempts + 1;
}

test("writing and review requests exclude image configuration and contaminated examples while images retain their brief", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const base = await f.job();
  const imageMarker = "IMAGE_ONLY_SENTINEL_FOR_WIRE_ISOLATION";
  const job = {
    ...base,
    rules: {
      ...base.rules,
      image: { ...base.rules.image, mode: "generate", modelId: f.imageModel.id, prompt: imageMarker, style: imageMarker },
      futureImagePolicy: { prompt: imageMarker },
    },
  };
  const input = await f.sources.collect(job);
  const clean = "我想看项目的实际进展，价格本身不能说明用户会留下。";
  const history = [
    { text: "行业梗图：一只戴工牌的河狸策划，把流程图贴满墙。\n\n这段是已发布的错误示例。" },
    { text: "先看数据。\n\n梗图可以画一只认真打工的水獭。" },
    { text: "四格梗图：第一格等需求，最后一格又改回第一稿。" },
    { text: clean },
  ].map((row, index) => ({ ...row, id: `history_${index}`, version: 1, createdAt: now(), updatedAt: now() }));
  const { content } = await f.ai.text(job, input, history);
  await f.ai.review(job, content, input, history);
  assert.equal(f.state.textRequests.length, 2);
  for (const wire of f.state.textRequests) {
    const messages = wire.body.messages;
    const data = JSON.parse(messages.find((m: Doc) => m.role === "user").content);
    assert.equal(data.rules.image, undefined);
    assert.equal(data.rules.futureImagePolicy, undefined);
    assert.equal(data.rules.modelId, undefined, "transport settings stay outside writing rules");
    assert.equal(data.rules.direction, job.rules.direction);
    assert.equal(data.rules.maxChars, job.rules.maxChars);
    assert.equal(data.rules.tone, job.rules.tone);
    assert.ok(!JSON.stringify(wire.body).includes(imageMarker));
    assert.deepEqual(data.previousPostsForDiversityOnly || data.historyForDiversityOnly, [clean]);
    assert.ok(messages[0].content.includes("正文") && messages[0].content.includes("配图说明"));
  }
  assert.equal(f.state.imageCalls, 0);
  await f.media.choose(job);
  assert.equal(f.state.imageCalls, 1);
  assert.ok(f.state.imageRequests[0].prompt.includes(imageMarker), "image instructions reach only the image model");
  assert.equal(job.rules.image.prompt, imageMarker, "the frozen preset must not be mutated");
  assert.equal(f.state.calls, 0);
});

test("history filtering retains normal meme discussion and does not alter stored examples", () => {
  const rows = [
    { text: "我觉得这轮Meme热度得看真实使用，不能只看梗图传播。" },
    { text: "**配图说明：**两名同事围着表格争论。" },
    { text: "Image prompt: an animal in an office" },
    { text: "梗图可以画成一位快递员寻找门牌。" },
  ].map((row, index) => ({ ...row, id: `history_${index}`, version: 1, createdAt: now(), updatedAt: now() }));
  assert.deepEqual(writingHistory(rows), [rows[0].text]);
  assert.ok(rows[1].text.startsWith("**配图说明"));
});
