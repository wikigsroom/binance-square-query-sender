import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fixture } from "./fixture.js";
import { textOutput, textRequest } from "../src/providers.js";
import { loadOverview } from "../src/overview.js";

async function session(f: Awaited<ReturnType<typeof fixture>>) {
  const r = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: f.config.origin },
    payload: { username: "owner", password: "fixture-password-1234" },
  });
  return {
    "idempotency-key": crypto.randomUUID(),
    cookie: `square_session=${r.cookies[0].value}`,
    origin: f.config.origin,
    "x-csrf-token": r.json().data.csrf,
  };
}
for (const protocol of [
  "openai_chat_images",
  "openai_responses_images",
  "anthropic_messages",
]) {
  test(`${protocol}: generation and review use the selected wire protocol with complete provenance`, async (t) => {
    const f = await fixture();
    t.after(f.close);
    await f.db.update("connections", f.connection.id, { protocol });
    await f.db.update("models", f.model.id, {
      allowedParameters: ["max_tokens"],
      defaultParameters: { max_tokens: 4096 },
    });
    await f.control.newJob(null, "preview", { presetId: f.preset.id });
    const job = await f.execute();
    assert.equal(job.state, "preview_ready");
    assert.equal(
      f.state.textRequests.length,
      2,
      "both writing and semantic review reach the selected transport",
    );
    const wire = f.state.textRequests[0];
    const expectedPath =
      protocol === "anthropic_messages"
        ? "/messages"
        : protocol === "openai_responses_images"
          ? "/responses"
          : "/chat/completions";
    assert.equal(wire.path, expectedPath);
    assert.equal(wire.apiKeyHeader, protocol === "anthropic_messages");
    assert.equal(wire.bearer, protocol !== "anthropic_messages");
    if (protocol === "anthropic_messages") {
      assert.equal(wire.apiVersion, "2023-06-01");
      assert.ok(wire.body.system.includes("中文"));
      assert.ok(!wire.body.messages.some((m: any) => m.role === "system"));
    } else if (protocol === "openai_responses_images") {
      assert.equal(wire.body.store, false);
      assert.equal(wire.body.max_output_tokens, 4096);
      assert.equal(wire.body.max_tokens, undefined);
      assert.ok(wire.body.input[0].content.includes("中文"));
    }
    const runs = await f.db.list("generation_runs", "data->>'type'='text'");
    assert.equal(runs[0].protocol, protocol);
    assert.equal(runs[0].requestUrl, `${f.connection.baseUrl}${expectedPath}`);
    assert.deepEqual(runs[0].requestBody, wire.body);
    assert.equal(runs[0].requestedModel, "fixture-text");
    assert.equal(runs[0].reportedModel, "fixture-provider-reported");
    assert.ok(
      !JSON.stringify(runs).includes("fixture-model-key-no-real-value"),
    );
    assert.equal(f.state.calls, 0);
  });
}
test("AI discovery, model registration and defaults persist; task model selection is frozen", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const headers = await session(f);
  const probe = await f.app.inject({
    method: "POST",
    url: `/api/v1/model-connections/${f.connection.id}/probe`,
    headers,
    payload: { billable: false },
  });
  assert.equal(probe.statusCode, 200);
  assert.equal(probe.json().data.modelCount, 2);
  assert.equal(f.state.modelCalls, 0);
  const conn = await f.db.need("connections", f.connection.id);
  assert.equal(conn.lastProbe.state, "completed");
  const defaults = await f.db.need("runtime", "ai");
  const saved = await f.app.inject({
    method: "PATCH",
    url: "/api/v1/ai/settings",
    headers,
    payload: {
      expectedVersion: defaults.version,
      defaultTextModelId: f.model.id,
      defaultImageModelId: f.imageModel.id,
    },
  });
  assert.equal(saved.statusCode, 200);
  let preset = await f.db.need("presets", f.preset.id);
  preset = await f.control.savePreset(
    {
      expectedVersion: preset.version,
      name: preset.name,
      rules: { ...preset.draftRules, modelId: "@default" },
    },
    preset.id,
  );
  preset = await f.control.publishPreset(preset.id, {
    expectedVersion: preset.version,
  });
  const first = await f.control.newJob(null, "preview", {
    presetId: preset.id,
  });
  assert.equal(first.rules.modelId, f.model.id);
  assert.equal(first.modelSelection.text.requestedId, "@default");
  assert.equal(
    first.modelSelection.text.defaultsVersion,
    saved.json().data.version,
  );
  const registered = await f.app.inject({
    method: "POST",
    url: "/api/v1/models",
    headers,
    payload: {
      connectionId: conn.id,
      externalId: "another-actual-model",
      type: "text",
      approved: true,
      allowedParameters: [],
    },
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const next = registered.json().data;
  const changed = await f.app.inject({
    method: "PATCH",
    url: "/api/v1/ai/settings",
    headers,
    payload: {
      expectedVersion: saved.json().data.version,
      defaultTextModelId: next.id,
    },
  });
  assert.equal(changed.statusCode, 200);
  const second = await f.control.newJob(null, "preview", {
    presetId: preset.id,
  });
  assert.equal(second.rules.modelId, next.id);
  assert.equal((await f.db.need("jobs", first.id)).rules.modelId, f.model.id);
  const v = await f.db.need("preset_versions", preset.publishedVersionId);
  assert.equal(v.rules.modelId, "@default");
  const duplicate = await f.app.inject({
    method: "POST",
    url: "/api/v1/models",
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    payload: {
      connectionId: conn.id,
      externalId: "another-actual-model",
      type: "text",
      approved: true,
    },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "MODEL_ALREADY_REGISTERED");
  await f.db.update("connections", conn.id, { enabled: false });
  const readiness = await f.control.candidates(f.db, f.account.id);
  assert.equal(readiness.bindings[0].probability, 0);
  const status = await f.app.inject({ url: "/api/v1/ai/settings", headers });
  assert.equal(status.json().data.text.available, false);
  await assert.rejects(
    f.control.newJob(null, "preview", { presetId: preset.id }),
    { code: "TEXT_MODEL_UNAVAILABLE" },
  );
});
test("connection config honors provider/protocol, disabled state, atomic key rotation and probe invalidation", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const headers = await session(f);
  const created = await f.app.inject({
    method: "POST",
    url: "/api/v1/model-connections",
    headers,
    payload: {
      name: "native custom endpoint",
      provider: "custom",
      protocol: "anthropic_messages",
      baseUrl: `http://127.0.0.1:${f.port}`,
      allowPrivateNetwork: true,
      enabled: false,
      apiKey: "fixture-another-key-not-real",
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  const c = created.json().data;
  assert.equal(c.enabled, false);
  assert.equal(c.protocol, "anthropic_messages");
  assert.ok(!created.body.includes("fixture-another-key-not-real"));
  await f.app.inject({
    method: "POST",
    url: `/api/v1/model-connections/${c.id}/probe`,
    headers,
    payload: {},
  });
  const probed = await f.db.need("connections", c.id);
  const rotated = await f.app.inject({
    method: "PATCH",
    url: `/api/v1/model-connections/${c.id}`,
    headers,
    payload: {
      expectedVersion: probed.version,
      name: "renamed endpoint",
      apiKey: "fixture-replacement-key-not-real",
    },
  });
  assert.equal(rotated.statusCode, 200);
  const r = rotated.json().data;
  assert.equal(r.credentialVersion, 2);
  assert.equal(r.lastProbe, null);
  assert.equal(r.name, "renamed endpoint");
  const bad = await f.app.inject({
    method: "PATCH",
    url: `/api/v1/model-connections/${c.id}`,
    headers,
    payload: {
      expectedVersion: r.version,
      name: "must roll back",
      apiKey: "short",
    },
  });
  assert.equal(bad.statusCode, 422);
  assert.equal((await f.db.need("connections", c.id)).name, "renamed endpoint");
  const badUrl = await f.app.inject({
    method: "PATCH",
    url: `/api/v1/model-connections/${c.id}`,
    headers,
    payload: { expectedVersion: r.version, baseUrl: "missing-scheme" },
  });
  assert.equal(badUrl.statusCode, 422);
  assert.equal(badUrl.json().error.code, "INVALID_CONNECTION");
  const image = await f.app.inject({
    method: "POST",
    url: "/api/v1/models",
    headers,
    payload: {
      connectionId: c.id,
      type: "image",
      externalId: "gpt-image-2",
      approved: true,
      family: "gpt-image-2",
    },
  });
  assert.equal(image.statusCode, 422);
});
test("partial responses and transport overrides cannot become publishable content", () => {
  assert.throws(
    () =>
      textOutput(
        { protocol: "openai_responses_images" },
        { status: "incomplete", output: [] },
      ),
    { code: "TEXT_MODEL_INCOMPLETE" },
  );
  assert.throws(
    () =>
      textOutput(
        { protocol: "anthropic_messages" },
        { stop_reason: "max_tokens", content: [] },
      ),
    { code: "TEXT_MODEL_INCOMPLETE" },
  );
  assert.throws(
    () =>
      textRequest(
        {
          protocol: "openai_chat_images",
          baseUrl: "https://example.invalid/v1",
        },
        { externalId: "actual" },
        [],
        { messages: [] },
      ),
    { code: "UNSUPPORTED_MODEL_PARAMETER" },
  );
});
test("overview counts all rows, avoids duplicate attention and excludes disabled library assets", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.db.update("accounts", f.account.id, {
    blockReason: "SUBMISSION_UNKNOWN",
  });
  await f.db.insert("jobs", {
    accountId: f.account.id,
    kind: "manual",
    state: "submission_unknown",
  });
  await f.db.sql(
    "INSERT INTO accounts(id,data) SELECT 'count-fixture-'||n, jsonb_build_object('name','Counter fixture','status','active') FROM generate_series(1,1005) n",
  );
  await f.db.update("assets", f.asset.id, { enabled: false });
  await f.db.insert("posts", {
    publishStatus: "published",
    verificationStatus: "verified",
    publishedAt: new Date(Date.now() - 86400000).toISOString(),
    verifiedAt: new Date().toISOString(),
  });
  const result = await loadOverview(f.db);
  assert.equal(result.counts.accounts, 1006);
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.counts.attention, 1);
  assert.equal(result.setup.assets, 0);
  assert.equal(result.setup.textModels, 1);
  assert.equal(result.setup.defaultText.available, false);
  assert.equal(result.counts.publishedToday, 0);
  assert.equal(result.counts.verifiedToday, 1);
});
test("standalone image tasks resolve and freeze the approved default before generation", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.db.update("runtime", "ai", { defaultImageModelId: f.imageModel.id });
  const image = await f.media.createJob({
    modelId: "@default",
    prompt: "An isolated square fixture image",
  });
  assert.equal(image.modelId, f.imageModel.id);
  assert.equal(image.modelSelection.requestedId, "@default");
  assert.equal(f.state.imageCalls, 0);
  await f.db.update("runtime", "ai", { defaultImageModelId: "" });
  assert.equal(
    (await f.db.need("image_jobs", image.id)).modelId,
    f.imageModel.id,
  );
  const asset = await f.media.generate(image);
  assert.ok(asset.origins.some((p: any) => p.type === "gpt_image_2"));
  assert.equal(f.state.imageCalls, 1);
  await assert.rejects(
    f.media.createJob({ modelId: "@default", prompt: "Blocked default" }),
    { code: "AI_DEFAULT_NOT_CONFIGURED" },
  );
});
