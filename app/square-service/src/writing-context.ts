import type { Doc, Row } from "./core.js";
import { imageBriefInBody } from "./article-policy.js";

// Explicit text-only projection: future image fields cannot silently enter writing/review requests.
const WRITING_FIELDS = [
  "direction", "language", "perspective", "tone", "preferredMin", "preferredMax",
  "maxChars", "paragraphs", "tagCount", "requiredTags", "selection", "tokens",
  "tokenCount", "bothSides", "requiredPercent", "sourceRules", "factsMaxAgeSeconds",
  "material", "bannedWords", "qualityHints",
] as const;

export function writingRules(rules: Doc): Doc {
  const projected = Object.fromEntries(WRITING_FIELDS.filter((key) => key in rules).map((key) => [key, rules[key]]));
  if (Array.isArray(projected.sourceRules))
    projected.sourceRules = projected.sourceRules.map((source: Doc) =>
      Object.fromEntries(["sourceId", "required", "maxAgeSeconds", "priority"]
        .filter((key) => key in source).map((key) => [key, source[key]])),
    );
  return projected;
}

// Exclude entire contaminated examples from model context. Published originals stay immutable.
export function writingHistory(history: Row[]): string[] {
  return [...new Set(history.map((row) => row.text).filter((text): text is string =>
    typeof text === "string" && !!text.trim() && !imageBriefInBody(text),
  ))].slice(0, 40);
}

export function writingRevision(job: Row): Doc {
  const excluded = typeof job.baseText === "string" && !!imageBriefInBody(job.baseText);
  return {
    revision: job.revision || null,
    baseText: excluded ? null : job.baseText || null,
    ...(excluded ? { baseTextExcluded: "image_brief", rewriteFromFacts: true } : {}),
  };
}

export function writingRepair(repair: Doc | null): Doc | null {
  if (!repair || !imageBriefInBody(String(repair.previousDraft?.text || ""))) return repair;
  // Do not echo the rejected script, its quotes, or stale claim metadata back to
  // the author. Recreate the whole article and metadata from the same facts.
  return {
    previousDraft: null,
    rewriteFromFacts: true,
    errors: [{
      code: "IMAGE_BRIEF_IN_BODY",
      message: "上一稿混入了图片制作脚本，已从本次输入排除。请按文字预设、新闻和行情重新创作整篇正文及全部引用元数据，不写画面或角色故事脚本。",
    }],
    previousErrorCodes: [...new Set((repair.errors || []).map((issue: Doc) => issue.code))],
  };
}

export function writingNews(snapshots: Row[]): Doc[] {
  return snapshots.filter((source) => source.type === "news").map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    source: source.name,
    name: source.name,
    attribution: source.attribution || source.name,
    publishedAt: source.publishedAt,
    publishedDate: source.publishedDate || source.publishedAt?.slice(0, 10),
    timezone: source.timezone || "UTC",
    evidenceUrl: source.evidenceUrl || source.url,
    readVia: source.readVia,
    eventAt: source.eventAt,
    relatedTokens: source.relatedTokens,
    body: source.body,
  }));
}
