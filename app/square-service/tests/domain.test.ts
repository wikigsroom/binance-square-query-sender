import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { interval, weighted } from "../src/rules.js";
import { hash, now, Fault, redact } from "../src/core.js";
import { similarity } from "../src/validation.js";

test("uniform inclusive interval and invalid bounds", () => {
  assert.equal(
    interval(20, 40, () => 0),
    20,
  );
  assert.equal(
    interval(20, 40, () => 0.999999),
    40,
  );
  assert.equal(interval(20, 20), 20);
  for (const [a, b] of [
    [0, 2],
    [3, 2],
    [1.1, 2],
    [1, Infinity],
  ])
    assert.throws(() => interval(a, b));
});
test("weighted draw records probabilities, excludes zero and rejects empty", () => {
  const c = [
    { id: "a", weight: 2 },
    { id: "b", weight: 3 },
    { id: "c", weight: 0 },
  ];
  assert.equal(weighted(c, () => 0).selected.id, "a");
  assert.equal(weighted(c, () => 0.99).selected.id, "b");
  assert.equal(weighted(c).candidates[0].probability, 0.4);
  assert.throws(() => weighted([{ weight: 0 }]));
});
test("token/number changes do not bypass structural similarity", () => {
  assert.ok(
    similarity(
      "我看 $BTC 涨了12%，还是没底。",
      "我看 $ETH 涨了8%，还是没底。",
    ) > 0.9,
  );
  assert.ok(
    similarity("项目的进展我还没看明白。", "今天新增的链上地址值得继续观察。") <
      0.5,
  );
});
test("credentials are encrypted, duplicate detection and rotation preserve identity", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const c = await f.db.need("credentials", f.account.credentialId);
  assert.ok(!c.box.includes("fixture-square"));
  await assert.rejects(
    () =>
      f.control.createAccount({
        name: "Duplicate",
        apiKey: "fixture-square-key-no-real-value",
      }),
    { code: "DUPLICATE_CREDENTIAL" },
  );
  const a = await f.control.rotate(
    "accounts",
    f.account.id,
    "fixture-rotated-square-key",
  );
  assert.equal(a.id, f.account.id);
  assert.equal(a.credentialVersion, 2);
  assert.equal((await f.db.need("bindings", a.id)).bindings.length, 1);
  assert.equal((await f.db.need("schedules", a.id)).enabled, false);
});
test("optimistic conflict and no all-zero bindings", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await assert.rejects(
    () =>
      f.control.bindings(f.account.id, { expectedVersion: 1, bindings: [] }),
    { code: "CONFIG_VERSION_CONFLICT" },
  );
  const b = await f.db.need("bindings", f.account.id);
  await assert.rejects(
    () =>
      f.control.bindings(f.account.id, {
        expectedVersion: b.version,
        bindings: [{ presetId: f.preset.id, weight: 0, enabled: true }],
      }),
    { code: "NO_ELIGIBLE_PRESET" },
  );
  assert.equal((await f.db.need("bindings", b.id)).version, b.version);
});
test("schedule remains stable across reads and range changes; explicit resample", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const s = await f.control.schedule(f.account.id, {
    expectedVersion: 1,
    minIntervalSeconds: 60,
    maxIntervalSeconds: 60,
    enabled: true,
  });
  const read = await f.db.need("schedules", f.account.id);
  assert.equal(read.nextDueAt, s.nextDueAt);
  const changed = await f.control.schedule(f.account.id, {
    expectedVersion: s.version,
    minIntervalSeconds: 120,
    maxIntervalSeconds: 120,
    enabled: true,
  });
  assert.equal(changed.nextDueAt, s.nextDueAt);
  const sampled = await f.control.schedule(
    f.account.id,
    { expectedVersion: changed.version },
    "resample",
  );
  assert.equal(sampled.sampledDelaySeconds, 120);
  assert.notEqual(sampled.nextDueAt, s.nextDueAt);
});
test("one account one active job; idempotent manual replay without reroll", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.resume();
  const a = await f.control.newJob(f.account.id, "manual", {
      idempotencyKey: "test-same-key",
    }),
    b = await f.control.newJob(f.account.id, "manual", {
      idempotencyKey: "test-same-key",
    });
  assert.equal(a.id, b.id);
  assert.deepEqual(a.selection, b.selection);
  const results = await Promise.allSettled([
    f.control.newJob(f.account.id, "manual", { idempotencyKey: "other-key-a" }),
    f.control.newJob(f.account.id, "manual", { idempotencyKey: "other-key-b" }),
  ]);
  assert.ok(
    results.every(
      (r) => r.status === "rejected" && r.reason.code === "ACCOUNT_BUSY",
    ),
  );
});
test("published versions stay immutable and new tasks pin versions", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const j = await f.job();
  const p = await f.db.need("presets", f.preset.id);
  const changed = await f.control.savePreset(
    {
      expectedVersion: p.version,
      name: p.name,
      rules: { ...p.draftRules, tone: "更冷静的观察" },
    },
    p.id,
  );
  await f.control.publishPreset(p.id, { expectedVersion: changed.version });
  assert.equal(
    (await f.db.need("jobs", j.id)).presetVersionId,
    j.presetVersionId,
  );
  await assert.rejects(
    () => f.db.update("preset_versions", j.presetVersionId, { rules: {} }),
    /immutable snapshot/,
  );
});
test("restart skips never-claimed missed plans and retains future samples", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.db.update("schedules", f.account.id, {
    enabled: true,
    nextDueAt: "2020-01-01T00:00:00.000Z",
  });
  await f.control.recover();
  const s = await f.db.need("schedules", f.account.id);
  assert.ok(s.nextDueAt > now());
  const future = s.nextDueAt;
  await f.control.recover();
  assert.equal((await f.db.need("schedules", s.id)).nextDueAt, future);
  assert.equal((await f.db.list("jobs")).length, 0);
});
test("redaction retains error context without credentials", () => {
  const secret = "fixture-secret-token-value";
  const r = redact(
    {
      message: `upstream ${secret}`,
      authorization: "Bearer abc",
      details: { raw: "failed", code: "x" },
    },
    [secret],
  );
  assert.equal(r.message, "upstream [redacted]");
  assert.equal(r.authorization, "[redacted]");
  assert.equal(r.details.raw, "failed");
});
