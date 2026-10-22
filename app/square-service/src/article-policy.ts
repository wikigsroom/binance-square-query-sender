import type { Doc } from "./core.js";

export const ARTICLE_POLICY_VERSION = "article-body-v1";

// Match explicit image-production artifacts, not ordinary discussion of memes,
// an animal metaphor, or a stylistic opinion. Share the same boundary everywhere.
const start = String.raw`(?:^|[\n。！？!?；;])\s*(?:[-*+>]\s+|\d+[.、]\s*)?(?:#{1,6}\s*)?(?:[（(【]\s*)?(?:\*\*|__)?`;
const label = String.raw`(?:(?:(?:行业|四格|双格|单格|反应|动物|职场|meme)\s*)?梗图(?:创意|设计|说明|脚本)?|配图(?:创意|建议|说明|描述|提示词|方案)?|生图(?:提示词|要求|说明)?|图像(?:生成)?提示词|图片(?:说明|描述|提示词)?|画面(?:描述|说明|设定)?|分镜(?:说明|脚本)?|image\s*prompt)`;
const labelledBrief = new RegExp(
  start + label + String.raw`(?:\*\*|__)?[ \t]*(?:[：:]|\r?\n|可以画|可以用|可以是|可画成|建议画|画成|是一)`,
  "im",
);
const drawingInstruction = new RegExp(
  start + String.raw`(?:请|建议|可以|不妨)?(?:配|画|绘制|生成|制作)(?:上)?一(?:张|幅|组)[^\n。！？!?]{0,40}(?:梗图|meme|插画|图片|漫画)`,
  "im",
);
const storyboard = /(?:^|\n)\s*(?:第[一1]格|镜头\s*1)\s*[：:][\s\S]{0,1000}?(?:第[二2]格|镜头\s*2)\s*[：:]/i;

export function imageBriefInBody(text: string): Doc | null {
  for (const [kind, pattern] of [
    ["image_brief", labelledBrief],
    ["drawing_instruction", drawingInstruction],
    ["storyboard", storyboard],
  ] as const) {
    const match = pattern.exec(text);
    if (match)
      return {
        policyVersion: ARTICLE_POLICY_VERSION,
        kind,
        quote: text.slice(match.index, match.index + 160).trim(),
      };
  }
  return null;
}
