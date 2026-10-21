import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { Doc, Row, hash, now } from "../src/core.js";
import { validate } from "../src/validation.js";

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
