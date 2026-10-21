import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  Database,
  Vault,
  Config,
  Doc,
  Row,
  id,
  now,
  hash,
  passwordMatches,
  passwordHash,
  Fault,
  requireThat,
  errorInfo,
  redact,
} from "./core.js";
import { Control, ACTIVE, expect, cleanTags } from "./control.js";
import { Sources } from "./sources.js";
import { Http } from "./http.js";
import { AI } from "./ai.js";
import { installAIRoutes } from "./ai-routes.js";
import { loadOverview } from "./overview.js";
import { Media } from "./media.js";
import { Square, SquarePort } from "./square.js";
import { Pipeline } from "./pipeline.js";
import { exampleRules } from "./rules.js";
import { sourceCatalog } from "./source-catalog.js";
import { searchPosts as searchablePosts } from "./queries.js";

type Handler = (r: any, p: any) => Promise<any>;
export async function buildServer(
  config: Config,
  provided?: { db?: Database; square?: SquarePort },
) {
  const db =
    provided?.db ||
    (await Database.connect(
      config.databaseUrl,
      path.join(config.dataDir, "pgdata"),
    ));
  const vault = new Vault(config.encryptionKey),
    http = new Http(config.proxy),
    control = new Control(db, vault),
    ai = new AI(db, vault, http),
    sources = new Sources(db, http),
    media = new Media(db, ai, config),
    square = provided?.square || new Square(http),
    pipeline = new Pipeline(
      db,
      control,
      vault,
      sources,
      ai,
      media,
      square,
      config,
    );
  await control.bootstrap();
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: false,
    genReqId: () => id("req"),
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 8 },
  });
  const routes: Doc[] = [];
  const corsMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
  const loginAttempts = new Map<string, { count: number; since: number }>();
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("Cache-Control", "no-store");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    );
    if (req.url.startsWith("/api/")) {
      reply.header("Vary", "Origin");
      if (req.headers.origin === config.origin)
        reply
          .header("Access-Control-Allow-Origin", config.origin)
          .header("Access-Control-Allow-Credentials", "true");
      if (req.method === "OPTIONS") {
        const method = req.headers["access-control-request-method"],
          requestedHeaders = String(
            req.headers["access-control-request-headers"] || "",
          )
            .toLowerCase()
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean);
        requireThat(
          req.headers.origin === config.origin &&
            typeof method === "string" &&
            corsMethods.includes(method) &&
            requestedHeaders.every((h) =>
              ["content-type", "x-csrf-token", "idempotency-key"].includes(h),
            ),
          "ORIGIN_REJECTED",
          "跨域请求来源、方法或请求头不匹配。",
          403,
        );
        return reply
          .header("Access-Control-Allow-Methods", corsMethods.join(", "))
          .header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-CSRF-Token, Idempotency-Key",
          )
          .header("Access-Control-Max-Age", "600")
          .code(204)
          .send();
      }
    }
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.url.startsWith("/api/")
    )
      requireThat(
        req.headers.origin === config.origin,
        "ORIGIN_REJECTED",
        "写请求来源不匹配。",
        403,
      );
  });
  app.options("/api/*", async (_req, reply) => reply.code(204).send());
  app.setErrorHandler((error: any, req, reply) => {
    const status =
        error.status ||
        error.statusCode ||
        (error.name === "ZodError" ? 422 : 500),
      info = errorInfo(error);
    if (status === 500) info.message = "内部错误，详情已写入审计日志。";
    void db.audit("api.error", req.id, {
      path: req.routeOptions.url,
      status,
      ...info,
    });
    reply.code(status).send({ error: info, meta: { requestId: req.id } });
  });
  async function authenticate(req: FastifyRequest) {
    const token = req.cookies.square_session;
    requireThat(token, "UNAUTHENTICATED", "请登录。", 401);
    const session = await db.get("sessions", hash(token));
    requireThat(
      session && session.expiresAt > now(),
      "SESSION_EXPIRED",
      "登录已过期。",
      401,
    );
    (req as any).session = session;
    if (!["GET", "HEAD"].includes(req.method))
      requireThat(
        req.headers["x-csrf-token"] === session.csrf,
        "CSRF_REJECTED",
        "会话校验失败，请刷新页面。",
        403,
      );
  }
  const route = (method: any, url: string, handler: Handler, open = false) => {
    routes.push({ method, path: `/api/v1${url}`, authenticated: !open });
    app.route({
      method,
      url: `/api/v1${url}`,
      preHandler: open ? undefined : authenticate,
      handler: async (req, reply) => {
        const result = await handler(req, reply);
        if (reply.sent) return;
        if (result?.__page)
          return {
            data: result.data,
            meta: { requestId: req.id, ...result.meta },
          };
        return { data: result, meta: { requestId: req.id } };
      },
    });
  };
  const idem = async (req: any, fn: () => Promise<any>) => {
    const key = req.headers["idempotency-key"];
    requireThat(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "IDEMPOTENCY_KEY_REQUIRED",
      "此操作需要 Idempotency-Key。",
      400,
    );
    const scope = hash(
        `${req.session.id}:${req.method}:${req.routeOptions.url}:${JSON.stringify(req.params)}:${key}`,
      ),
      requestHash = hash(JSON.stringify(req.body || {}));
    const existing = await db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const r = await t.get("idempotency", scope, true);
      if (r) {
        requireThat(
          r.requestHash === requestHash,
          "IDEMPOTENCY_CONFLICT",
          "幂等键已用于不同参数。",
          409,
        );
        return r;
      }
      await t.insert("idempotency", { requestHash, state: "running" }, scope);
      return null;
    });
    if (existing) {
      requireThat(
        existing.state !== "running",
        "OPERATION_IN_PROGRESS",
        "原操作正在执行，请查询原任务。",
        409,
      );
      if (existing.state === "failed")
        throw new Fault(
          existing.error.code,
          existing.error.message,
          existing.error.status || 422,
          existing.error.details,
        );
      return existing.result;
    }
    try {
      const result = await fn();
      await db.update("idempotency", scope, { state: "completed", result });
      return result;
    } catch (e: any) {
      await db.update("idempotency", scope, {
        state: "failed",
        error: { ...errorInfo(e), status: e.status || 422 },
      });
      throw e;
    }
  };
  route(
    "POST",
    "/auth/login",
    async (req, reply) => {
      const b = req.body || {},
        attempt = loginAttempts.get(req.ip) || { count: 0, since: Date.now() };
      if (Date.now() - attempt.since > 300_000) {
        attempt.count = 0;
        attempt.since = Date.now();
      }
      attempt.count++;
      loginAttempts.set(req.ip, attempt);
      requireThat(
        attempt.count <= 10,
        "LOGIN_RATE_LIMITED",
        "尝试次数过多，请5分钟后再试。",
        429,
      );
      const users = await db.list(
          "admin_users",
          "data->>'username'=$1",
          [String(b.username || "")],
          1,
        ),
        user = users[0];
      const password = String(b.password || "").slice(0, 1024);
      const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
      const ok = await passwordMatches(password, user?.passwordHash || dummy);
      requireThat(user && ok, "INVALID_LOGIN", "账号或密码不正确。", 401);
      loginAttempts.delete(req.ip);
      const token = crypto.randomBytes(32).toString("base64url"),
        csrf = crypto.randomBytes(24).toString("base64url");
      const session = await db.insert(
        "sessions",
        {
          userId: user.id,
          csrf,
          expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
        },
        hash(token),
      );
      reply.setCookie("square_session", token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: config.secureCookie,
        maxAge: 12 * 3600,
      });
      await db.audit("auth.login", user.id);
      return { username: user.username, csrf: session.csrf };
    },
    true,
  );
  route("GET", "/auth/me", async (req) => ({
    username: (await db.need("admin_users", req.session.userId)).username,
    csrf: req.session.csrf,
  }));
  route("POST", "/auth/logout", async (req, reply) => {
    await db.update("sessions", req.session.id, { expiresAt: now() });
    reply.clearCookie("square_session", { path: "/" });
    return { loggedOut: true };
  });
  route("POST", "/auth/password", async (req) => {
    const b = req.body || {},
      u = await db.need("admin_users", req.session.userId);
    requireThat(
      typeof b.newPassword === "string" &&
        b.newPassword.length >= 12 &&
        b.newPassword.length <= 1024,
      "INVALID_PASSWORD",
      "新密码需为12—1024字符。",
    );
    requireThat(
      await passwordMatches(String(b.oldPassword || ""), u.passwordHash),
      "INVALID_LOGIN",
      "当前密码不正确。",
      403,
    );
    const saved = await passwordHash(b.newPassword);
    await db.transaction(async (t) => {
      await t.update("admin_users", u.id, { passwordHash: saved });
      for (const s of await t.list(
        "sessions",
        "data->>'userId'=$1 AND id<>$2",
        [u.id, req.session.id],
      ))
        await t.update("sessions", s.id, { expiresAt: now() });
      await t.audit("auth.password_changed", u.id);
    });
    return { updated: true };
  });
  route("GET", "/health", async () => {
    await db.sql("SELECT 1");
    const beats = await db.list("heartbeats", "data->>'role'='worker'", [], 10);
    return {
      api: "ok",
      database: "ok",
      databaseMode: db.embedded ? "embedded_development" : "postgresql",
      worker:
        beats.find(
          (b) => b.state === "running" && Date.now() - Date.parse(b.at) < 15000,
        ) || null,
      publishTransportEnabled: config.publishEnabled,
      storage: (await stat(config.dataDir)).isDirectory()
        ? "ok"
        : "unavailable",
    };
  });
  route("GET", "/runtime", async () => ({
    ...(await db.need("runtime", "main")),
    publishTransportEnabled: config.publishEnabled,
    profile: config.profile,
  }));
  route("PATCH", "/runtime", async (req) => control.runtime(req.body || {}));
  route("GET", "/overview", async () => loadOverview(db));
  route("GET", "/accounts", async (req) => {
    const q = String(req.query.q || "").toLowerCase(),
      rows = await db.list("accounts");
    const result = [];
    for (const a of rows) {
      const s = await db.need("schedules", a.id);
      if (
        q &&
        !`${a.name} ${a.uid} ${a.tags.join(" ")}`.toLowerCase().includes(q)
      )
        continue;
      if (req.query.status && a.status !== req.query.status) continue;
      if (req.query.health && a.credentialHealth !== req.query.health) continue;
      if (req.query.scheduled && String(s.enabled) !== req.query.scheduled)
        continue;
      result.push({ ...a, schedule: s });
    }
    return page(result, req.query);
  });
  route("POST", "/accounts", async (req) =>
    idem(req, () => control.createAccount(req.body || {})),
  );
  route("POST", "/accounts/import", async (req) =>
    idem(req, () => control.importAccounts(req.body?.accounts)),
  );
  route("GET", "/accounts/:id", async (req) => ({
    ...(await db.need("accounts", req.params.id)),
    schedule: await db.need("schedules", req.params.id),
    bindings: await control.candidates(db, req.params.id),
    recentJobs: await db.list(
      "jobs",
      "data->>'accountId'=$1",
      [req.params.id],
      10,
    ),
  }));
  route("PATCH", "/accounts/:id", async (req) =>
    control.patchAccount(req.params.id, req.body || {}),
  );
  route("POST", "/accounts/:id/archive", async (req) =>
    control.archive(req.params.id, req.body?.expectedVersion),
  );
  route("POST", "/accounts/:id/credentials/rotate", async (req) =>
    idem(req, () =>
      control.rotate("accounts", req.params.id, req.body?.apiKey),
    ),
  );
  route("POST", "/accounts/:id/credentials/verify", async (req) => {
    await db.need("accounts", req.params.id);
    return {
      supported: false,
      status: "unverified",
      reason:
        "当前广场适配器没有已验证的无发送副作用凭据检查接口，不通过发帖验证。",
    };
  });
  route("GET", "/accounts/:id/preset-bindings", async (req) =>
    control.candidates(db, req.params.id),
  );
  route("PUT", "/accounts/:id/preset-bindings", async (req) =>
    control.bindings(req.params.id, req.body || {}),
  );
  route("GET", "/schedules", async (req) =>
    page(await db.list("schedules"), req.query),
  );
  route("GET", "/accounts/:id/schedule", async (req) =>
    db.need("schedules", req.params.id),
  );
  route("PUT", "/accounts/:id/schedule", async (req) =>
    control.schedule(req.params.id, req.body || {}),
  );
  for (const action of ["pause", "resume", "resample"])
    route("POST", `/accounts/:id/schedule/${action}`, async (req) =>
      control.schedule(req.params.id, req.body || {}, action),
    );
  route("POST", "/accounts/:id/publications", async (req, reply) => {
    requireThat(
      req.headers["idempotency-key"],
      "IDEMPOTENCY_KEY_REQUIRED",
      "需要幂等键。",
      400,
    );
    const j = await control.newJob(req.params.id, "manual", {
      ...req.body,
      idempotencyKey: req.headers["idempotency-key"],
    });
    reply.code(202);
    return j;
  });
  route("GET", "/presets", async (req) =>
    page(await db.list("presets"), req.query),
  );
  route("GET", "/presets/example-rules", async () => exampleRules());
  route("POST", "/presets", async (req) =>
    idem(req, () => control.savePreset(req.body || {})),
  );
  route("GET", "/presets/:id", async (req) => ({
    ...(await db.need("presets", req.params.id)),
    versions: await db.list("preset_versions", "data->>'presetId'=$1", [
      req.params.id,
    ]),
    boundAccounts: (await db.list("bindings"))
      .filter((b) => b.bindings.some((v: Doc) => v.presetId === req.params.id))
      .map((b) => b.accountId),
  }));
  route("PATCH", "/presets/:id", async (req) =>
    control.savePreset(req.body || {}, req.params.id),
  );
  route("POST", "/presets/:id/clone", async (req) =>
    idem(req, async () => {
      const p = await db.need("presets", req.params.id);
      return control.savePreset({
        name: req.body?.name || `${p.name} 副本`,
        description: p.description,
        rules: p.draftRules,
      });
    }),
  );
  route("POST", "/presets/:id/publish-version", async (req) =>
    idem(req, () => control.publishPreset(req.params.id, req.body || {})),
  );
  route("GET", "/presets/:id/versions", async (req) =>
    page(
      await db.list("preset_versions", "data->>'presetId'=$1", [req.params.id]),
      req.query,
    ),
  );
  route("GET", "/presets/:id/versions/:version", async (req) => {
    const rows = await db.list(
      "preset_versions",
      "data->>'presetId'=$1 AND (id=$2 OR data->>'number'=$2)",
      [req.params.id, req.params.version],
    );
    requireThat(rows[0], "NOT_FOUND", "版本不存在。", 404);
    return rows[0];
  });
  route("POST", "/presets/:id/preview", async (req, reply) => {
    requireThat(
      req.headers["idempotency-key"],
      "IDEMPOTENCY_KEY_REQUIRED",
      "需要幂等键。",
      400,
    );
    reply.code(202);
    return control.newJob(null, "preview", {
      presetId: req.params.id,
      includeImageGeneration: !!req.body?.includeImageGeneration,
      idempotencyKey: req.headers["idempotency-key"],
    });
  });
  route("GET", "/assets", async (req) => {
    let rows = await db.list("assets");
    for (const k of ["collection", "style", "aspectRatio"])
      if (req.query[k]) rows = rows.filter((r) => r[k] === req.query[k]);
    if (req.query.source)
      rows = rows.filter((r) => r.provenance.type === req.query.source);
    if (req.query.tag)
      rows = rows.filter((r) => r.tags.includes(req.query.tag));
    if (req.query.enabled)
      rows = rows.filter((r) => String(r.enabled) === req.query.enabled);
    if (req.query.q)
      rows = rows.filter((r) =>
        `${r.name} ${r.tags.join(" ")}`
          .toLowerCase()
          .includes(String(req.query.q).toLowerCase()),
      );
    return page(rows, req.query);
  });
  route("POST", "/assets/upload", async (req) => {
    let bytes: Buffer | undefined,
      filename = "",
      meta: Doc = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        bytes = await part.toBuffer();
        filename = part.filename;
      } else if (part.fieldname === "metadata")
        try {
          meta = JSON.parse(String(part.value));
        } catch {
          throw new Fault("INVALID_METADATA", "图片元数据不是 JSON。");
        }
    }
    requireThat(bytes, "FILE_REQUIRED", "请选择图片。");
    const asset = await media.ingest(
      bytes,
      { name: filename, ...meta },
      { type: "library" },
    );
    await db.audit("asset.uploaded", asset.id);
    return asset;
  });
  route("POST", "/assets/import", async (req) =>
    idem(req, () =>
      media.import(
        req.body?.relativePath,
        req.body?.rootIndex || 0,
        req.body?.metadata || {},
      ),
    ),
  );
  route("GET", "/assets/:id", async (req) => ({
    ...(await db.need("assets", req.params.id)),
    usedBy: await db.list("posts", "data->>'assetId'=$1", [req.params.id], 100),
  }));
  route("GET", "/assets/:id/content", async (req, reply) => {
    const asset = await db.need("assets", req.params.id);
    reply.type(asset.mime).header("Content-Disposition", "inline");
    reply.send(await media.bytes(asset));
  });
  route("PATCH", "/assets/:id", async (req) => {
    const a = await db.need("assets", req.params.id),
      b = req.body || {};
    expect(a, b);
    const c: Doc = {};
    for (const k of ["name", "collection", "style"])
      if (b[k] !== undefined) c[k] = String(b[k]).slice(0, 200);
    if (b.tags) c.tags = cleanTags(b.tags);
    if (b.enabled !== undefined) {
      requireThat(
        typeof b.enabled === "boolean",
        "INVALID_STATUS",
        "启停需要布尔值。",
      );
      c.enabled = b.enabled;
    }
    await db.audit("asset.updated", a.id, c);
    return db.update("assets", a.id, c, a.version);
  });
  route("GET", "/image-jobs", async (req) =>
    page(await db.list("image_jobs"), req.query),
  );
  route("POST", "/image-jobs", async (req, reply) => {
    reply.code(202);
    return idem(req, () => media.createJob(req.body || {}));
  });
  route("GET", "/image-jobs/:id", async (req) =>
    db.need("image_jobs", req.params.id),
  );
  route("GET", "/publication-jobs", async (req) => {
    let rows = await db.list("jobs", "TRUE", [], 5000);
    for (const k of ["state", "accountId", "kind", "presetId"])
      if (req.query[k]) rows = rows.filter((r) => r[k] === req.query[k]);
    return page(
      rows.map((j) => ({ ...j, capabilities: jobCapabilities(j) })),
      req.query,
    );
  });
  route("GET", "/publication-jobs/:id", async (req) => {
    const j = await db.need("jobs", req.params.id);
    const validationHistory = await db.list(
      "validation_runs",
      "data->>'jobId'=$1",
      [j.id],
    );
    const validationId = j.validationId || j.error?.details?.validationId;
    return {
      ...j,
      capabilities: jobCapabilities(j),
      content: j.contentId
        ? await db.need("content_versions", j.contentId)
        : null,
      asset: j.assetId ? await db.need("assets", j.assetId) : null,
      validation: validationId
        ? await db.get("validation_runs", validationId)
        : validationHistory[0] || null,
      validationHistory,
      generationRuns: await db.list("generation_runs", "data->>'jobId'=$1", [
        j.id,
      ]),
      sources: await db.list("source_snapshots", "data->>'jobId'=$1", [j.id]),
      attempts: await db.list("publish_attempts", "data->>'jobId'=$1", [j.id]),
      events: await db.list("events", "data->>'jobId'=$1", [j.id], 200),
    };
  });
  route("GET", "/publication-jobs/:id/events", async (req) =>
    page(
      await db.list("events", "data->>'jobId'=$1", [req.params.id], 5000),
      req.query,
    ),
  );
  route("POST", "/publication-jobs/:id/cancel", async (req) =>
    idem(req, () => control.cancel(req.params.id)),
  );
  route("POST", "/publication-jobs/:id/retry", async (req, reply) => {
    reply.code(202);
    return idem(req, () => control.retry(req.params.id));
  });
  route("POST", "/publication-jobs/:id/ai-revisions", async (req, reply) => {
    const j = await db.need("jobs", req.params.id);
    requireThat(
      j.contentId &&
        typeof req.body?.instructions === "string" &&
        req.body.instructions.length <= 8000,
      "REVISION_REQUIRED",
      "请填写修改要求。",
    );
    const c = await db.need("content_versions", j.contentId);
    requireThat(
      req.headers["idempotency-key"],
      "IDEMPOTENCY_KEY_REQUIRED",
      "需要幂等键。",
      400,
    );
    reply.code(202);
    return control.newJob(null, "preview", {
      presetId: j.presetId,
      parentJobId: j.id,
      baseText: c.text,
      revision: req.body.instructions,
      idempotencyKey: req.headers["idempotency-key"],
      includeImageGeneration: !!req.body.includeImageGeneration,
    });
  });
  route("POST", "/publication-jobs/:id/reconcile", async (req) =>
    idem(req, () =>
      pipeline.reconcile(req.params.id, String(req.body?.remoteId || "")),
    ),
  );
  route("GET", "/generation-runs/:id", async (req) =>
    db.need("generation_runs", req.params.id),
  );
  route("GET", "/posts", async (req) =>
    page(await searchablePosts(db, req.query), req.query),
  );
  route("GET", "/posts/:id", async (req) => {
    let p = await db.get("posts", req.params.id);
    if (!p && req.params.id.startsWith("draft_")) {
      const j = await db.need("jobs", req.params.id.slice(6));
      p = {
        ...j,
        id: `draft_${j.id}`,
        jobId: j.id,
        contentId: j.contentId,
        publishStatus: j.state,
        verificationStatus: "not_started",
      };
    }
    requireThat(p, "NOT_FOUND", "帖子记录不存在。", 404);
    return {
      ...p,
      content: await db.need("content_versions", p.contentId),
      asset: p.assetId ? await db.need("assets", p.assetId) : null,
      account: p.accountId ? await db.need("accounts", p.accountId) : null,
      sources: await db.list("source_snapshots", "data->>'jobId'=$1", [
        p.jobId,
      ]),
      attempts: await db.list("publish_attempts", "data->>'jobId'=$1", [
        p.jobId,
      ]),
      verifications: await db.list("verification_runs", "data->>'postId'=$1", [
        p.id,
      ]),
    };
  });
  route("POST", "/posts/:id/verify", async (req, reply) => {
    reply.code(202);
    return idem(req, async () => {
      const p = await db.need("posts", req.params.id);
      requireThat(
        p.remoteId,
        "REMOTE_ID_REQUIRED",
        "没有远端标识，不能公开核验。",
        409,
      );
      await db.update("posts", p.id, {
        verifyAfter: now(),
        verificationStatus: "pending",
        verifyAttempts: 0,
      });
      return { postId: p.id, status: "pending" };
    });
  });
  installAIRoutes({ route, db, control, vault, http, idem, page });
  route("GET", "/data-sources/catalog", async () => sourceCatalog);
  route("GET", "/data-sources", async (req) => {
    const reads = new Map(
      (await db.list("source_reads")).map((r) => [r.id, r]),
    );
    return page(
      (await db.list("sources")).map((s) => ({
        ...s,
        lastRead: sources.summary(reads.get(s.id) || null),
      })),
      req.query,
    );
  });
  route("POST", "/data-sources/probe-all", async () => {
    const rows = (await db.list("sources")).filter((s) => s.enabled);
    const results = await Promise.allSettled(
      rows.map((s) => sources.read(s, true)),
    );
    return rows.map((s, i) => {
      const r = results[i];
      return r.status === "fulfilled"
        ? {
            sourceId: s.id,
            name: s.name,
            ok: true,
            count: r.value.articles?.length ?? r.value.symbolsCount,
            transport: r.value.transport || "binance_spot",
          }
        : {
            sourceId: s.id,
            name: s.name,
            ok: false,
            error: errorInfo(r.reason),
          };
    });
  });
  const sourceInput = async (b: Doc, old?: Row) => {
    requireThat(
      ["binance_market", "blockbeats", "jinse", "article"].includes(
        b.type || old?.type,
      ),
      "INVALID_SOURCE",
      "不支持的数据源类型。",
    );
    const url =
      typeof (b.url ?? old?.url) === "string"
        ? (b.url ?? old?.url).trim().replace(/\/$/, "")
        : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Fault(
        "INVALID_SOURCE",
        "读取地址不是有效 URL，请填写完整的 https:// 地址。",
      );
    }
    const allowedHosts = b.allowedHosts ||
      old?.allowedHosts || [parsed.hostname];
    requireThat(
      Array.isArray(allowedHosts) &&
        allowedHosts.length &&
        allowedHosts.every(
          (h: unknown) => typeof h === "string" && /^[A-Za-z0-9.-]+$/.test(h),
        ),
      "INVALID_SOURCE",
      "请配置允许域名。",
    );
    if ((b.type || old?.type) === "binance_market")
      requireThat(
        parsed.pathname === "/" && !parsed.search && !parsed.hash,
        "INVALID_SOURCE",
        "币安行情请填写基础域名，例如 https://api.binance.com，不要附加接口路径。",
      );
    await http.checkUrl(url, {
      allowedHosts,
      allowPrivateNetwork: b.allowPrivateNetwork ?? old?.allowPrivateNetwork,
    });
    return {
      name: b.name || old?.name || "数据源",
      description: String(b.description ?? old?.description ?? "").slice(
        0,
        800,
      ),
      type: b.type || old?.type,
      url,
      allowedHosts,
      enabled: b.enabled ?? old?.enabled ?? true,
      allowPrivateNetwork:
        b.allowPrivateNetwork ?? old?.allowPrivateNetwork ?? false,
      maxAgeSeconds: boundedInt(
        b.maxAgeSeconds ?? old?.maxAgeSeconds ?? 259200,
        1,
        31536000,
      ),
    };
  };
  route("POST", "/data-sources", async (req) =>
    idem(req, async () =>
      db.insert("sources", await sourceInput(req.body || {})),
    ),
  );
  route("PATCH", "/data-sources/:id", async (req) => {
    const s = await db.need("sources", req.params.id);
    expect(s, req.body || {});
    return db.update(
      "sources",
      s.id,
      await sourceInput(req.body, s),
      s.version,
    );
  });
  route("POST", "/data-sources/:id/probe", async (req) => {
    const s = await db.need("sources", req.params.id);
    return sources.read(s, true);
  });
  route("GET", "/data-sources/:id/content", async (req) =>
    sources.content(await db.need("sources", req.params.id), req.query),
  );
  route("GET", "/audit-events", async (req) =>
    page(await db.list("audit_events", "TRUE", [], 5000), req.query),
  );
  route("GET", "/openapi.json", async () => ({
    openapi: "3.1.0",
    info: { title: "Square Service API", version: "0.2.0" },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "square_session" },
      },
    },
    paths: Object.fromEntries(
      [...new Set(routes.map((r) => r.path))].map((p) => [
        p.replace(/:([A-Za-z]+)/g, "{$1}"),
        Object.fromEntries(
          routes
            .filter((r) => r.path === p)
            .map((r) => [
              r.method.toLowerCase(),
              {
                security: r.authenticated ? [{ session: [] }] : [],
                responses: {
                  200: { description: "JSON envelope: data and meta" },
                  "4XX": { description: "Structured error envelope" },
                },
              },
            ]),
        ),
      ]),
    ),
  }));
  const webDir = process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : null;
  if (webDir)
    app.get("/*", async (req, reply) => {
      if (req.url.startsWith("/api/"))
        throw new Fault("NOT_FOUND", "接口不存在。", 404);
      let file = path.resolve(
        webDir,
        "." + decodeURIComponent(req.url.split("?")[0]),
      );
      requireThat(
        file.startsWith(webDir + path.sep) || file === webDir,
        "NOT_FOUND",
        "页面不存在。",
        404,
      );
      try {
        if ((await stat(file)).isDirectory())
          file = path.join(file, "index.html");
        await stat(file);
      } catch {
        file = path.join(webDir, "index.html");
      }
      reply.type(
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          } as Doc
        )[path.extname(file)] || "application/octet-stream",
      );
      return reply.send(await readFile(file));
    });
  app.addHook("onClose", async () => {
    await pipeline.stop();
    await http.close();
    if (!provided?.db) await db.close();
  });
  return { app, db, control, pipeline, media, ai, sources, http };
}
function jobCapabilities(j: Row) {
  return {
    cancel:
      ACTIVE.includes(j.state) &&
      !["submitting", "submission_unknown"].includes(j.state),
    retry:
      ["failed", "blocked", "retry_wait"].includes(j.state) &&
      !j.publishAttemptId,
    aiRevision: !!j.contentId,
    verify: j.state === "published",
  };
}
function boundedInt(v: number, min: number, max: number) {
  requireThat(
    Number.isInteger(v) && v >= min && v <= max,
    "INVALID_NUMBER",
    `数值必须为${min}—${max}之间的整数。`,
  );
  return v;
}
function page(rows: Row[], q: Doc) {
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 30));
  let filtered = rows;
  if (q.cursor) {
    let cursor: Doc;
    try {
      cursor = JSON.parse(
        Buffer.from(String(q.cursor), "base64url").toString(),
      );
    } catch {
      throw new Fault("INVALID_CURSOR", "分页标识无效。", 400);
    }
    requireThat(
      cursor.createdAt && cursor.id,
      "INVALID_CURSOR",
      "分页标识无效。",
      400,
    );
    filtered = rows.filter(
      (r) =>
        r.createdAt < cursor.createdAt ||
        (r.createdAt === cursor.createdAt && r.id < cursor.id),
    );
  }
  const data = filtered.slice(0, limit),
    last = data.at(-1),
    hasMore = filtered.length > limit;
  return {
    __page: true,
    data,
    meta: {
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ createdAt: last.createdAt, id: last.id }),
            ).toString("base64url")
          : null,
    },
  };
}
