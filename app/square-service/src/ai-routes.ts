import { Control, cleanTags, expect } from "./control.js";
import {
  Database,
  Doc,
  Row,
  Vault,
  Fault,
  errorInfo,
  id,
  now,
  requireThat,
} from "./core.js";
import { Http } from "./http.js";
import {
  protocols,
  providerProfiles,
  protocolFor,
  providerHeaders,
  resolveModel,
} from "./providers.js";

export function installAIRoutes({
  route,
  db,
  control,
  vault,
  http,
  idem,
  page,
}: {
  route: (
    method: string,
    path: string,
    handler: (req: any) => Promise<any>,
  ) => void;
  db: Database;
  control: Control;
  vault: Vault;
  http: Http;
  idem: (req: any, fn: () => Promise<any>) => Promise<any>;
  page: (items: Row[], query: any) => any;
}) {
  const integer = (v: any, min: number, max: number) => {
    requireThat(
      Number.isSafeInteger(v) && v >= min && v <= max,
      "INVALID_CONNECTION",
      `参数须为 ${min}—${max} 之间的整数。`,
    );
    return v;
  };
  const input = async (b: Doc, old?: Row) => {
    const value = { ...old, ...b },
      protocol = value.protocol || "openai_chat_images";
    requireThat(
      typeof value.name === "string" &&
        value.name.trim() &&
        value.name.length <= 120,
      "INVALID_CONNECTION",
      "请填写不超过120字的连接名称。",
    );
    requireThat(
      typeof value.baseUrl === "string",
      "INVALID_CONNECTION",
      "请填写 API 基础地址。",
    );
    const baseUrl = value.baseUrl.trim().replace(/\/+$/, "");
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Fault(
        "INVALID_CONNECTION",
        "API 基础地址不是有效 URL，请填写完整的 https:// 地址。",
      );
    }
    requireThat(
      !url.search && !url.hash && !url.username && !url.password,
      "INVALID_CONNECTION",
      "基础地址不能包含查询参数、片段或登录凭据。",
    );
    requireThat(
      !/\/(chat\/completions|responses|messages|images\/generations|models)$/.test(
        url.pathname,
      ),
      "INVALID_CONNECTION",
      "请填写 API 基础地址（例如以 /v1 结尾），无需填写具体接口路径。",
    );
    requireThat(
      value.enabled === undefined || typeof value.enabled === "boolean",
      "INVALID_CONNECTION",
      "启用状态须为布尔值。",
    );
    requireThat(
      value.allowPrivateNetwork === undefined ||
        typeof value.allowPrivateNetwork === "boolean",
      "INVALID_CONNECTION",
      "内网访问状态须为布尔值。",
    );
    protocolFor({ protocol });
    requireThat(
      providerProfiles.some((p) => p.id === (value.provider || "custom")),
      "INVALID_CONNECTION",
      "请选择支持的服务商或自定义网关。",
    );
    await http.checkUrl(baseUrl, {
      allowPrivateNetwork: value.allowPrivateNetwork ?? false,
    });
    return {
      name: value.name.trim(),
      provider: value.provider || "custom",
      protocol,
      baseUrl,
      enabled: value.enabled ?? true,
      allowPrivateNetwork: value.allowPrivateNetwork ?? false,
      assetHosts: cleanTags(value.assetHosts),
      concurrency: integer(value.concurrency ?? 2, 1, 100),
      timeoutMs: integer(value.timeoutMs ?? 120000, 1000, 600000),
    };
  };
  route("GET", "/ai/catalog", async () => ({
    providers: providerProfiles,
    protocols,
  }));
  route("GET", "/ai/settings", async () => {
    const settings = await db.need("runtime", "ai");
    const status = async (type: "text" | "image") => {
      try {
        const r = await resolveModel(db, "@default", type);
        return {
          available: true,
          modelId: r.model.id,
          name: r.model.name,
          externalId: r.model.externalId,
          connectionName: r.connection.name,
        };
      } catch (e) {
        return { available: false, error: errorInfo(e) };
      }
    };
    return {
      ...settings,
      text: await status("text"),
      image: await status("image"),
    };
  });
  route("PATCH", "/ai/settings", async (req) =>
    db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const old = await t.need("runtime", "ai", true),
        b = req.body || {};
      expect(old, b);
      const changes: Doc = {};
      for (const [field, type] of [
        ["defaultTextModelId", "text"],
        ["defaultImageModelId", "image"],
      ] as const) {
        if (b[field] !== undefined) {
          requireThat(
            typeof b[field] === "string" && b[field] !== "@default",
            "INVALID_AI_DEFAULT",
            "请选择实际模型，或清空默认设置。",
          );
          if (b[field]) await resolveModel(t, b[field], type);
          changes[field] = b[field];
        }
      }
      const result = await t.update("runtime", "ai", changes, old.version);
      await t.audit("ai.defaults_updated", "ai", changes);
      return result;
    }),
  );
  route("GET", "/model-connections", async (req) =>
    page(await db.list("connections"), req.query),
  );
  route("POST", "/model-connections", async (req) =>
    idem(req, async () => {
      const b = req.body || {},
        values = await input(b);
      return db.transaction(async (t) => {
        const connectionId = id("conn"),
          credential = await control.credential(
            t,
            "model",
            connectionId,
            b.apiKey,
          );
        const result = await t.insert(
          "connections",
          {
            ...values,
            credentialId: credential.id,
            credentialMask: credential.mask,
            credentialVersion: 1,
            lastProbe: null,
          },
          connectionId,
        );
        await t.audit("connection.created", result.id, {
          provider: result.provider,
          protocol: result.protocol,
        });
        return result;
      });
    }),
  );
  route("PATCH", "/model-connections/:id", async (req) => {
    const old = await db.need("connections", req.params.id),
      b = req.body || {};
    expect(old, b);
    const changes: Doc = await input(b, old);
    if (
      changes.baseUrl !== old.baseUrl ||
      changes.protocol !== old.protocol ||
      changes.allowPrivateNetwork !== old.allowPrivateNetwork
    )
      changes.lastProbe = null;
    return db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const current = await t.need("connections", old.id, true);
      expect(current, b);
      if (b.apiKey !== undefined) {
        const credential = await control.credential(
          t,
          "model",
          old.id,
          b.apiKey,
          (current.credentialVersion || 1) + 1,
        );
        changes.credentialId = credential.id;
        changes.credentialMask = credential.mask;
        changes.credentialVersion = credential.versionNumber;
        changes.lastProbe = null;
      }
      const result = await t.update(
        "connections",
        old.id,
        changes,
        current.version,
      );
      await t.audit("connection.updated", old.id, {
        ...changes,
        credentialId: changes.credentialId,
      });
      return result;
    });
  });
  route("POST", "/model-connections/:id/credentials/rotate", async (req) =>
    idem(req, () =>
      control.rotate("connections", req.params.id, req.body?.apiKey),
    ),
  );
  route("POST", "/model-connections/:id/probe", async (req) => {
    requireThat(
      !req.body?.billable,
      "BILLABLE_PROBE_UNSUPPORTED",
      "连接检查仅请求只读模型列表；生成能力请通过预览任务验证。",
    );
    const c = await db.need("connections", req.params.id),
      key = vault.open((await db.need("credentials", c.credentialId)).box),
      started = Date.now();
    try {
      const response = await http.request(
        `${c.baseUrl}/models`,
        { headers: providerHeaders(c, key) },
        {
          allowPrivateNetwork: c.allowPrivateNetwork,
          allowedHosts: [new URL(c.baseUrl).hostname],
          timeoutMs: Math.min(c.timeoutMs || 30000, 30000),
          secrets: [key],
        },
      );
      const raw = response.json();
      requireThat(
        Array.isArray(raw.data),
        "MODEL_CATALOG_INVALID",
        "服务没有返回 data 模型列表；可改用手动登记模型。",
        502,
      );
      const seen = new Set<string>();
      const models = raw.data
        .filter(
          (m: Doc) =>
            typeof m.id === "string" &&
            m.id.length &&
            m.id.length <= 300 &&
            !seen.has(m.id) &&
            seen.add(m.id),
        )
        .slice(0, 500)
        .map((m: Doc) => ({
          id: m.id,
          name: String(m.display_name || m.id).slice(0, 300),
        }));
      const lastProbe = {
        state: "completed",
        checkedAt: now(),
        latencyMs: Date.now() - started,
        modelCount: models.length,
        partial: !!raw.has_more || raw.data.length > 500,
        models,
        generationCapability: "not_tested",
      };
      await db.update("connections", c.id, { lastProbe }, c.version);
      await db.audit("connection.probed", c.id, { modelCount: models.length });
      return { mode: "read_only", ...lastProbe };
    } catch (e) {
      // A changed connection must not inherit a probe result for an older endpoint/key.
      const current = await db.need("connections", c.id);
      if (current.version === c.version)
        await db.update(
          "connections",
          c.id,
          {
            lastProbe: {
              state: "failed",
              checkedAt: now(),
              latencyMs: Date.now() - started,
              error: errorInfo(e),
            },
          },
          c.version,
        );
      throw e;
    }
  });
  route("GET", "/models", async (req) =>
    page(await db.list("models"), req.query),
  );
  route("POST", "/models", async (req) =>
    idem(req, async () =>
      db.transaction(async (t) => {
        const b = req.body || {},
          c = await t.need("connections", b.connectionId, true);
        requireThat(
          ["text", "image"].includes(b.type) &&
            typeof b.externalId === "string" &&
            b.externalId.trim() &&
            b.externalId.length <= 300 &&
            typeof b.approved === "boolean",
          "INVALID_MODEL",
          "请填写模型类型、实际模型 ID 和批准状态。",
        );
        if (b.type === "image")
          requireThat(
            b.family === "gpt-image-2" && protocolFor(c).images,
            "INVALID_IMAGE_MODEL",
            "图片模型须为 GPT Image 2，且连接协议支持 Images 接口。",
          );
        const duplicate = await t.list(
          "models",
          "data->>'connectionId'=$1 AND data->>'type'=$2 AND data->>'externalId'=$3",
          [c.id, b.type, b.externalId.trim()],
        );
        requireThat(
          !duplicate.length,
          "MODEL_ALREADY_REGISTERED",
          "这个连接下已登记该模型，无需重复添加。",
          409,
          { modelId: duplicate[0]?.id },
        );
        requireThat(
          !b.defaultParameters ||
            (typeof b.defaultParameters === "object" &&
              !Array.isArray(b.defaultParameters)),
          "INVALID_MODEL",
          "默认参数必须是 JSON 对象。",
        );
        const result = await t.insert("models", {
          name: String(b.name || b.externalId).slice(0, 120),
          externalId: b.externalId.trim(),
          type: b.type,
          family: b.type === "image" ? "gpt-image-2" : "text",
          approved: b.approved,
          connectionId: c.id,
          allowedParameters: cleanTags(b.allowedParameters),
          defaultParameters: b.defaultParameters || {},
        });
        await t.audit("model.registered", result.id);
        return result;
      }),
    ),
  );
  route("PATCH", "/models/:id", async (req) => {
    const m = await db.need("models", req.params.id);
    expect(m, req.body || {});
    requireThat(
      typeof req.body.approved === "boolean",
      "INVALID_MODEL",
      "请指定批准状态。",
    );
    const result = await db.update(
      "models",
      m.id,
      { approved: req.body.approved },
      m.version,
    );
    await db.audit("model.approval_changed", m.id, {
      approved: req.body.approved,
    });
    return result;
  });
}
