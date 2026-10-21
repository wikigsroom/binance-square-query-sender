import { z } from "zod";
import { Doc, requireThat, random } from "./core.js";

export const rulesSchema = z
  .object({
    modelId: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()).default({}),
    direction: z.string().min(1).max(8000),
    language: z.string().default("zh-CN"),
    perspective: z.string().default("第一人称散户"),
    tone: z.string().default("自然口语，有具体态度"),
    preferredMin: z.number().int().min(1).default(120),
    preferredMax: z.number().int().min(1).default(190),
    maxChars: z.number().int().min(1).max(10000).default(200),
    paragraphs: z.string().default("完整句子，自然分段"),
    tagCount: z.number().int().min(0).max(20).default(3),
    requiredTags: z.array(z.string()).default([]),
    selection: z.enum(["market_top5", "fixed", "topic"]).default("market_top5"),
    tokens: z.array(z.string().regex(/^[A-Z0-9]{1,20}$/)).default([]),
    tokenCount: z.number().int().min(0).max(10).default(3),
    bothSides: z.boolean().default(true),
    requiredPercent: z.boolean().default(true),
    sourceRules: z
      .array(
        z.object({
          sourceId: z.string(),
          required: z.boolean().default(false),
          maxAgeSeconds: z.number().int().positive().default(259200),
          priority: z.number().default(1),
        }),
      )
      .default([]),
    factsMaxAgeSeconds: z.number().int().positive().default(900),
    material: z.string().max(16000).default(""),
    image: z
      .object({
        mode: z
          .enum(["library", "generate", "library_or_generate"])
          .default("library"),
        collection: z.string().default(""),
        tags: z.array(z.string()).default([]),
        style: z.string().default(""),
        aspectRatio: z.string().default(""),
        reuseSeconds: z.number().int().min(0).default(86400),
        modelId: z.string().default(""),
        prompt: z.string().max(8000).default(""),
        parameters: z.record(z.string(), z.unknown()).default({}),
        fallback: z.enum(["block", "any_library"]).default("block"),
      })
      .default({
        mode: "library",
        collection: "",
        tags: [],
        style: "",
        aspectRatio: "",
        reuseSeconds: 86400,
        modelId: "",
        prompt: "",
        parameters: {},
        fallback: "block",
      }),
    bannedWords: z.array(z.string()).default([]),
    qualityHints: z
      .array(z.string())
      .default(["避免翻译腔和抽象空话", "观点落在可核实的事件或行情上"]),
    dedupWindow: z.number().int().min(1).max(500).default(40),
    similarityThreshold: z.number().min(0.1).max(1).default(0.76),
    repairAttempts: z.number().int().min(0).max(3).default(1),
    semanticReview: z.boolean().default(true),
  })
  .superRefine((v, c) => {
    if (v.preferredMin > v.preferredMax || v.preferredMax > v.maxChars)
      c.addIssue({ code: "custom", message: "优先长度区间必须在硬上限内。" });
    if (v.selection === "fixed" && new Set(v.tokens).size !== v.tokenCount)
      c.addIssue({ code: "custom", message: "固定币种数量与要求不符。" });
    if (v.image.mode !== "library" && !v.image.modelId)
      c.addIssue({ code: "custom", message: "生成图片需要指定批准模型。" });
  });
export type Rules = z.infer<typeof rulesSchema>;
export function parseRules(input: unknown): Rules {
  const r = rulesSchema.safeParse(input);
  requireThat(
    r.success,
    "INVALID_PRESET_RULES",
    r.success
      ? ""
      : r.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
  );
  return r.data;
}
export function interval(min: number, max: number, rng = random) {
  requireThat(
    Number.isSafeInteger(min) &&
      Number.isSafeInteger(max) &&
      min > 0 &&
      max >= min &&
      max <= 31536000,
    "INVALID_INTERVAL_RANGE",
    "间隔需为正整数秒，上限不低于下限且不超过一年。",
  );
  return min + Math.floor(rng() * (max - min + 1));
}
export function weighted<T extends Doc>(candidates: T[], rng = random) {
  const valid = candidates.filter(
    (c) => Number.isFinite(c.weight) && c.weight > 0,
  );
  const sum = valid.reduce((n, c) => n + c.weight, 0);
  requireThat(
    Number.isFinite(sum) && sum > 0,
    "NO_ELIGIBLE_PRESET",
    "没有可参与抽样的正权重已发布预设。",
    409,
  );
  const draw = rng(),
    target = draw * sum;
  let cumulative = 0;
  const selected =
    valid.find((c) => (cumulative += c.weight) > target) || valid.at(-1)!;
  return {
    selected,
    draw,
    totalWeight: sum,
    candidates: valid.map((c) => ({ ...c, probability: c.weight / sum })),
  };
}
export function exampleRules(modelId = "") {
  return parseRules({
    modelId: modelId || "configure-text-model",
    direction:
      "选择币安现货滚动24小时涨跌榜中的三个代币。结合可核实的金色财经或区块律动新闻，写出我作为散户的具体观察、疑问和态度。不假装有交易经历，不把价格与新闻直接写成因果。",
    sourceRules: [
      {
        sourceId: "source_binance",
        required: true,
        maxAgeSeconds: 900,
        priority: 1,
      },
      {
        sourceId: "source_blockbeats",
        required: false,
        maxAgeSeconds: 259200,
        priority: 2,
      },
      {
        sourceId: "source_jinse",
        required: false,
        maxAgeSeconds: 259200,
        priority: 3,
      },
    ],
  });
}
