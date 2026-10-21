import {
  Database,
  Store,
  Vault,
  Doc,
  Row,
  Fault,
  id,
  now,
  hash,
  random,
  requireThat,
} from "./core.js";
import { exampleRules, interval, parseRules, weighted } from "./rules.js";
import { resolveRules } from "./providers.js";
import { ensureSources } from "./source-catalog.js";

export const ACTIVE = [
  "queued",
  "preparing",
  "generating_text",
  "validating",
  "preparing_media",
  "ready",
  "submitting",
  "retry_wait",
  "submission_unknown",
];
export const activeWhere =
  "data->>'kind'<>'preview' AND data->>'state'=ANY($1::text[])";
export class Control {
  constructor(
    public db: Database,
    public vault: Vault,
  ) {}
  async bootstrap() {
    await this.db.transaction(async (t) => {
      if (!(await t.get("runtime", "main")))
        await t.insert(
          "runtime",
          {
            paused: true,
            pauseEpoch: 1,
            concurrency: 3,
            textConcurrency: 2,
            imageConcurrency: 1,
            contentValidationMode: "strict",
            globalBannedWords: ["情绪"],
            leaseSeconds: 120,
            stepRetries: 2,
          },
          "main",
        );
      if (!(await t.get("runtime", "ai")))
        await t.insert(
          "runtime",
          { defaultTextModelId: "", defaultImageModelId: "" },
          "ai",
        );
      await ensureSources(t);
    });
  }
  async credential(
    t: Store,
    kind: string,
    ownerId: string,
    key: string,
    version = 1,
  ) {
    requireThat(
      typeof key === "string" &&
        key.trim().length >= 12 &&
        key.trim().length <= 4096,
      "INVALID_CREDENTIAL",
      "凭据长度必须在12—4096字符之间。",
    );
    const value = key.trim(),
      fingerprint = this.vault.fingerprint(value);
    const existing = await t.list(
      "credentials",
      "data->>'kind'=$1 AND data->>'fingerprint'=$2 AND (data->>'active')::boolean",
      [kind, fingerprint],
    );
    requireThat(
      !existing.some((c) => c.ownerId !== ownerId),
      "DUPLICATE_CREDENTIAL",
      "该凭据已属于另一个账号。",
      409,
    );
    for (const c of existing)
      await t.update("credentials", c.id, { active: false });
    return t.insert("credentials", {
      kind,
      ownerId,
      versionNumber: version,
      box: this.vault.seal(value),
      fingerprint,
      mask: `•••• ${value.slice(-4)}`,
      active: true,
    });
  }
  async createAccount(input: Doc) {
    requireThat(
      typeof input.name === "string" &&
        input.name.trim().length > 0 &&
        input.name.length <= 120,
      "INVALID_ACCOUNT",
      "请填写账号名称。",
    );
    return this.db.transaction(async (t) => {
      const accountId = id("acct");
      const key = await this.credential(t, "square", accountId, input.apiKey);
      const account = await t.insert(
        "accounts",
        {
          name: input.name.trim(),
          uid: String(input.uid || ""),
          notes: String(input.notes || "").slice(0, 4000),
          tags: cleanTags(input.tags),
          status: "active",
          controlVersion: 1,
          credentialId: key.id,
          credentialVersion: 1,
          credentialMask: key.mask,
          credentialHealth: "unverified",
          blockReason: null,
          lastPublishedAt: null,
        },
        accountId,
      );
      await t.insert(
        "schedules",
        {
          accountId,
          enabled: false,
          minIntervalSeconds: 1200,
          maxIntervalSeconds: 2400,
          nextDueAt: null,
          anchorAt: null,
          sampledDelaySeconds: null,
        },
        accountId,
      );
      await t.insert("bindings", { accountId, bindings: [] }, accountId);
      await t.audit("account.created", accountId);
      return account;
    });
  }
  async patchAccount(accountId: string, input: Doc) {
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const a = await t.need("accounts", accountId, true);
      expect(a, input);
      requireThat(
        ["active", "disabled"].includes(input.status || a.status),
        "INVALID_ACCOUNT_STATUS",
        "无效账号状态。",
      );
      const changes: Doc = { controlVersion: a.controlVersion + 1 };
      for (const k of ["name", "uid", "notes", "status"])
        if (input[k] !== undefined)
          changes[k] = String(input[k]).slice(0, k === "notes" ? 4000 : 120);
      if (input.tags !== undefined) changes.tags = cleanTags(input.tags);
      const result = await t.update("accounts", accountId, changes, a.version);
      await t.audit("account.updated", accountId, changes);
      return result;
    });
  }
  async rotate(kind: "accounts" | "connections", ownerId: string, key: string) {
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const owner = await t.need(kind, ownerId, true);
      const old = owner.credentialId
        ? await t.need("credentials", owner.credentialId)
        : null;
      if (old) await t.update("credentials", old.id, { active: false });
      const c = await this.credential(
        t,
        kind === "accounts" ? "square" : "model",
        ownerId,
        key,
        (old?.versionNumber || 0) + 1,
      );
      const change: Doc = {
        credentialId: c.id,
        credentialMask: c.mask,
        credentialVersion: c.versionNumber,
        credentialHealth: "unverified",
      };
      if (kind === "connections") change.lastProbe = null;
      if (kind === "accounts") {
        change.controlVersion = owner.controlVersion + 1;
        if (owner.blockReason === "ACCOUNT_CREDENTIAL_INVALID")
          change.blockReason = null;
      }
      await t.audit("credential.rotated", ownerId, {
        kind,
        credentialVersion: c.versionNumber,
      });
      return t.update(kind, ownerId, change);
    });
  }
  async importAccounts(items: Doc[]) {
    requireThat(
      Array.isArray(items) && items.length > 0 && items.length <= 1000,
      "INVALID_IMPORT",
      "请提供1—1000个 API Key。",
    );
    const results: Doc[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const item = items[i];
        requireThat(
          item && typeof item === "object" && !Array.isArray(item),
          "INVALID_ACCOUNT",
          "每条导入记录须包含 API Key。",
        );
        requireThat(
          typeof item.apiKey !== "string" ||
            !/[\s,，]/.test(item.apiKey.trim()),
          "INVALID_CREDENTIAL",
          "每行只填写一个 API Key，不要附加账号名称或 UID。",
        );
        const name =
          item.name == null ||
          (typeof item.name === "string" && !item.name.trim())
            ? `广场账号 ${id("import").slice(-8).toUpperCase()}`
            : item.name;
        const a = await this.createAccount({ ...item, name });
        results.push({
          line: i + 1,
          status: "created",
          accountId: a.id,
          name: a.name,
        });
      } catch (e: any) {
        results.push({
          line: i + 1,
          status: "rejected",
          code: e.code || "INVALID_ACCOUNT",
          message: e.message,
        });
      }
    }
    return results;
  }
  async archive(accountId: string, expectedVersion: number) {
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const a = await t.need("accounts", accountId, true);
      expect(a, { expectedVersion });
      await t.update("schedules", accountId, { enabled: false });
      await t.audit("account.archived", accountId);
      return t.update("accounts", accountId, {
        status: "archived",
        controlVersion: a.controlVersion + 1,
      });
    });
  }
  async candidates(
    t: Store,
    accountId: string,
  ): Promise<{ bindingVersion: number; bindings: Doc[] }> {
    const b = await t.need("bindings", accountId),
      result: Doc[] = [];
    for (const binding of b.bindings) {
      const p = await t.get("presets", binding.presetId);
      let reason = null;
      if (!binding.enabled || binding.weight <= 0) reason = "binding_disabled";
      else if (!p || !p.enabled) reason = "preset_disabled";
      else if (!p.publishedVersionId) reason = "no_published_version";
      const v = p?.publishedVersionId
        ? await t.get("preset_versions", p.publishedVersionId)
        : null;
      if (!reason && v) {
        try {
          await resolveRules(t, v.rules);
        } catch (e) {
          if (e instanceof Fault)
            reason =
              e.code === "IMAGE_MODEL_UNAVAILABLE"
                ? "image_model_unavailable"
                : "text_model_unavailable";
          else throw e;
        }
      }
      result.push({
        ...binding,
        presetName: p?.name || "不存在的预设",
        presetVersionId: v?.id,
        reason,
      });
    }
    const sum = result
      .filter((x) => !x.reason)
      .reduce((n, x) => n + x.weight, 0);
    return {
      bindingVersion: b.version,
      bindings: result.map((x) => ({
        ...x,
        probability: !x.reason && sum > 0 ? x.weight / sum : 0,
      })),
    };
  }
  async bindings(accountId: string, input: Doc) {
    return this.db.transaction(async (t) => {
      const a = await t.need("accounts", accountId, true),
        b = await t.need("bindings", accountId, true);
      expect(b, input);
      requireThat(
        Array.isArray(input.bindings),
        "INVALID_BINDINGS",
        "请提供预设绑定列表。",
      );
      const seen = new Set<string>();
      for (const v of input.bindings) {
        requireThat(
          typeof v.presetId === "string" &&
            !seen.has(v.presetId) &&
            Number.isFinite(v.weight) &&
            v.weight >= 0 &&
            typeof v.enabled === "boolean",
          "INVALID_BINDINGS",
          "预设不得重复，权重必须是非负有限数。",
        );
        seen.add(v.presetId);
        await t.need("presets", v.presetId);
      }
      await t.update(
        "bindings",
        accountId,
        {
          bindings: input.bindings.map((v: Doc) => ({
            presetId: v.presetId,
            weight: v.weight,
            enabled: v.enabled,
          })),
        },
        b.version,
      );
      const c = await this.candidates(t, accountId);
      requireThat(
        c.bindings.some((b) => b.probability > 0),
        "NO_ELIGIBLE_PRESET",
        "请至少绑定一个已批准模型和已发布版本的有效预设。",
      );
      if (a.blockReason === "NO_ELIGIBLE_PRESET")
        await t.update("accounts", accountId, { blockReason: null });
      await t.audit("bindings.updated", accountId, { bindings: c.bindings });
      return c;
    });
  }
  async savePreset(input: Doc, presetId?: string) {
    const rules = parseRules(input.rules);
    requireThat(
      input.enabled === undefined || typeof input.enabled === "boolean",
      "INVALID_STATUS",
      "启用状态需为布尔值。",
    );
    requireThat(
      typeof input.name === "string" && input.name.trim(),
      "INVALID_PRESET_NAME",
      "请填写预设名称。",
    );
    return this.db.transaction(async (t) => {
      if (!presetId) {
        const p = await t.insert("presets", {
          name: input.name.trim(),
          description: String(input.description || ""),
          enabled: true,
          draftRules: rules,
          publishedVersionId: null,
          publishedNumber: 0,
        });
        await t.audit("preset.created", p.id);
        return p;
      }
      const p = await t.need("presets", presetId, true);
      expect(p, input);
      const r = await t.update(
        "presets",
        presetId,
        {
          name: input.name.trim(),
          description: String(input.description || ""),
          enabled: input.enabled ?? p.enabled,
          draftRules: rules,
        },
        p.version,
      );
      await t.audit("preset.draft_saved", presetId);
      return r;
    });
  }
  async publishPreset(presetId: string, input: Doc) {
    return this.db.transaction(async (t) => {
      const p = await t.need("presets", presetId, true);
      expect(p, input);
      const rules = parseRules(p.draftRules);
      await resolveRules(t, rules);
      const number = p.publishedNumber + 1,
        v = await t.insert("preset_versions", {
          presetId,
          number,
          name: p.name,
          rules,
          rulesHash: hash(JSON.stringify(rules)),
          changeNote: String(input.changeNote || ""),
        });
      await t.audit("preset.version_published", presetId, {
        versionId: v.id,
        number,
      });
      return t.update("presets", presetId, {
        publishedVersionId: v.id,
        publishedNumber: number,
      });
    });
  }
  sample(s: Row, anchor = now()) {
    const delay = interval(s.minIntervalSeconds, s.maxIntervalSeconds);
    return {
      anchorAt: anchor,
      sampledDelaySeconds: delay,
      nextDueAt: new Date(Date.parse(anchor) + delay * 1000).toISOString(),
    };
  }
  async schedule(accountId: string, input: Doc, action = "save") {
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const a = await t.need("accounts", accountId, true),
        s = await t.need("schedules", accountId, true);
      expect(s, input);
      const changes: Doc = {};
      if (action === "save") {
        requireThat(
          input.enabled === undefined || typeof input.enabled === "boolean",
          "INVALID_STATUS",
          "计划状态需为布尔值。",
        );
        interval(input.minIntervalSeconds, input.maxIntervalSeconds);
        Object.assign(changes, {
          minIntervalSeconds: input.minIntervalSeconds,
          maxIntervalSeconds: input.maxIntervalSeconds,
          enabled: input.enabled ?? s.enabled,
        });
      } else if (action === "pause") changes.enabled = false;
      else if (action === "resume") changes.enabled = true;
      requireThat(
        ["save", "pause", "resume", "resample"].includes(action),
        "INVALID_ACTION",
        "无效调度操作。",
      );
      if (changes.enabled === true || action === "resample") {
        requireThat(
          a.status === "active" && !a.blockReason,
          "ACCOUNT_PAUSED",
          "账号已停用或存在阻塞。",
          409,
          { reason: a.blockReason },
        );
        const c = await this.candidates(t, accountId);
        requireThat(
          c.bindings.some((b) => b.probability > 0),
          "NO_ELIGIBLE_PRESET",
          "尚未配置有效预设。",
          409,
        );
      }
      const active = await t.list(
        "jobs",
        `${activeWhere} AND data->>'accountId'=$2`,
        [ACTIVE, accountId],
      );
      const resample =
        action === "resume" ||
        action === "resample" ||
        (changes.enabled && !s.enabled);
      if (resample) {
        requireThat(
          !active.length,
          "ACCOUNT_BUSY",
          "该账号有在途任务，请先处理。",
          409,
          { jobId: active[0]?.id },
        );
        Object.assign(changes, this.sample({ ...s, ...changes }));
      }
      if (action === "pause" || (changes.enabled === false && s.enabled))
        await t.update("accounts", accountId, {
          controlVersion: a.controlVersion + 1,
        });
      await t.audit(`schedule.${action}`, accountId, changes);
      return t.update("schedules", accountId, changes, s.version);
    });
  }
  async runtime(input: Doc) {
    return this.db.transaction(async (t) => {
      const r = await t.need("runtime", "main", true);
      expect(r, input);
      const changes: Doc = {};
      for (const k of [
        "concurrency",
        "textConcurrency",
        "imageConcurrency",
        "leaseSeconds",
        "stepRetries",
      ])
        if (input[k] !== undefined) {
          requireThat(
            Number.isInteger(input[k]) &&
              input[k] >=
                (k === "stepRetries" ? 0 : k === "leaseSeconds" ? 30 : 1) &&
              input[k] <= (k === "stepRetries" ? 10 : 1000),
            "INVALID_RUNTIME",
            "并发、租约和重试范围不正确。",
          );
          changes[k] = input[k];
        }
      if (input.globalBannedWords !== undefined) {
        requireThat(
          Array.isArray(input.globalBannedWords),
          "INVALID_RUNTIME",
          "禁词需为数组。",
        );
        changes.globalBannedWords = [
          ...new Set(["情绪", ...input.globalBannedWords.map(String)]),
        ];
      }
      if (input.contentValidationMode !== undefined) {
        requireThat(
          ["strict", "publish_first"].includes(input.contentValidationMode),
          "INVALID_RUNTIME",
          "内容校验模式无效。",
        );
        changes.contentValidationMode = input.contentValidationMode;
      }
      if (input.paused !== undefined) {
        requireThat(
          typeof input.paused === "boolean",
          "INVALID_RUNTIME",
          "暂停状态需为布尔值。",
        );
        changes.paused = input.paused;
        changes.pauseEpoch = r.pauseEpoch + (r.paused !== input.paused ? 1 : 0);
        if (r.paused && !input.paused) {
          for (const s of await t.list(
            "schedules",
            "(data->>'enabled')::boolean",
          )) {
            const a = await t.need("accounts", s.accountId, true);
            const active = await t.list(
              "jobs",
              `${activeWhere} AND data->>'accountId'=$2`,
              [ACTIVE, a.id],
            );
            if (a.status === "active" && !a.blockReason && !active.length)
              await t.update("schedules", s.id, this.sample(s));
          }
        }
      }
      await t.audit("runtime.updated", "main", changes);
      return t.update("runtime", "main", changes, r.version);
    });
  }
  async newJob(
    accountId: string | null,
    kind: "manual" | "scheduled" | "preview",
    options: Doc = {},
    tx?: Store,
  ): Promise<Row> {
    const create = async (t: Store) => {
      const runtime = await t.need("runtime", "main", true),
        scope = options.idempotencyKey
          ? `${kind}:${accountId || options.presetId}:${options.idempotencyKey}`
          : null;
      const requestHash = hash(
        JSON.stringify({
          accountId,
          kind,
          presetId: options.presetId || null,
          includeImageGeneration: !!options.includeImageGeneration,
          revision: options.revision || "",
        }),
      );
      if (scope) {
        const old = await t.list("jobs", "data->>'idempotencyScope'=$1", [
          scope,
        ]);
        if (old[0]) {
          requireThat(
            old[0].requestHash === requestHash,
            "IDEMPOTENCY_CONFLICT",
            "同一幂等键已用于不同参数。",
            409,
          );
          return old[0];
        }
      }
      let a: Row | null = null,
        s: Row | null = null,
        selection: Doc;
      if (kind !== "preview") {
        requireThat(!runtime.paused, "GLOBAL_PAUSED", "全局发送已暂停。", 409);
        a = await t.need("accounts", accountId!, true);
        s = await t.need("schedules", accountId!, true);
        requireThat(
          a.status === "active" && !a.blockReason,
          "ACCOUNT_PAUSED",
          "账号不可发布。",
          409,
          { reason: a.blockReason },
        );
        const active = await t.list(
          "jobs",
          `${activeWhere} AND data->>'accountId'=$2`,
          [ACTIVE, accountId],
        );
        requireThat(!active.length, "ACCOUNT_BUSY", "账号已有活动任务。", 409, {
          jobId: active[0]?.id,
        });
        if (kind === "scheduled")
          requireThat(
            s.enabled && s.nextDueAt && s.nextDueAt <= now(),
            "NOT_DUE",
            "计划尚未到期。",
            409,
          );
        const candidates = (
          await this.candidates(t, accountId!)
        ).bindings.filter((b) => !b.reason);
        if (options.presetId) {
          requireThat(
            candidates.some(
              (c) => c.presetId === options.presetId && c.weight > 0,
            ),
            "NO_ELIGIBLE_PRESET",
            "指定预设未有效绑定。",
          );
          selection = weighted(
            candidates.filter((c) => c.presetId === options.presetId),
          );
        } else selection = weighted(candidates);
      } else {
        const p = await t.need("presets", options.presetId);
        requireThat(
          p.publishedVersionId,
          "NO_PUBLISHED_VERSION",
          "请先发布预设版本。",
        );
        selection = {
          selected: { presetId: p.id, presetVersionId: p.publishedVersionId },
          draw: null,
          candidates: [],
          totalWeight: 0,
        };
      }
      const v = await t.need(
        "preset_versions",
        selection.selected.presetVersionId,
      );
      const resolved = await resolveRules(t, v.rules);
      const job = await t.insert("jobs", {
        accountId,
        kind,
        presetId: v.presetId,
        presetVersionId: v.id,
        rules: resolved.rules,
        modelSelection: resolved.modelSelection,
        selection,
        state: "queued",
        stage: "queued",
        controlVersion: a?.controlVersion || 0,
        scheduleVersion: s?.version || 0,
        pauseEpoch: runtime.pauseEpoch,
        scheduledFor: kind === "scheduled" ? s?.nextDueAt : null,
        leaseOwner: null,
        leaseUntil: null,
        fence: 0,
        attempt: 0,
        retryAt: null,
        idempotencyScope: scope,
        requestHash,
        includeImageGeneration: !!options.includeImageGeneration,
        parentJobId: options.parentJobId || null,
        revision: options.revision || "",
        baseText: options.baseText || null,
      });
      if (s)
        await t.update("schedules", s.id, {
          nextDueAt: null,
          activeJobId: job.id,
        });
      await t.event(job.id, "queued", { kind, selection });
      return job;
    };
    return tx ? create(tx) : this.db.transaction(create);
  }
  async due() {
    for (const a of await this.db.list(
      "accounts",
      "data->>'blockReason'='REMOTE_RATE_LIMITED' AND data->>'cooldownUntil'<=$1",
      [now()],
    ))
      await this.db.transaction(async (t) => {
        await t.need("runtime", "main", true);
        const current = await t.need("accounts", a.id, true);
        if (
          current.blockReason !== "REMOTE_RATE_LIMITED" ||
          current.cooldownUntil > now()
        )
          return;
        await t.update("accounts", a.id, {
          blockReason: null,
          cooldownUntil: null,
        });
        const s = await t.need("schedules", a.id, true);
        if (s.enabled && a.status === "active")
          await t.update("schedules", s.id, this.sample(s));
        await t.audit("account.cooldown_completed", a.id);
      });
    const runtime = await this.db.need("runtime", "main");
    if (runtime.paused) return [];
    const schedules = await this.db.list(
      "schedules",
      "(data->>'enabled')::boolean AND data->>'nextDueAt'<=$1",
      [now()],
      100,
    );
    const created: Row[] = [];
    for (const s of schedules) {
      try {
        created.push(await this.newJob(s.accountId, "scheduled"));
      } catch (e: any) {
        if (["NO_ELIGIBLE_PRESET", "TEXT_MODEL_UNAVAILABLE"].includes(e.code))
          await this.db.update("accounts", s.accountId, {
            blockReason: e.code,
          });
        if (
          ![
            "ACCOUNT_BUSY",
            "NOT_DUE",
            "GLOBAL_PAUSED",
            "ACCOUNT_PAUSED",
          ].includes(e.code)
        )
          await this.db.audit("schedule.claim_failed", s.accountId, {
            code: e.code,
            message: e.message,
          });
      }
    }
    return created;
  }
  async settle(t: Store, job: Row, state: string, changes: Doc = {}) {
    const done = await t.update("jobs", job.id, {
      state,
      stage: state,
      terminalAt: now(),
      leaseOwner: null,
      leaseUntil: null,
      ...changes,
    });
    if (job.kind !== "preview") {
      const a = await t.need("accounts", job.accountId, true),
        s = await t.need("schedules", job.accountId, true);
      if (state === "submission_unknown") {
        await t.update("accounts", a.id, {
          blockReason: "PUBLISH_RESULT_UNKNOWN",
        });
        await t.update("schedules", s.id, {
          nextDueAt: null,
          activeJobId: job.id,
        });
      } else {
        let change: Doc = { activeJobId: null };
        if (s.enabled && a.status === "active" && !a.blockReason)
          change = {
            ...change,
            ...this.sample(s, changes.publishConfirmedAt || now()),
          };
        await t.update("schedules", s.id, change);
      }
    }
    await t.event(job.id, state, changes);
    return done;
  }
  async cancel(jobId: string) {
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      let j = await t.need("jobs", jobId, true);
      requireThat(
        !["submitting", "submission_unknown", "published"].includes(j.state),
        "ALREADY_SUBMITTED",
        "任务已提交或结果不明，只能核验。",
        409,
      );
      requireThat(
        ACTIVE.includes(j.state),
        "NOT_CANCELLABLE",
        "任务已终结。",
        409,
      );
      return this.settle(t, j, "cancelled", { fence: j.fence + 1 });
    });
  }
  async retry(jobId: string) {
    return this.db.transaction(async (t) => {
      const r = await t.need("runtime", "main", true),
        j = await t.need("jobs", jobId, true);
      const attempts = await t.list("publish_attempts", "data->>'jobId'=$1", [
        jobId,
      ]);
      requireThat(
        ["failed", "blocked", "retry_wait"].includes(j.state) &&
          !attempts.length,
        "UNSAFE_RETRY",
        "存在提交意图或该阶段不能安全重试。",
        409,
      );
      let a: Row | null = null;
      if (j.kind !== "preview") {
        a = await t.need("accounts", j.accountId, true);
        if (
          [
            "NO_ELIGIBLE_PRESET",
            "TEXT_MODEL_UNAVAILABLE",
            "IMAGE_MODEL_UNAVAILABLE",
            "PUBLISH_TRANSPORT_DISABLED",
          ].includes(a.blockReason)
        ) {
          const candidates = await this.candidates(t, a.id);
          requireThat(
            candidates.bindings.some((b) => b.probability > 0),
            "NO_ELIGIBLE_PRESET",
            "请先修复模型与预设绑定。",
            409,
          );
          a = await t.update("accounts", a.id, { blockReason: null });
        }
        requireThat(
          !r.paused && a.status === "active" && !a.blockReason,
          "ACCOUNT_PAUSED",
          "先解除全局或账号阻塞。",
          409,
        );
        const active = await t.list(
          "jobs",
          `${activeWhere} AND data->>'accountId'=$2 AND id<>$3`,
          [ACTIVE, j.accountId, j.id],
        );
        requireThat(
          !active.length,
          "ACCOUNT_BUSY",
          "该账号已有其他任务。",
          409,
        );
        await t.update("schedules", a.id, {
          nextDueAt: null,
          activeJobId: j.id,
        });
      }
      await t.event(j.id, "retry_requested");
      return t.update("jobs", j.id, {
        state: "queued",
        stage: "queued",
        error: null,
        retryAt: null,
        leaseOwner: null,
        leaseUntil: null,
        fence: j.fence + 1,
        controlVersion: a?.controlVersion || 0,
        pauseEpoch: r.pauseEpoch,
        contentId: null,
        assetId: null,
        validationId: null,
        validationPassed: null,
        snapshotIds: [],
        attempt: 0,
      });
    });
  }
  async recover() {
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const timestamp = now();
      for (const j of await t.list(
        "jobs",
        "data->>'leaseUntil'<=$1 AND data->>'state'=ANY($2::text[])",
        [timestamp, ACTIVE],
      )) {
        const intents = await t.list("publish_attempts", "data->>'jobId'=$1", [
          j.id,
        ]);
        if (intents.length || j.state === "submitting")
          await this.settle(t, j, "submission_unknown", {
            error: {
              code: "PUBLISH_RESULT_UNKNOWN",
              message: "租约失效且存在提交意图，需要核对回执。",
            },
            fence: j.fence + 1,
          });
        else {
          await t.update("jobs", j.id, {
            state: "queued",
            stage: "queued",
            leaseOwner: null,
            leaseUntil: null,
            fence: j.fence + 1,
          });
          await t.event(j.id, "lease_recovered");
        }
      }
      for (const s of await t.list(
        "schedules",
        "(data->>'enabled')::boolean AND data->>'nextDueAt'<=$1",
        [timestamp],
      )) {
        const active = await t.list(
          "jobs",
          `${activeWhere} AND data->>'accountId'=$2`,
          [ACTIVE, s.accountId],
        );
        if (!active.length) {
          await t.update("schedules", s.id, this.sample(s, timestamp));
          await t.audit("schedule.missed_skipped", s.accountId, {
            missedDueAt: s.nextDueAt,
          });
        }
      }
    });
  }
}
export function expect(row: Row, input: Doc) {
  requireThat(
    Number.isInteger(input.expectedVersion) &&
      row.version === input.expectedVersion,
    "CONFIG_VERSION_CONFLICT",
    "配置版本已变动，请刷新。",
    409,
    { currentVersion: row.version },
  );
}
export function cleanTags(tags: any): string[] {
  requireThat(
    tags === undefined || Array.isArray(tags),
    "INVALID_TAGS",
    "标签需为数组。",
  );
  return [
    ...new Set((tags || []).map((s: any) => String(s).trim()).filter(Boolean)),
  ].slice(0, 30) as string[];
}
