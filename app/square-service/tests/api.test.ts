import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";

test("key-only bulk import creates paused accounts and isolates duplicates and invalid rows", async (t) => {
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
    "idempotency-key": "key-only-import-test",
  };
  const payload = {
    accounts: [
      { apiKey: "  fixture-import-only-alpha-9031  " },
      { apiKey: "fixture-import-only-alpha-9031" },
      { apiKey: "short" },
      { apiKey: "fixture-import-only-beta-9032", name: "  " },
      null,
      { apiKey: "fixture-import-original-9033", name: "可选名称", uid: "9527" },
      { apiKey: "旧格式,fixture-invalid-csv,100" },
      { apiKey: "fixture-square-key-no-real-value" },
    ],
  };
  const request = { method: "POST" as const, url: "/api/v1/accounts/import", headers, payload };
  const response = await f.app.inject(request);
  assert.equal(response.statusCode, 200);
  const result = response.json().data;
  assert.deepEqual(result.map((r: any) => r.status), [
    "created", "rejected", "rejected", "created", "rejected", "created", "rejected", "rejected",
  ]);
  assert.equal(result[1].code, "DUPLICATE_CREDENTIAL");
  assert.equal(result[2].code, "INVALID_CREDENTIAL");
  assert.equal(result[4].code, "INVALID_ACCOUNT");
  assert.equal(result[6].code, "INVALID_CREDENTIAL");
  assert.equal(result[7].code, "DUPLICATE_CREDENTIAL");
  assert.notEqual(result[0].name, result[3].name);
  for (const index of [0, 3]) {
    const a = await f.db.need("accounts", result[index].accountId);
    assert.match(a.name, /^广场账号 [A-F0-9]{8}$/);
    assert.equal(a.name, result[index].name);
    assert.equal(a.uid, "");
    assert.deepEqual(a.tags, []);
    assert.equal((await f.db.need("schedules", a.id)).enabled, false);
    assert.equal((await f.db.need("schedules", a.id)).nextDueAt, null);
    assert.equal((await f.db.need("bindings", a.id)).bindings.length, 0);
    const credential = await f.db.need("credentials", a.credentialId);
    assert.ok(!credential.box.includes("fixture-import"));
  }
  const legacy = await f.db.need("accounts", result[5].accountId);
  assert.equal(legacy.name, "可选名称");
  assert.equal(legacy.uid, "9527");
  const replay = await f.app.inject(request);
  assert.deepEqual(replay.json().data, result);
  assert.equal((await f.db.list("accounts")).length, 4);
  for (const key of ["fixture-import-only-alpha-9031", "fixture-import-only-beta-9032", "fixture-import-original-9033"])
    assert.ok(!response.body.includes(key));
  for (const accounts of [[], new Array(1001).fill({ apiKey: "fixture-unused-9034" })]) {
    const rejected = await f.app.inject({
      ...request,
      headers: { ...headers, "idempotency-key": `invalid-batch-${accounts.length}` },
      payload: { accounts },
    });
    assert.equal(rejected.statusCode, 422);
    assert.equal(rejected.json().error.code, "INVALID_IMPORT");
  }
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("jobs")).length, 0);
});

test("separate frontend origin supports credentialed CORS without weakening session or CSRF", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const preflight = await f.app.inject({
    method: "OPTIONS", url: "/api/v1/auth/login",
    headers: { origin: f.config.origin, "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-csrf-token,idempotency-key" },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], f.config.origin);
  assert.equal(preflight.headers["access-control-allow-credentials"], "true");
  for (const headers of [
    { origin: "https://untrusted.invalid", "access-control-request-method": "POST" },
    { origin: f.config.origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization" },
  ]) {
    const rejected = await f.app.inject({ method: "OPTIONS", url: "/api/v1/runtime", headers });
    assert.equal(rejected.statusCode, 403);
  }
  const noSession = await f.app.inject({ url: "/api/v1/accounts", headers: { origin: f.config.origin } });
  assert.equal(noSession.statusCode, 401);
  assert.equal(noSession.headers["access-control-allow-origin"], f.config.origin);
  const login = await f.app.inject({ method: "POST", url: "/api/v1/auth/login",
    headers: { origin: f.config.origin }, payload: { username: "owner", password: "fixture-password-1234" } });
  assert.equal(login.statusCode, 200);
  assert.equal(login.headers["access-control-allow-credentials"], "true");
  assert.ok(String(login.headers["set-cookie"]).includes("HttpOnly"));
  assert.ok(String(login.headers["set-cookie"]).includes("SameSite=Strict"));
  const cookie = `square_session=${login.cookies[0].value}`;
  const me = await f.app.inject({ url: "/api/v1/auth/me", headers: { origin: f.config.origin, cookie } });
  assert.equal(me.json().data.username, "owner");
  const noCsrf = await f.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { origin: f.config.origin, cookie }, payload: {} });
  assert.equal(noCsrf.statusCode, 403);
  const logout = await f.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { origin: f.config.origin, cookie, "x-csrf-token": login.json().data.csrf }, payload: {} });
  assert.equal(logout.statusCode, 200);
  const untrustedRead = await f.app.inject({ url: "/api/v1/auth/me", headers: { origin: "https://untrusted.invalid", cookie } });
  assert.equal(untrustedRead.headers["access-control-allow-origin"], undefined);
  assert.equal(f.state.calls, 0);
});

test("cross-origin PUT saves account preset weights and schedules while preserving authentication", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const bindingUrl = `/api/v1/accounts/${f.account.id}/preset-bindings`;
  const scheduleUrl = `/api/v1/accounts/${f.account.id}/schedule`;
  for (const url of [bindingUrl, scheduleUrl]) {
    const preflight = await f.app.inject({
      method: "OPTIONS", url,
      headers: {
        origin: f.config.origin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type,x-csrf-token,idempotency-key",
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], f.config.origin);
    assert.equal(preflight.headers["access-control-allow-credentials"], "true");
    assert.ok(String(preflight.headers["access-control-allow-methods"]).split(/,\s*/).includes("PUT"));
  }
  for (const headers of [
    { origin: "https://untrusted.invalid", "access-control-request-method": "PUT" },
    { origin: f.config.origin, "access-control-request-method": "PUT", "access-control-request-headers": "authorization" },
    { origin: f.config.origin, "access-control-request-method": "TRACE" },
  ]) {
    const rejected = await f.app.inject({ method: "OPTIONS", url: bindingUrl, headers });
    assert.equal(rejected.statusCode, 403);
  }
  const before = await f.control.candidates(f.db, f.account.id);
  const payload = { expectedVersion: before.bindingVersion, bindings: [{ presetId: f.preset.id, weight: 7, enabled: true }] };
  const unauthenticated = await f.app.inject({ method: "PUT", url: bindingUrl, headers: { origin: f.config.origin }, payload });
  assert.equal(unauthenticated.statusCode, 401);
  const login = await f.app.inject({
    method: "POST", url: "/api/v1/auth/login", headers: { origin: f.config.origin },
    payload: { username: "owner", password: "fixture-password-1234" },
  });
  const headers = { origin: f.config.origin, cookie: `square_session=${login.cookies[0].value}`, "x-csrf-token": login.json().data.csrf };
  const noCsrf = await f.app.inject({ method: "PUT", url: bindingUrl, headers: { origin: headers.origin, cookie: headers.cookie }, payload });
  assert.equal(noCsrf.statusCode, 403);
  const wrongOrigin = await f.app.inject({ method: "PUT", url: bindingUrl, headers: { ...headers, origin: "https://untrusted.invalid" }, payload });
  assert.equal(wrongOrigin.statusCode, 403);
  assert.equal(wrongOrigin.headers["access-control-allow-origin"], undefined);
  assert.equal((await f.db.need("bindings", f.account.id)).version, before.bindingVersion);
  const saved = await f.app.inject({ method: "PUT", url: bindingUrl, headers, payload });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.headers["access-control-allow-origin"], f.config.origin);
  assert.equal(saved.json().data.bindings[0].weight, 7);
  const readback = await f.app.inject({ url: bindingUrl, headers });
  assert.equal(readback.json().data.bindings[0].weight, 7);
  const stale = await f.app.inject({ method: "PUT", url: bindingUrl, headers, payload });
  assert.equal(stale.statusCode, 409);
  const schedule = await f.db.need("schedules", f.account.id);
  const scheduled = await f.app.inject({
    method: "PUT", url: scheduleUrl, headers,
    payload: { expectedVersion: schedule.version, minIntervalSeconds: 120, maxIntervalSeconds: 240, enabled: false },
  });
  assert.equal(scheduled.statusCode, 200);
  assert.equal((await f.db.need("schedules", f.account.id)).maxIntervalSeconds, 240);
  assert.equal((await f.db.need("schedules", f.account.id)).enabled, false);
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("jobs")).length, 0);
});

test("remote management requires session, origin, CSRF, and masks credentials", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const unauthorized = await f.app.inject({ url: "/api/v1/accounts" });
  assert.equal(unauthorized.statusCode, 401);
  const login = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: f.config.origin },
    payload: { username: "owner", password: "fixture-password-1234" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0].value,
    csrf = login.json().data.csrf,
    headers = {
      cookie: `square_session=${cookie}`,
      origin: f.config.origin,
      "x-csrf-token": csrf,
    };
  const list = await f.app.inject({ url: "/api/v1/accounts", headers });
  assert.equal(list.statusCode, 200);
  assert.ok(!list.body.includes("fixture-square-key-no-real-value"));
  assert.ok(!list.body.includes("ciphertext"));
  const missingCsrf = await f.app.inject({
    method: "PATCH",
    url: "/api/v1/runtime",
    headers: { cookie: headers.cookie, origin: f.config.origin },
    payload: {},
  });
  assert.equal(missingCsrf.statusCode, 403);
  const badOrigin = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/logout",
    headers: { ...headers, origin: "https://elsewhere.invalid" },
    payload: {},
  });
  assert.equal(badOrigin.statusCode, 403);
  const verify = await f.app.inject({
    method: "POST",
    url: `/api/v1/accounts/${f.account.id}/credentials/verify`,
    headers,
    payload: {},
  });
  assert.equal(verify.json().data.supported, false);
  assert.equal(f.state.calls, 0);
});
test("preview content is searchable, filters compose, and API has no arbitrary send text route", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.control.newJob(null, "preview", {
    presetId: f.preset.id,
    idempotencyKey: "query-preview",
  });
  const j = await f.execute();
  const login = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: f.config.origin },
      payload: { username: "owner", password: "fixture-password-1234" },
    }),
    headers = {
      cookie: `square_session=${login.cookies[0].value}`,
      origin: f.config.origin,
      "x-csrf-token": login.json().data.csrf,
    };
  const result = await f.app.inject({
    url: `/api/v1/posts?q=${encodeURIComponent("不服气")}&publishStatus=preview_ready&modelId=${f.model.id}`,
    headers,
  });
  assert.equal(result.json().data.length, 1);
  assert.equal(result.json().data[0].jobId, j.id);
  const noResult = await f.app.inject({
    url: "/api/v1/posts?q=不存在的语句",
    headers,
  });
  assert.equal(noResult.json().data.length, 0);
  const raw = await f.app.inject({
    method: "POST",
    url: "/api/v1/posts",
    headers,
    payload: { text: "non-ai text" },
  });
  assert.equal(raw.statusCode, 404);
  const detail = await f.app.inject({
    url: `/api/v1/publication-jobs/${j.id}`,
    headers,
  });
  assert.ok(detail.json().data.generationRuns[0].messages);
});
