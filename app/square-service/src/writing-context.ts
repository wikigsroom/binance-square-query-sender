import type { Doc, Row } from "./core.js";

// Explicit text-only projection: future image fields cannot silently enter writing/review requests.
const WRITING_FIELDS = [
  "direction", "language", "perspective", "tone", "preferredMin", "preferredMax",
  "maxChars", "paragraphs", "tagCount", "requiredTags", "selection", "tokens",
  "tokenCount", "bothSides", "requiredPercent", "sourceRules", "factsMaxAgeSeconds",
  "material", "bannedWords", "qualityHints",
] as const;

export function writingRules(rules: Doc): Doc {
  return Object.fromEntries(WRITING_FIELDS.filter((key) => key in rules).map((key) => [key, rules[key]]));
}

// Exclude entire contaminated examples from model context. Published originals stay immutable.
export function writingHistory(history: Row[]): string[] {
  const imageBrief = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:(?:(?:行业|四格|双格|单格|反应|动物|职场|meme)\s*)?梗图(?:创意|设计|说明)?|配图(?:创意|建议|说明|描述|提示词)?|生图(?:提示词|要求|说明)?|图像提示词|图片(?:说明|描述)?|画面(?:描述|说明)?|分镜(?:说明)?|image\s*prompt)\s*(?:[：:]|可以画|可以是|可画成|建议画|画成|是一)/im;
  return history.map((row) => row.text).filter((text): text is string =>
    typeof text === "string" && !imageBrief.test(text),
  ).slice(0, 40);
}
