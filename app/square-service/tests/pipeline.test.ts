import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { Fault, hash, now } from "../src/core.js";

test("AI provenance + image pipeline publishes once and verifies separately", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const j = await f.job(),
    done = await f.execute();
  assert.equal(done.state, "published");
  assert.equal(f.state.calls, 1);
  assert.ok(f.state.modelCalls >= 1);
  const p = (await f.db.list("posts"))[0];
  assert.equal(p.verificationStatus, "pending");
  const v = await f.pipeline.verify(p.id);
  assert.equal(v.status, "verified");
  assert.equal(f.state.calls, 1);
  const replay = await f.control.newJob(f.account.id, "manual", {
    idempotencyKey: j.idempotencyScope.split(":").at(-1),
  });
  assert.equal(replay.id, j.id);
  assert.equal((await f.db.need("schedules", f.account.id)).enabled, false);
  const c = await f.db.need("content_versions", p.contentId),
    run = await f.db.need("generation_runs", c.generationRunId);
  assert.equal(c.contentHash, hash(c.text));
  assert.ok(run.messages[0].content.includes("情绪"));
  assert.equal(run.reportedModel, "fixture-provider-reported");
  assert.equal(run.requestUrl, `http://127.0.0.1:${f.port}/chat/completions`);
  const endpoint = run.requestUrl;
  await f.db.update("connections", f.connection.id, {
    baseUrl: "http://127.0.0.1:1",
  });
  assert.equal(
    (await f.db.need("generation_runs", run.id)).requestUrl,
    endpoint,
  );
});
test("bad text repairs finitely then stops with no upload/publish", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.badText = true;
  await f.job();
  const done = await f.execute();
  assert.equal(done.state, "failed", JSON.stringify(done.error));
  assert.equal(done.error.code, "TEXT_VALIDATION_FAILED");
  assert.equal(f.state.modelCalls, 2);
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("publish_attempts")).length, 0);
  const validation = await f.db.need("validation_runs", done.validationId);
  assert.equal(validation.contentId, done.contentId);
  assert.equal(validation.passed, false);
  const request = JSON.parse(f.state.textRequests[1].body.messages[1].content);
  assert.deepEqual(request.repairErrors.previousDraft.tokens, done.tokens);
  assert.ok(request.repairErrors.previousDraft.claims.length);
  assert.ok(
    request.repairErrors.errors.some((e: any) => e.code === "BANNED_WORD"),
  );
});
test("pause during upload blocks final submit without intent", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.job();
  f.state.beforeUpload = async () => {
    const r = await f.db.need("runtime", "main");
    await f.control.runtime({ expectedVersion: r.version, paused: true });
  };
  const done = await f.execute();
  assert.equal(done.state, "cancelled");
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("publish_attempts")).length, 0);
});

test("rejected draft versions do not become published history for later authors or reviewers", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.badText = true;
  await f.job();
  assert.equal((await f.execute()).state, "failed");
  f.state.badText = false;
  await f.job();
  assert.equal((await f.execute()).state, "published");
  const authored = f.state.textRequests
    .map((r) => JSON.parse(r.body.messages[1].content))
    .filter((r) => r.promptVersion?.startsWith("square-author/"));
  assert.deepEqual(authored.at(-1).previousPostsForDiversityOnly, []);
  await f.job();
  await f.execute();
  const lastAuthor = f.state.textRequests
    .map((r) => JSON.parse(r.body.messages[1].content))
    .filter((r) => r.promptVersion?.startsWith("square-author/"))
    .at(-1);
  assert.equal(lastAuthor.previousPostsForDiversityOnly.length, 1);
  assert.ok(!lastAuthor.previousPostsForDiversityOnly.includes("情绪上来了"));
});
test("credential rotation during upload invalidates old worker", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.job();
  f.state.beforeUpload = async () => {
    await f.control.rotate(
      "accounts",
      f.account.id,
      "fixture-new-credential-value",
    );
  };
  const done = await f.execute();
  assert.equal(done.state, "cancelled");
  assert.equal(f.state.calls, 0);
});
test("unknown publication outcome blocks account and all retries", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.failure = new Fault(
    "UPSTREAM_NETWORK_ERROR",
    "fixture: connection reset",
    502,
    {},
    true,
  );
  await f.job();
  const done = await f.execute();
  assert.equal(done.state, "submission_unknown");
  assert.equal(
    (await f.db.need("accounts", f.account.id)).blockReason,
    "PUBLISH_RESULT_UNKNOWN",
  );
  assert.equal(f.state.calls, 1);
  await assert.rejects(() => f.control.retry(done.id), {
    code: "UNSAFE_RETRY",
  });
  await assert.rejects(
    () =>
      f.control.newJob(f.account.id, "manual", {
        idempotencyKey: "new-after-unknown",
      }),
    { code: "ACCOUNT_PAUSED" },
  );
  await f.pipeline.tick();
  assert.equal(f.state.calls, 1);
});
test("remote credential rejection is definite, isolated and not automatically replayed", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.state.failure = new Fault(
    "ACCOUNT_CREDENTIAL_INVALID",
    "fixture: rejected",
    502,
    { definitelyRejected: true, platformCode: "auth" },
  );
  await f.job();
  const done = await f.execute();
  assert.equal(done.state, "failed", JSON.stringify(done.error));
  assert.equal(
    (await f.db.need("accounts", f.account.id)).credentialHealth,
    "invalid",
  );
  assert.equal(f.state.calls, 1);
  await assert.rejects(() => f.control.retry(done.id), {
    code: "UNSAFE_RETRY",
  });
});
test("preview works during global pause and cannot send", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const j = await f.control.newJob(null, "preview", {
    presetId: f.preset.id,
    idempotencyKey: "preview-key",
  });
  const done = await f.execute();
  assert.equal(j.kind, "preview");
  assert.equal(done.state, "preview_ready");
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("posts")).length, 0);
});
test("expired worker is fenced; submitted intents become unknown", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const j = await f.job(),
    claimed = await f.pipeline.claim();
  assert.ok(claimed);
  await f.db.update("jobs", j.id, { leaseUntil: "2020-01-01T00:00:00.000Z" });
  await f.pipeline.recoverExpired();
  await assert.rejects(() => f.pipeline.stage(claimed, "ready"), {
    code: "STALE_LEASE",
  });
  const again = await f.pipeline.claim();
  assert.ok(again);
  await f.db.insert("publish_attempts", { jobId: j.id, state: "intent" });
  await f.db.update("jobs", j.id, {
    state: "submitting",
    leaseUntil: "2020-01-01T00:00:00.000Z",
  });
  await f.pipeline.recoverExpired();
  assert.equal((await f.db.need("jobs", j.id)).state, "submission_unknown");
  assert.equal(f.state.calls, 0);
});
test("image generation registers output before it can be selected", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const image = await f.media.createJob({
    modelId: f.imageModel.id,
    prompt: "A test image; isolated fixture only",
  });
  const a = await f.media.generate(image);
  assert.ok(a.origins.some((o: any) => o.type === "gpt_image_2"));
  assert.equal((await f.db.need("image_jobs", image.id)).state, "completed");
  assert.equal(f.state.imageCalls, 1);
  await f.media.bytes(a);
});
test("model provider capacity is enforced without a request", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const r = await f.db.need("runtime", "main");
  await f.control.runtime({ expectedVersion: r.version, textConcurrency: 1 });
  const release = await f.ai.capacity("text", f.connection);
  await assert.rejects(() => f.ai.capacity("text", f.connection), {
    code: "MODEL_CAPACITY_WAIT",
  });
  assert.equal(f.state.modelCalls, 0);
  await release();
  const release2 = await f.ai.capacity("text", f.connection);
  await release2();
});
