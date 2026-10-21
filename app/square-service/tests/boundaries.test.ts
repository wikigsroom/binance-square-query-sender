import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fixture } from "./fixture.js";
import { Database, Fault, hash, now } from "../src/core.js";
import { validate } from "../src/validation.js";

test("forged content cannot reuse AI evidence even with a matching forged validation hash", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.job();
  const j = await f.pipeline.claim();
  assert.ok(j);
  const input = await f.sources.collect(j),
    generated = await f.ai.text(j, input, []),
    text = generated.content.text + "改";
  const content = await f.db.insert("content_versions", {
    ...generated.content,
    id: undefined,
    jobId: j.id,
    text,
    contentHash: hash(text),
    generationRunId: generated.run.id,
  });
  const validation = await f.db.insert("validation_runs", {
    jobId: j.id,
    contentId: content.id,
    presetVersionId: j.presetVersionId,
    contentHash: content.contentHash,
    passed: true,
    semanticReview: await f.ai.review(j, content, input, []),
  });
  await assert.rejects(
    () => f.pipeline.gate(j, content, validation, input, f.asset, false),
    { code: "CONTENT_HASH_MISMATCH" },
  );
  assert.equal(f.state.calls, 0);
});
test("stale facts are checked again at the last gate", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.job();
  const j = await f.pipeline.claim();
  assert.ok(j);
  const input = await f.sources.collect(j),
    { content } = await f.ai.text(j, input, []);
  const stale = await f.db.insert("source_snapshots", {
    jobId: j.id,
    type: "market",
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  const validation = await f.db.insert("validation_runs", {
    jobId: j.id,
    contentId: content.id,
    presetVersionId: j.presetVersionId,
    contentHash: content.contentHash,
    passed: true,
    semanticReview: await f.ai.review(j, content, input, []),
  });
  await assert.rejects(
    () =>
      f.pipeline.gate(
        j,
        content,
        validation,
        { ...input, snapshots: [stale] },
        f.asset,
        false,
      ),
    { code: "FACTS_STALE" },
  );
  assert.equal(f.state.calls, 0);
});
test("correctly assigned coin percentages and proposal progress are required", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const j = await f.control.newJob(null, "preview", { presetId: f.preset.id }),
    input = await f.sources.collect(j),
    { content } = await f.ai.text(j, input, []),
    r = await f.db.need("runtime", "main");
  const bad = {
    ...content,
    claims: content.claims.map((c: any, i: number) => ({
      ...c,
      changePercent: i === 0 ? 1234 : c.changePercent,
    })),
  };
  assert.ok(
    validate(bad, j.rules, input, [], r.globalBannedWords).errors.some(
      (e: any) => e.code === "FACT_VALUE",
    ),
  );
  const source = {
    id: "news_fixture",
    type: "news",
    name: "律动",
    publishedAt: now(),
    body: "AAA 团队计划测试升级。",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const date = new Date(),
    text = `律动${date.getUTCMonth() + 1}月${date.getUTCDate()}日：AAA 团队正式实施升级。`;
  const c = {
    ...content,
    text,
    contentHash: hash(text),
    usedSourceIds: [source.id],
    newsClaims: [
      {
        sourceId: source.id,
        quote: "AAA 团队正式实施升级。",
        evidenceQuote: source.body,
      },
    ],
  };
  assert.ok(
    validate(
      c,
      j.rules,
      { ...input, snapshots: [source] },
      [],
      r.globalBannedWords,
    ).errors.some((e: any) => e.code === "NEWS_PROGRESS"),
  );
});
test("article extraction ignores unrelated navigation; image bytes cannot be silently replaced", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const source = await f.db.insert("sources", {
    name: "Fixture article",
    url: `http://127.0.0.1:${f.port}/article`,
    allowedHosts: ["127.0.0.1"],
    allowPrivateNetwork: true,
  });
  const article = await f.sources.article(source.url, source);
  assert.ok(article.body.includes("计划测试"));
  assert.ok(!article.body.includes("ZZZ"));
  await writeFile(
    path.join(f.config.dataDir, "assets", f.asset.storageKey),
    "tampered",
  );
  await assert.rejects(() => f.media.bytes(f.asset), {
    code: "ASSET_PROVENANCE_INVALID",
  });
});
test("unavailable model retries a bounded step without a local text fallback", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.modelFailure = true;
  await f.job();
  const j = await f.execute();
  assert.equal(j.state, "retry_wait");
  assert.ok(j.retryAt);
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("content_versions")).length, 0);
  assert.equal(
    (await f.db.list("generation_runs"))[0].error.details.httpStatus,
    503,
  );
});
test("unknown submission can be reconciled through matching public data without another publish", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.failure = new Fault("UPSTREAM_NETWORK_ERROR", "fixture timeout", 502);
  await f.job();
  const j = await f.execute(),
    content = await f.db.need("content_versions", j.contentId),
    intent = (await f.db.list("publish_attempts"))[0];
  f.state.responses.set("987654", {
    id: "987654",
    text: content.text,
    tokens: content.tokens,
    images: [intent.imageUrl],
  });
  const result = await f.pipeline.reconcile(j.id, "987654");
  assert.equal(result.state, "published");
  assert.equal(f.state.calls, 1);
  assert.equal((await f.db.need("accounts", f.account.id)).blockReason, null);
});
test("one rejected account does not stop another account", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const b = await f.control.createAccount({
    name: "Second",
    apiKey: "fixture-second-square-key",
  });
  await f.control.bindings(b.id, {
    expectedVersion: 1,
    bindings: [{ presetId: f.preset.id, weight: 1, enabled: true }],
  });
  await f.job();
  f.state.failure = new Fault(
    "ACCOUNT_CREDENTIAL_INVALID",
    "fixture auth rejection",
    502,
    { definitelyRejected: true },
  );
  await f.execute();
  f.state.failure = null;
  await f.control.newJob(b.id, "manual", {
    idempotencyKey: "second-account-manual",
  });
  const done = await f.execute();
  assert.equal(done.state, "published", JSON.stringify(done.error));
  assert.equal((await f.db.need("accounts", b.id)).blockReason, null);
});
test("AI review refusal is repaired only by the model and never submitted after exhaustion", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.reviewFailure = true;
  await f.job();
  const j = await f.execute();
  assert.equal(j.state, "failed");
  assert.equal(f.state.calls, 0);
  assert.equal(f.state.modelCalls, j.rules.repairAttempts + 1);
  assert.ok(
    (await f.db.list("validation_runs")).every(
      (v) => !v.passed && v.semanticReview.runId,
    ),
  );
});
test("generated image aspect ratio is checked against bytes before publication", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const j = await f.media.createJob({
    modelId: f.imageModel.id,
    prompt: "fixture landscape",
    requestedAspectRatio: "16:9",
  });
  await assert.rejects(() => f.media.generate(j), {
    code: "IMAGE_ASPECT_RATIO_MISMATCH",
  });
  assert.equal((await f.db.need("image_jobs", j.id)).state, "failed");
  assert.equal(f.state.calls, 0);
});
test("file-backed development database preserves records across close and reopen", async () => {
  const root = path.resolve("data/tests"),
    directory = path.join(root, `persistence-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const first = await Database.connect(undefined, directory);
  await first.insert(
    "runtime",
    { paused: true, nextDueAt: "2099-01-01T00:00:00.000Z" },
    "persistence",
  );
  await first.close();
  const second = await Database.connect(undefined, directory);
  try {
    assert.equal(
      (await second.need("runtime", "persistence")).nextDueAt,
      "2099-01-01T00:00:00.000Z",
    );
  } finally {
    await second.close();
    if (directory.startsWith(root + path.sep))
      await rm(directory, { recursive: true, force: true });
  }
});
