import { resolveModel } from "./providers.js";
import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  readdir,
  stat,
} from "node:fs/promises";
import sharp from "sharp";
import {
  Database,
  Doc,
  Row,
  Config,
  hash,
  now,
  requireThat,
  Fault,
  random,
  errorInfo,
} from "./core.js";
import { AI } from "./ai.js";
import { memeImageFields } from "./image-policy.js";

export class Media {
  constructor(
    private db: Database,
    private ai: AI,
    private config: Config,
  ) {}
  async ingest(
    bytes: Buffer,
    metadata: Doc,
    provenance: {
      type: "library" | "gpt_image_2";
      generationRunId?: string;
      imageJobId?: string;
      importBatch?: string;
    },
  ) {
    requireThat(
      bytes.length > 0 && bytes.length <= 30 * 1024 * 1024,
      "ASSET_TOO_LARGE",
      "图片大小需在30MB以内。",
    );
    const info = await sharp(bytes, {
      limitInputPixels: 50_000_000,
    }).metadata();
    requireThat(
      info.width &&
        info.height &&
        ["jpeg", "png", "webp", "gif"].includes(info.format || ""),
      "INVALID_IMAGE",
      "只接收可读取的 JPEG、PNG、WebP、GIF 图片。",
    );
    if (provenance.type === "gpt_image_2") {
      if (metadata.requestedAspectRatio) {
        const parts = String(metadata.requestedAspectRatio)
          .split(":")
          .map(Number);
        requireThat(
          parts.length === 2 && parts.every((v) => Number.isFinite(v) && v > 0),
          "INVALID_ASPECT_RATIO",
          "比例格式应为正数宽:高。",
        );
        requireThat(
          Math.abs(info.width! / info.height! / (parts[0] / parts[1]) - 1) <=
            0.01,
          "IMAGE_ASPECT_RATIO_MISMATCH",
          "模型返回图片比例不满足预设；保存调用记录并停止发送。",
        );
      }
      const run = await this.db.need(
        "generation_runs",
        provenance.generationRunId!,
      );
      requireThat(
        run.type === "image" && run.state === "completed",
        "ASSET_PROVENANCE_INVALID",
        "缺少成功生图记录。",
      );
      const model = await this.db.need("models", run.modelId);
      requireThat(
        model.family === "gpt-image-2",
        "ASSET_PROVENANCE_INVALID",
        "图片来源不是 GPT Image 2。",
      );
    }
    const sha256 = hash(bytes),
      storageKey = `${sha256}.${info.format}`,
      directory = path.join(this.config.dataDir, "assets");
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, storageKey);
    await writeFile(file, bytes, { flag: "wx" }).catch((e: any) => {
      if (e.code !== "EEXIST") throw e;
    });
    return this.db.transaction(async (t) => {
      const old = await t.list("assets", "data->>'sha256'=$1", [sha256]);
      if (old[0])
        return t.update("assets", old[0].id, {
          origins: [...(old[0].origins || [old[0].provenance]), provenance],
        });
      return t.insert("assets", {
        name: String(metadata.name || storageKey).slice(0, 200),
        collection: String(metadata.collection || ""),
        tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [],
        style: String(metadata.style || ""),
        enabled: true,
        storageKey,
        sha256,
        bytes: bytes.length,
        width: info.width,
        height: info.height,
        format: info.format,
        mime: `image/${info.format === "jpg" ? "jpeg" : info.format}`,
        aspectRatio: ratio(info.width!, info.height!),
        provenance,
        ...(metadata.imagePolicy ? { imagePolicy: metadata.imagePolicy } : {}),
        origins: [provenance],
        lastUsedAt: null,
        reservedUntil: null,
      });
    });
  }
  async bytes(asset: Row) {
    requireThat(
      !/[\\/]/.test(asset.storageKey),
      "ASSET_PROVENANCE_INVALID",
      "图片存储路径非法。",
    );
    let bytes: Buffer;
    try {
      bytes = await readFile(
        path.join(this.config.dataDir, "assets", asset.storageKey),
      );
    } catch {
      throw new Fault("ASSET_UNAVAILABLE", "图片文件缺失。", 422, {
        assetId: asset.id,
      });
    }
    requireThat(
      hash(bytes) === asset.sha256,
      "ASSET_PROVENANCE_INVALID",
      "图片文件摘要不符。",
    );
    requireThat(
      ["library", "gpt_image_2"].includes(asset.provenance?.type),
      "ASSET_PROVENANCE_INVALID",
      "图片没有允许的来源。",
    );
    return bytes;
  }
  async choose(job: Row) {
    const rule = job.rules.image;
    if (rule.mode !== "generate") {
      const chosen = await this.db.transaction(async (t) => {
        const all = await t.list("assets", "(data->>'enabled')::boolean");
        const available = all.filter(
          (a) => !a.reservedUntil || Date.parse(a.reservedUntil) < Date.now(),
        );
        let matches = available.filter(
          (a) =>
            (!rule.collection || a.collection === rule.collection) &&
            (!rule.style || a.style === rule.style) &&
            (!rule.aspectRatio || a.aspectRatio === rule.aspectRatio) &&
            rule.tags.every((tag: string) => a.tags.includes(tag)) &&
            (!a.lastUsedAt ||
              Date.now() - Date.parse(a.lastUsedAt) >=
                rule.reuseSeconds * 1000),
        );
        if (!matches.length && rule.fallback === "any_library")
          matches = available;
        if (!matches.length) return null;
        const selected = matches[Math.floor(random() * matches.length)],
          a = await t.need("assets", selected.id, true);
        if (a.reservedUntil && Date.parse(a.reservedUntil) > Date.now())
          return null;
        return t.update("assets", a.id, {
          reservedFor: job.id,
          reservedUntil: new Date(Date.now() + 3600_000).toISOString(),
        });
      });
      if (chosen) {
        await this.bytes(chosen);
        return chosen;
      }
      if (rule.mode === "library")
        throw new Fault(
          "ASSET_UNAVAILABLE",
          "没有符合条件且在复用窗口外的图片。",
        );
    }
    requireThat(
      job.kind !== "preview" || job.includeImageGeneration,
      "IMAGE_GENERATION_NOT_REQUESTED",
      "预览未选择“包含生图”。",
    );
    let imageJob = job.imageJobId
      ? await this.db.need("image_jobs", job.imageJobId)
      : null;
    if (!imageJob) {
      imageJob = await this.createJob({
        modelId: rule.modelId,
        prompt:
          (rule.prompt ||
            `创作一张各行各业的 meme 梗图。主题参考：${job.rules.direction}。表现形式参考：${rule.style || "行业反差梗"}。`) +
          (rule.aspectRatio ? `\n画面宽高比要求：${rule.aspectRatio}。` : ""),
        parameters: rule.parameters || {},
        requestedAspectRatio: rule.aspectRatio,
        presetVersionId: job.presetVersionId,
        publicationJobId: job.id,
        collection: rule.collection,
        tags: rule.tags,
        style: rule.style,
      });
      await this.db.update("jobs", job.id, { imageJobId: imageJob.id });
    }
    if (imageJob.state === "completed")
      return this.db.need("assets", imageJob.assetId);
    requireThat(
      !["running", "result_unknown"].includes(imageJob.state),
      "IMAGE_RESULT_PENDING",
      "生图仍在执行或结果不明，需查询原任务。",
      409,
    );
    if (imageJob.state === "failed")
      throw new Fault(
        "IMAGE_GENERATION_FAILED",
        "生图已失败，请检查原始错误。",
        422,
        imageJob.error || {},
      );
    return this.generate(imageJob);
  }
  async createJob(input: Doc) {
    requireThat(
      typeof input.prompt === "string" &&
        input.prompt.trim().length > 0 &&
        input.prompt.length <= 8000,
      "INVALID_IMAGE_PROMPT",
      "请填写不超过8000字符的生图要求。",
    );
    return this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const selection = await resolveModel(
        t,
        input.modelId || "@default",
        "image",
      );
      return t.insert("image_jobs", {
        modelId: selection.model.id,
        modelSelection: {
          requestedId: selection.requestedId,
          modelId: selection.model.id,
          connectionId: selection.connection.id,
          defaultsVersion: selection.defaultsVersion,
        },
        ...memeImageFields(input),
        parameters: input.parameters || {},
        requestedAspectRatio: input.requestedAspectRatio || "",
        publicationJobId: input.publicationJobId || null,
        presetVersionId: input.presetVersionId || null,
        collection: input.collection || "",
        tags: input.tags || [],
        style: input.style || "",
        state: "queued",
        assetId: null,
      });
    });
  }
  async generate(job: Row) {
    const claimed = await this.db.transaction(async (t) => {
      await t.need("runtime", "main", true);
      const j = await t.need("image_jobs", job.id, true);
      requireThat(
        j.state === "queued",
        "IMAGE_JOB_BUSY",
        "此生图任务已被认领。",
        409,
      );
      return t.update("image_jobs", j.id, {
        ...memeImageFields(j),
        state: "running",
        startedAt: now(),
      });
    });
    try {
      const { bytes, run } = await this.ai.image(claimed),
        asset = await this.ingest(bytes, claimed, {
          type: "gpt_image_2",
          generationRunId: run.id,
          imageJobId: job.id,
        });
      await this.db.update("image_jobs", job.id, {
        state: "completed",
        assetId: asset.id,
        finishedAt: now(),
        generationRunId: run.id,
      });
      return asset;
    } catch (e: any) {
      await this.db.update("image_jobs", job.id, {
        state:
          e.code === "MODEL_CAPACITY_WAIT"
            ? "queued"
            : ["UPSTREAM_NETWORK_ERROR", "UPSTREAM_HTTP_ERROR"].includes(e.code)
              ? "result_unknown"
              : "failed",
        error: errorInfo(e),
        finishedAt: now(),
      });
      throw e;
    }
  }
  async import(relativePath: string, rootIndex = 0, metadata: Doc = {}) {
    const configured = this.config.importRoots[rootIndex];
    requireThat(configured, "IMPORT_DISABLED", "未配置受管图片导入目录。");
    requireThat(
      typeof relativePath === "string" && !path.isAbsolute(relativePath),
      "INVALID_IMPORT_PATH",
      "仅接受受管目录下的相对路径。",
    );
    const root = await realpath(configured),
      target = await realpath(path.resolve(root, relativePath));
    requireThat(
      target.startsWith(root + path.sep),
      "IMPORT_PATH_BLOCKED",
      "路径超出受管目录。",
    );
    const stats = await stat(target);
    requireThat(
      stats.isFile(),
      "INVALID_IMPORT_PATH",
      "导入对象必须是图片文件。",
    );
    return this.ingest(
      await readFile(target),
      { name: path.basename(target), ...metadata },
      { type: "library", importBatch: now() },
    );
  }
}
function ratio(w: number, h: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
