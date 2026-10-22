import {
  Database,
  Store,
  Row,
  Doc,
  Config,
  Vault,
  now,
  id,
  hash,
  requireThat,
  Fault,
  errorInfo,
} from "./core.js";
import { Control, ACTIVE } from "./control.js";
import { Sources } from "./sources.js";
import { AI } from "./ai.js";
import { Media } from "./media.js";
import { validate } from "./validation.js";
import { SquarePort } from "./square.js";
import { imageBriefInBody } from "./article-policy.js";

export class Pipeline {
  readonly owner = id("worker");
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private running = new Set<Promise<void>>();
  private verifying = new Set<string>();
  constructor(
    public db: Database,
    private control: Control,
    private vault: Vault,
    private sources: Sources,
    private ai: AI,
    private media: Media,
    private square: SquarePort,
    private config: Config,
  ) {}
  async start() {
    await this.control.recover();
    this.timer = setInterval(
      () =>
        void this.tick().catch((e) =>
          this.db.audit("worker.tick_failed", this.owner, errorInfo(e)),
        ),
      1000,
    );
    await this.tick();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.running]);
    await this.db.insert("heartbeats", {
      role: "worker",
      owner: this.owner,
      state: "stopped",
      at: now(),
    });
  }
  async heartbeat(jobId: string, fence: number) {
    await this.db.transaction(async (t) => {
      const j = await t.need("jobs", jobId, true);
      if (
        j.leaseOwner === this.owner &&
        j.fence === fence &&
        ACTIVE.includes(j.state)
      ) {
        const r = await t.need("runtime", "main");
        await t.update("jobs", jobId, {
          leaseUntil: new Date(
            Date.now() + r.leaseSeconds * 1000,
          ).toISOString(),
          heartbeatAt: now(),
        });
      }
    });
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const old = await this.db.get("heartbeats", this.owner);
      if (old)
        await this.db.update("heartbeats", this.owner, {
          at: now(),
          state: "running",
        });
      else
        await this.db.insert(
          "heartbeats",
          { role: "worker", owner: this.owner, state: "running", at: now() },
          this.owner,
        );
      await this.recoverExpired();
      await this.control.due();
      for (let n = 0; n < 20; n++) {
        const j = await this.claim();
        if (!j) break;
        const promise = this.run(j)
          .catch((e) => this.db.audit("worker.unhandled", j.id, errorInfo(e)))
          .then(() => {})
          .finally(() => this.running.delete(promise));
        this.running.add(promise);
      }
      const image = await this.db.list(
        "image_jobs",
        "data->>'state'='queued' AND data->>'publicationJobId' IS NULL",
        [],
        1,
      );
      if (image[0]) {
        const p = this.media
          .generate(image[0])
          .catch(() => {})
          .then(() => {})
          .finally(() => this.running.delete(p));
        this.running.add(p);
      }
      await this.verifyPending();
    } finally {
      this.busy = false;
    }
  }
  async claim() {
    return this.db.transaction(async (t) => {
      const r = await t.need("runtime", "main", true);
      const active = await t.list(
        "jobs",
        "data->>'leaseUntil'>$1 AND data->>'state'=ANY($2::text[])",
        [now(), ACTIVE],
      );
      if (active.length >= r.concurrency) return null;
      const candidates = await t.sql(
        `SELECT * FROM jobs WHERE (data->>'state'='queued' OR (data->>'state'='retry_wait' AND data->>'retryAt'<=$1)) AND ($2::boolean=false OR data->>'kind'='preview') ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        [now(), r.paused],
      );
      if (!candidates.rows[0]) return null;
      const j = await t.need("jobs", candidates.rows[0].id);
      return t.update("jobs", j.id, {
        state: "preparing",
        stage: "preparing",
        leaseOwner: this.owner,
        leaseUntil: new Date(Date.now() + r.leaseSeconds * 1000).toISOString(),
        fence: j.fence + 1,
        startedAt: j.startedAt || now(),
        attempt: j.attempt + 1,
        retryAt: null,
      });
    });
  }
  async lease(t: Store, jobId: string, fence: number) {
    const j = await t.need("jobs", jobId, true);
    requireThat(
      j.leaseOwner === this.owner &&
        j.fence === fence &&
        j.leaseUntil &&
        j.leaseUntil > now() &&
        ACTIVE.includes(j.state),
      "STALE_LEASE",
      "执行租约已失效，旧执行者不能继续提交。",
      409,
    );
    return j;
  }
  async stage(job: Row, stage: string, changes: Doc = {}) {
    return this.db.transaction(async (t) => {
      const j = await this.lease(t, job.id, job.fence);
      await t.event(j.id, stage, changes);
      return t.update("jobs", j.id, { state: stage, stage, ...changes });
    });
  }
  async run(job: Row) {
    const timer = setInterval(
      () => void this.heartbeat(job.id, job.fence).catch(() => {}),
      10000,
    );
    let media: Row | null = null;
    try {
      let content: Row | null = null,
        validation: Row | null = null,
        input: Doc | null = null;
      for (let refresh = 0; refresh < 3; refresh++) {
        await this.stage(job, "preparing");
        input = await this.sources.collect(job);
        const history = await this.db.list(
          "content_versions",
          `data->>'jobId'<>$1 AND (
            EXISTS(SELECT 1 FROM posts p WHERE p.data->>'contentId'=content_versions.id)
            OR EXISTS(SELECT 1 FROM jobs j
              WHERE j.id=content_versions.data->>'jobId'
                AND j.data->>'contentId'=content_versions.id
                AND j.data->>'kind'<>'preview'
                AND j.data->>'state'=ANY($2::text[]))
          )`,
          [
            job.id,
            [
              "preparing_media",
              "ready",
              "submitting",
              "submission_unknown",
              "published",
            ],
          ],
          job.rules.dedupWindow,
        );
        await this.stage(job, "generating_text", {
          snapshotIds: input.snapshots.map((s: Row) => s.id),
          tokens: input.tokens,
          facts: input.facts,
          sourceWarnings: input.warnings,
        });
        let repair: Doc | null = null;
        for (let attempt = 0; attempt <= job.rules.repairAttempts; attempt++) {
          const generated = await this.ai.text(job, input, history, repair);
          content = generated.content;
          await this.stage(job, "validating", {
            contentId: content.id,
            generationRunId: generated.run.id,
            validationId: null,
            validationPassed: null,
          });
          const runtime = await this.db.need("runtime", "main");
          const result = validate(
            content,
            job.rules,
            input,
            history,
            runtime.globalBannedWords,
            runtime.contentValidationMode || "strict",
          );
          if (
            result.passed &&
            job.rules.semanticReview &&
            runtime.contentValidationMode !== "publish_first"
          ) {
            const review = await this.ai.review(job, content, input, history);
            result.semanticReview = review;
            if (!review.passed) {
              result.passed = false;
              result.errors.push(
                ...review.issues.map((issue: Doc) => ({
                  code: "SEMANTIC_REVIEW_FAILED",
                  ...issue,
                })),
              );
            }
          }
          validation = await this.db.insert("validation_runs", {
            jobId: job.id,
            contentId: content.id,
            presetVersionId: job.presetVersionId,
            ...result,
          });
          await this.stage(job, "validating", {
            validationId: validation.id,
            validationPassed: result.passed,
          });
          if (result.passed) break;
          repair = {
            previousDraft: {
              text: content.text,
              tokens: content.tokens,
              claims: content.claims,
              usedSourceIds: content.usedSourceIds,
              newsClaims: content.newsClaims,
            },
            errors: result.errors,
          };
          if (attempt === job.rules.repairAttempts)
            throw new Fault(
              "TEXT_VALIDATION_FAILED",
              "AI 成稿未通过校验。",
              422,
              { validationId: validation.id, errors: result.errors },
            );
          await this.stage(job, "generating_text", {
            repairAttempt: attempt + 1,
          });
        }
        await this.stage(job, "preparing_media", {
          validationId: validation!.id,
        });
        if (!media)
          media = await this.media.choose(await this.db.need("jobs", job.id));
        await this.stage(job, "ready", {
          assetId: media.id,
          assetHash: media.sha256,
        });
        if (
          validation!.validationMode !== "publish_first" &&
          input.snapshots.some((s: Row) => s.expiresAt && s.expiresAt < now())
        ) {
          await this.db.event(job.id, "facts_refresh_required", {
            refresh: refresh + 1,
          });
          if (refresh === 2)
            throw new Fault(
              "FACTS_STALE",
              "等待素材导致事实持续过期，停止本任务。",
            );
          continue;
        }
        break;
      }
      requireThat(
        content && validation && input && media,
        "PIPELINE_INCOMPLETE",
        "流水线产物不完整。",
      );
      const finalJob = await this.db.need("jobs", job.id);
      if (job.kind === "preview") {
        await this.db.transaction(async (t) => {
          await this.lease(t, job.id, job.fence);
          await this.control.settle(t, finalJob, "preview_ready", {
            contentId: content!.id,
            assetId: media!.id,
            validationId: validation!.id,
          });
          await t.update("assets", media!.id, {
            reservedUntil: null,
            reservedFor: null,
          });
        });
        return;
      }
      requireThat(
        this.config.publishEnabled,
        "PUBLISH_TRANSPORT_DISABLED",
        "当前环境尚未启用真实发布传输。请在正式运行配置中启用。",
        409,
      );
      const bytes = await this.media.bytes(media);
      await this.gate(job, content, validation, input, media, false);
      const account = await this.db.need("accounts", job.accountId),
        credential = await this.db.need("credentials", account.credentialId),
        key = this.vault.open(credential.box);
      const imageUrl = await this.square.upload(key, bytes, media);
      // Account credential version is frozen only immediately before submission; a rotation during upload invalidates this gate.
      const attempt = await this.gate(
        job,
        content,
        validation,
        input,
        media,
        true,
        {
          credentialId: credential.id,
          credentialVersion: account.credentialVersion,
          imageUrl,
        },
      );
      let receipt: Doc;
      try {
        receipt = await this.square.publish(key, content.text, [imageUrl]);
      } catch (e: any) {
        await this.publishError(job, attempt!, e);
        return;
      }
      await this.db.transaction(async (t) => {
        await t.need("runtime", "main", true);
        const j = await t.need("jobs", job.id, true),
          a = await t.need("accounts", job.accountId, true);
        // A late receipt can reconcile its own intent even after lease recovery. It never triggers another submit.
        await t.update("publish_attempts", attempt!.id, {
          state: "confirmed",
          remoteId: receipt.id,
          receipt: receipt.receipt,
          confirmedAt: receipt.confirmedAt,
        });
        const prior = await t.list("posts", "data->>'jobId'=$1", [j.id]);
        const p = prior[0]
          ? await t.update("posts", prior[0].id, {
              publishStatus: "published",
              remoteId: receipt.id,
              url: receipt.url,
              publishedAt: receipt.confirmedAt,
              verificationStatus: "pending",
            })
          : await t.insert("posts", {
              jobId: j.id,
              accountId: a.id,
              contentId: content!.id,
              assetId: media!.id,
              text: content!.text,
              tokens: content!.tokens,
              presetId: j.presetId,
              presetVersionId: j.presetVersionId,
              modelId: content!.modelId,
              connectionId: content!.connectionId,
              sourceIds: content!.usedSourceIds,
              publishStatus: "published",
              verificationStatus: "pending",
              remoteId: receipt.id,
              url: receipt.url,
              publishedAt: receipt.confirmedAt,
              verifyAfter: now(),
            });
        await t.update("accounts", a.id, {
          lastPublishedAt: receipt.confirmedAt,
          credentialHealth: "publish_authenticated",
          blockReason:
            a.blockReason === "PUBLISH_RESULT_UNKNOWN" ? null : a.blockReason,
        });
        await t.update("assets", media!.id, {
          lastUsedAt: receipt.confirmedAt,
          reservedFor: null,
          reservedUntil: null,
        });
        await this.control.settle(t, j, "published", {
          postId: p.id,
          publishConfirmedAt: receipt.confirmedAt,
        });
      });
    } catch (e: any) {
      if (e.code === "STALE_LEASE") return;
      await this.db.transaction(async (t) => {
        await t.need("runtime", "main", true);
        const j = await t.need("jobs", job.id, true);
        if (
          j.leaseOwner !== this.owner ||
          j.fence !== job.fence ||
          !ACTIVE.includes(j.state)
        )
          return;
        const intents = await t.list("publish_attempts", "data->>'jobId'=$1", [
          j.id,
        ]);
        if (intents.length) {
          await this.control.settle(t, j, "submission_unknown", {
            error: errorInfo(e),
          });
          return;
        }
        const runtime = await t.need("runtime", "main");
        if (
          e.retryable &&
          j.attempt <= runtime.stepRetries &&
          (j.state !== "preparing_media" || e.code === "MODEL_CAPACITY_WAIT")
        ) {
          const retryAt = new Date(
            Date.now() + Math.min(300, 10 * 2 ** (j.attempt - 1)) * 1000,
          ).toISOString();
          await t.update("jobs", j.id, {
            state: "retry_wait",
            stage: j.stage,
            retryAt,
            error: errorInfo(e),
            leaseOwner: null,
            leaseUntil: null,
          });
          await t.event(j.id, "retry_wait", { retryAt, error: errorInfo(e) });
          return;
        }
        const blocking = [
          "ACCOUNT_CREDENTIAL_INVALID",
          "NO_ELIGIBLE_PRESET",
          "TEXT_MODEL_UNAVAILABLE",
          "IMAGE_MODEL_UNAVAILABLE",
          "PUBLISH_TRANSPORT_DISABLED",
        ].includes(e.code);
        if (blocking && j.kind !== "preview")
          await t.update("accounts", j.accountId, { blockReason: e.code });
        await this.control.settle(
          t,
          j,
          blocking
            ? "blocked"
            : ["GLOBAL_PAUSED", "ACCOUNT_PAUSED"].includes(e.code)
              ? "cancelled"
              : "failed",
          { error: errorInfo(e) },
        );
        if (j.assetId) {
          const a = await t.get("assets", j.assetId);
          if (a?.reservedFor === j.id)
            await t.update("assets", a.id, {
              reservedFor: null,
              reservedUntil: null,
            });
        }
      });
    } finally {
      clearInterval(timer);
      if (media)
        await this.db.transaction(async (t) => {
          const j = await t.need("jobs", job.id),
            a = await t.need("assets", media!.id, true);
          if (
            [
              "failed",
              "blocked",
              "cancelled",
              "published",
              "preview_ready",
            ].includes(j.state) &&
            a.reservedFor === job.id
          )
            await t.update("assets", a.id, {
              reservedFor: null,
              reservedUntil: null,
            });
        });
    }
  }
  async gate(
    job: Row,
    content: Row,
    validation: Row,
    input: Doc,
    asset: Row,
    intent: boolean,
    extra: Doc = {},
  ) {
    return this.db.transaction(async (t) => {
      const runtime = await t.need("runtime", "main", true),
        a = await t.need("accounts", job.accountId, true),
        j = await this.lease(t, job.id, job.fence);
      requireThat(
        !runtime.paused && runtime.pauseEpoch === j.pauseEpoch,
        "GLOBAL_PAUSED",
        "全局控制已改变，本任务不能继续提交。",
        409,
      );
      requireThat(
        a.status === "active" &&
          !a.blockReason &&
          a.controlVersion === j.controlVersion,
        "ACCOUNT_PAUSED",
        "账号控制已改变或已阻塞。",
        409,
      );
      const c = await t.need("content_versions", content.id),
        run = await t.need("generation_runs", c.generationRunId),
        v = await t.need("validation_runs", validation.id),
        m = await t.need("models", run.modelId),
        ar = await t.need("assets", asset.id);
      const connection = await t.need("connections", run.connectionId);
      requireThat(
        run.state === "completed" &&
          run.type === "text" &&
          m.approved &&
          connection.enabled &&
          run.jobId === j.id &&
          c.jobId === j.id,
        "AI_PROVENANCE_REQUIRED",
        "缺少该任务批准模型的最终成稿证据。",
      );
      const parsed = JSON.parse(run.output);
      requireThat(
        hash(normalizeOutput(parsed.text)) === c.contentHash &&
          hash(c.text) === c.contentHash &&
          v.contentHash === c.contentHash &&
          v.contentId === c.id,
        "CONTENT_HASH_MISMATCH",
        "AI 输出、成稿、校验摘要不一致。",
      );
      requireThat(
        v.passed && v.presetVersionId === j.presetVersionId,
        "TEXT_VALIDATION_FAILED",
        "当前版本未通过校验。",
      );
      const imageBrief = imageBriefInBody(c.text);
      requireThat(
        !imageBrief,
        "IMAGE_BRIEF_IN_BODY",
        "正文混入图片制作说明，必须由 AI 重写文章后才能发送。",
        422,
        imageBrief || {},
      );
      requireThat(
        runtime.contentValidationMode === "publish_first" ||
          v.validationMode !== "publish_first",
        "CONTENT_VALIDATION_POLICY_CHANGED",
        "内容校验模式已收紧，请重新执行当前任务。",
        409,
      );
      if (
        j.rules.semanticReview &&
        runtime.contentValidationMode !== "publish_first"
      ) {
        const review = v.semanticReview?.runId
          ? await t.need("generation_runs", v.semanticReview.runId)
          : null;
        requireThat(
          review &&
            review.type === "text_review" &&
            review.state === "completed" &&
            review.contentHash === c.contentHash &&
            v.semanticReview.passed &&
            JSON.parse(review.output).passed === true,
          "TEXT_REVIEW_REQUIRED",
          "当前成稿缺少相同摘要的通过校对记录。",
        );
      }
      requireThat(
        ar.enabled &&
          ar.sha256 === asset.sha256 &&
          ["library", "gpt_image_2"].includes(ar.provenance?.type),
        "ASSET_PROVENANCE_INVALID",
        "当前图片来源或摘要不符。",
      );
      for (const snapshot of runtime.contentValidationMode === "publish_first"
        ? []
        : input.snapshots) {
        const s = await t.need("source_snapshots", snapshot.id);
        requireThat(
          !s.expiresAt || s.expiresAt > now(),
          "FACTS_STALE",
          "提交前行情或新闻快照已过期。",
        );
      }
      const attempts = await t.list("publish_attempts", "data->>'jobId'=$1", [
        j.id,
      ]);
      requireThat(
        !attempts.length,
        "PUBLISH_RESULT_UNKNOWN",
        "已有提交意图，不能重复提交。",
        409,
      );
      if (intent) {
        requireThat(
          a.credentialId === extra.credentialId,
          "ACCOUNT_PAUSED",
          "上传过程中凭据已轮换。",
          409,
        );
        const attempt = await t.insert("publish_attempts", {
          jobId: j.id,
          accountId: a.id,
          state: "intent",
          contentId: c.id,
          contentHash: c.contentHash,
          assetId: asset.id,
          assetHash: asset.sha256,
          ...extra,
          intentAt: now(),
        });
        await t.update("jobs", j.id, {
          state: "submitting",
          stage: "submitting",
          publishAttemptId: attempt.id,
        });
        await t.event(j.id, "publish_intent", { attemptId: attempt.id });
        return attempt;
      }
      return null;
    });
  }
  async publishError(job: Row, attempt: Row, e: any) {
    await this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const j = await t.need("jobs", job.id, true),
        definite =
          e.details?.definitelyRejected || e.details?.httpStatus === 429;
      await t.update("publish_attempts", attempt.id, {
        state: definite ? "rejected" : "unknown",
        error: errorInfo(e),
        finishedAt: now(),
      });
      if (definite) {
        if (e.code === "REMOTE_RATE_LIMITED") {
          const raw = e.details?.retryAfter,
            seconds = Number(raw),
            timestamp =
              raw && Number.isFinite(seconds)
                ? Date.now() + seconds * 1000
                : Date.parse(raw || "");
          await t.update("accounts", j.accountId, {
            blockReason: "REMOTE_RATE_LIMITED",
            cooldownUntil: new Date(
              Number.isFinite(timestamp) && timestamp > Date.now()
                ? timestamp
                : Date.now() + 3600_000,
            ).toISOString(),
          });
        }
        if (e.code === "ACCOUNT_CREDENTIAL_INVALID")
          await t.update("accounts", j.accountId, {
            blockReason: e.code,
            credentialHealth: "invalid",
          });
        await this.control.settle(t, j, "failed", { error: errorInfo(e) });
      } else
        await this.control.settle(t, j, "submission_unknown", {
          error: {
            ...errorInfo(e),
            code: "PUBLISH_RESULT_UNKNOWN",
            upstreamCode: e.code,
          },
        });
    });
  }
  async recoverExpired() {
    const expired = await this.db.list(
      "jobs",
      "data->>'leaseUntil'<=$1 AND data->>'state'=ANY($2::text[])",
      [now(), ACTIVE],
    );
    for (const job of expired)
      await this.db.transaction(async (t) => {
        await t.need("runtime", "main", true);
        const j = await t.need("jobs", job.id, true);
        if (!j.leaseUntil || j.leaseUntil > now() || !ACTIVE.includes(j.state))
          return;
        const attempts = await t.list("publish_attempts", "data->>'jobId'=$1", [
          j.id,
        ]);
        if (attempts.length)
          await this.control.settle(t, j, "submission_unknown", {
            error: {
              code: "PUBLISH_RESULT_UNKNOWN",
              message: "提交记录存在，但原执行者租约已过期。",
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
      });
    // Image requests cannot safely be replayed after process death.
    for (const j of await this.db.list(
      "image_jobs",
      "data->>'state'='running' AND data->>'startedAt'<$1",
      [new Date(Date.now() - 15 * 60_000).toISOString()],
    ))
      await this.db.update("image_jobs", j.id, {
        state: "result_unknown",
        error: {
          code: "IMAGE_RESULT_UNKNOWN",
          message: "执行中断，需向原服务查询结果，未自动重发。",
        },
      });
  }
  async verify(postId: string) {
    const post = await this.db.need("posts", postId);
    requireThat(
      post.remoteId,
      "REMOTE_ID_REQUIRED",
      "没有可读取的远端帖子标识。",
      409,
    );
    try {
      const remote = await this.square.verify(post.remoteId),
        content = await this.db.need("content_versions", post.contentId),
        attempt = (
          await this.db.list("publish_attempts", "data->>'jobId'=$1", [
            post.jobId,
          ])
        )[0];
      const actualUrls = remote.images.map((x: any) =>
          typeof x === "string" ? x : x.url || x.imageUrl,
        ),
        expectedUrl = attempt?.imageUrl;
      const mediaAssociation = expectedUrl
        ? actualUrls.includes(expectedUrl)
        : false;
      const checks = {
        text: remote.text === content.text,
        tags: content.tokens.every((t: string) => remote.tokens.includes(t)),
        imageCount: remote.images.length === 1,
        mediaAssociation: mediaAssociation ? "matched" : "not_comparable",
      };
      const status =
        checks.text && checks.tags && checks.imageCount && mediaAssociation
          ? "verified"
          : checks.text && checks.tags && checks.imageCount
            ? "unavailable"
            : "mismatch";
      const run = await this.db.insert("verification_runs", {
        postId,
        remoteId: post.remoteId,
        status,
        checks,
        remote,
        checkedAt: now(),
      });
      const count = (post.verifyAttempts || 0) + 1;
      await this.db.update("posts", postId, {
        verificationStatus: status,
        lastVerificationId: run.id,
        verifiedAt: now(),
        verifyAttempts: count,
        verifyAfter:
          status === "unavailable" && count < 5
            ? new Date(Date.now() + 300_000).toISOString()
            : null,
      });
      return run;
    } catch (e) {
      const count = (post.verifyAttempts || 0) + 1,
        run = await this.db.insert("verification_runs", {
          postId,
          status: "unavailable",
          error: errorInfo(e),
          checkedAt: now(),
        });
      await this.db.update("posts", postId, {
        verificationStatus: "unavailable",
        lastVerificationId: run.id,
        verifyAttempts: count,
        verifyAfter:
          count < 5
            ? new Date(
                Date.now() + Math.min(3600, 30 * 2 ** count) * 1000,
              ).toISOString()
            : null,
      });
      return run;
    }
  }
  async reconcile(jobId: string, remoteId: string) {
    const job = await this.db.need("jobs", jobId);
    requireThat(
      job.state === "submission_unknown" && job.contentId,
      "RECONCILIATION_NOT_AVAILABLE",
      "仅可核对结果不明且已有成稿的提交。",
      409,
    );
    const remote = await this.square.verify(remoteId),
      content = await this.db.need("content_versions", job.contentId),
      attempt = (
        await this.db.list("publish_attempts", "data->>'jobId'=$1", [job.id])
      )[0],
      account = await this.db.need("accounts", job.accountId);
    const urls = remote.images.map((v: any) =>
      typeof v === "string" ? v : v.url || v.imageUrl,
    );
    requireThat(
      remote.text === content.text &&
        content.tokens.every((v: string) => remote.tokens.includes(v)) &&
        urls.length === 1 &&
        urls.includes(attempt?.imageUrl),
      "RECONCILIATION_MISMATCH",
      "公开正文、标签或图片不能与原提交关联，继续保持结果不明。",
      409,
    );
    if (account.uid)
      requireThat(
        remote.authorUid && String(remote.authorUid) === account.uid,
        "RECONCILIATION_AUTHOR_MISMATCH",
        "无法确认远端作者与该账号 UID 一致。",
        409,
      );
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const j = await t.need("jobs", jobId, true),
        a = await t.need("accounts", j.accountId, true);
      requireThat(
        j.state === "submission_unknown",
        "RECONCILIATION_NOT_AVAILABLE",
        "状态已改变，请刷新。",
        409,
      );
      const confirmedAt = now(),
        p = await t.insert("posts", {
          jobId: j.id,
          accountId: j.accountId,
          contentId: content.id,
          assetId: j.assetId,
          text: content.text,
          tokens: content.tokens,
          presetId: j.presetId,
          presetVersionId: j.presetVersionId,
          modelId: content.modelId,
          connectionId: content.connectionId,
          sourceIds: content.usedSourceIds,
          publishStatus: "published",
          verificationStatus: "verified",
          remoteId,
          url:
            remote.url ||
            `https://www.binance.com/zh-CN/square/post/${remoteId}`,
          publishedAt: confirmedAt,
          reconciledFromUnknown: true,
        });
      await t.update("publish_attempts", attempt.id, {
        state: "confirmed",
        remoteId,
        confirmedAt,
        reconciledFromPublic: true,
      });
      await t.insert("verification_runs", {
        postId: p.id,
        status: "verified",
        remoteId,
        remote,
        checks: {
          text: true,
          tags: true,
          imageCount: true,
          mediaAssociation: "matched",
        },
        checkedAt: confirmedAt,
      });
      await t.update("accounts", a.id, {
        blockReason:
          a.blockReason === "PUBLISH_RESULT_UNKNOWN" ? null : a.blockReason,
        lastPublishedAt: confirmedAt,
      });
      await t.audit("publication.reconciled", j.id, { postId: p.id, remoteId });
      return this.control.settle(t, j, "published", {
        postId: p.id,
        publishConfirmedAt: confirmedAt,
      });
    });
  }
  async verifyPending() {
    const posts = await this.db.list(
      "posts",
      "data->>'publishStatus'='published' AND data->>'verifyAfter'<=$1",
      [now()],
      3,
    );
    for (const post of posts)
      if (!this.verifying.has(post.id)) {
        this.verifying.add(post.id);
        const p = this.verify(post.id)
          .catch((e) =>
            this.db.audit("verification.error", post.id, errorInfo(e)),
          )
          .then(() => {})
          .finally(() => {
            this.verifying.delete(post.id);
            this.running.delete(p);
          });
        this.running.add(p);
      }
  }
}
function normalizeOutput(text: string) {
  return text.replace(/\r\n?/g, "\n");
}
