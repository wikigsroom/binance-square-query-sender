import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { hash, Row } from "../src/core.js";
import { validate } from "../src/validation.js";

test("publish-first mode records content problems as warnings and never calls semantic review", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const runtime = await f.db.need("runtime", "main");
  await assert.rejects(
    () =>
      f.control.runtime({
        expectedVersion: runtime.version,
        contentValidationMode: "invalid",
      }),
    { code: "INVALID_RUNTIME" },
  );
  await f.control.runtime({
    expectedVersion: runtime.version,
    contentValidationMode: "publish_first",
  });
  f.state.badText = true;
  f.state.reviewFailure = true;
  await f.job();
  const done = await f.execute();
  assert.equal(done.state, "published", JSON.stringify(done.error));
  assert.equal(f.state.modelCalls, 1);
  assert.equal(f.state.calls, 1);
  const validation = await f.db.need("validation_runs", done.validationId);
  assert.equal(validation.validationMode, "publish_first");
  assert.equal(validation.passed, true);
  assert.deepEqual(validation.errors, []);
  assert.ok(
    validation.warnings.some(
      (w: any) => w.code === "BANNED_WORD" && w.nonBlocking,
    ),
  );
  assert.ok(
    validation.warnings.some(
      (w: any) => w.code === "TOKEN_TAGS" && w.nonBlocking,
    ),
  );
  assert.equal(validation.semanticReview, undefined);
  assert.equal(f.state.textRequests.length, 1);
});

test("publish-first mode keeps length and content-integrity failures while downgrading news evidence", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const job = await f.job();
  const input = await f.sources.collect(job);
  const content = (text: string) =>
    ({
      text,
      contentHash: hash(text),
      tokens: [],
      claims: [],
      usedSourceIds: ["nonexistent_news"],
      newsClaims: [],
    }) as unknown as Row;
  const check = (c: Row) =>
    validate(c, job.rules, input, [], ["情绪"], "publish_first");
  const ordinary = check(content("一段模型成稿"));
  assert.equal(ordinary.passed, true);
  assert.ok(
    ordinary.warnings.some(
      (w: any) => w.code === "NEWS_SOURCE" && w.nonBlocking,
    ),
  );
  assert.ok(
    check(content("")).errors.some((e: any) => e.code === "TEXT_LENGTH"),
  );
  assert.ok(
    check(content("字".repeat(job.rules.maxChars + 1))).errors.some(
      (e: any) => e.code === "TEXT_LENGTH",
    ),
  );
  assert.ok(
    check({
      ...content("一段模型成稿"),
      contentHash: hash("另一段"),
    }).errors.some((e: any) => e.code === "CONTENT_HASH_MISMATCH"),
  );
});

test("tightening validation while uploading prevents reuse of a relaxed validation result", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const runtime = await f.db.need("runtime", "main");
  await f.control.runtime({
    expectedVersion: runtime.version,
    contentValidationMode: "publish_first",
  });
  await f.job();
  f.state.beforeUpload = async () => {
    const current = await f.db.need("runtime", "main");
    await f.control.runtime({
      expectedVersion: current.version,
      contentValidationMode: "strict",
    });
  };
  const done = await f.execute();
  assert.equal(done.state, "failed");
  assert.equal(done.error.code, "CONTENT_VALIDATION_POLICY_CHANGED");
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("publish_attempts")).length, 0);
});
