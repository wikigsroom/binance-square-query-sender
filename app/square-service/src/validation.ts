import { Row, Doc, hash, chars, normalize } from "./core.js";
import { Rules } from "./rules.js";
import { ARTICLE_POLICY_VERSION, imageBriefInBody } from "./article-policy.js";

export function validate(
  content: Row,
  rules: Rules,
  input: Doc,
  history: Row[],
  bannedWords: string[],
  validationMode: "strict" | "publish_first" = "strict",
): Doc {
  const errors: Doc[] = [],
    warnings: Doc[] = [],
    text = content.text as string;
  const fail = (code: string, message: string, details: Doc = {}) => {
    const issue = { code, message, ...details };
    if (
      validationMode === "publish_first" &&
      !["CONTENT_HASH_MISMATCH", "TEXT_LENGTH", "IMAGE_BRIEF_IN_BODY"].includes(code)
    )
      warnings.push({ ...issue, nonBlocking: true });
    else errors.push(issue);
  };
  if (hash(normalize(text)) !== content.contentHash)
    fail("CONTENT_HASH_MISMATCH", "正文摘要与成稿版本不一致。");
  if (!text.trim() || chars(text) > rules.maxChars)
    fail("TEXT_LENGTH", "正文为空或超过硬上限。", {
      actual: chars(text),
      limit: rules.maxChars,
    });
  const imageBrief = imageBriefInBody(text);
  if (imageBrief)
    fail("IMAGE_BRIEF_IN_BODY", "正文混入图片制作说明，必须由 AI 重写文章后才能发送。", imageBrief);
  if (chars(text) < rules.preferredMin || chars(text) > rules.preferredMax)
    warnings.push({ code: "PREFERRED_LENGTH", actual: chars(text) });
  for (const word of new Set([...bannedWords, ...rules.bannedWords]))
    if (word && text.includes(word))
      fail("BANNED_WORD", `正文出现禁词：${word}`);
  const tags = [...text.matchAll(/\$([A-Za-z0-9]+)/g)].map((m) =>
      m[1].toUpperCase(),
    ),
    unique = [...new Set(tags)];
  const expected = [
    ...new Set(
      [...input.tokens, ...rules.requiredTags].map((t) =>
        t.replace(/^\$/, "").toUpperCase(),
      ),
    ),
  ];
  if (
    tags.length !== rules.tagCount ||
    unique.length !== tags.length ||
    expected.some((t) => !tags.includes(t)) ||
    unique.some((t) => !expected.includes(t))
  )
    fail("TOKEN_TAGS", "标签数量、唯一性或所选代币不符合预设。", {
      expected,
      actual: tags,
    });
  if (
    JSON.stringify([...(content.tokens || [])].sort()) !==
    JSON.stringify([...input.tokens].sort())
  )
    fail("TOKEN_METADATA", "模型币种元数据与任务不一致。");
  if (rules.requiredPercent) {
    const claims = content.claims || [];
    if (claims.length !== input.tokens.length)
      fail("MISSING_MARKET_CLAIMS", "缺少逐币涨跌幅证据。");
    for (const f of input.facts) {
      const matches = claims.filter((c: Doc) => c.token === f.token);
      if (matches.length !== 1) {
        fail("FACT_BINDING", `${f.token} 需要唯一行情陈述。`);
        continue;
      }
      const c = matches[0],
        quote = String(c.quote || ""),
        percent = quote.match(/([+\-−]\d+(?:\.\d+)?)\s*[%％]/g) || [];
      if (
        !quote ||
        !text.includes(quote) ||
        !quote.includes(`$${f.token}`) ||
        percent.length !== 1
      ) {
        fail(
          "FACT_BINDING",
          `${f.token} 事实片段必须包含一个对应标签和一个带符号百分比。`,
        );
        continue;
      }
      const value = Number(
        percent[0].replace(/[\s%％]/g, "").replace("−", "-"),
      );
      if (value !== f.roundedPercent || c.changePercent !== f.roundedPercent)
        fail("FACT_VALUE", `${f.token} 的数字或方向与快照不一致。`, {
          expected: f.roundedPercent,
          actual: value,
        });
      if (
        (value > 0 && /下跌|跌了|跌幅|跌\s*\+/.test(quote)) ||
        (value < 0 && /上涨|涨了|涨幅|涨\s*-/.test(quote))
      )
        fail("FACT_DIRECTION", `${f.token} 涨跌措辞方向错误。`);
    }
    if (!/24\s*(?:小时|h|H)/.test(text))
      fail("FACT_WINDOW", "需要明确24小时统计窗口。");
    const allPercent = [...text.matchAll(/[+\-−]?\d+(?:\.\d+)?\s*[%％]/g)];
    if (allPercent.length !== claims.length)
      fail("UNBOUND_PERCENT", "正文存在未绑定来源的百分比。");
  }
  const news = input.snapshots.filter((s: Row) => s.type === "news"),
    used = [...new Set(content.usedSourceIds || [])];
  for (const sourceId of used) {
    const source = news.find((s: Row) => s.id === sourceId);
    if (!source) {
      fail("NEWS_SOURCE", "引用了不存在的新闻来源。", { sourceId });
      continue;
    }
    const reportedDate =
        source.publishedDate || source.publishedAt.slice(0, 10),
      date = new Date(`${reportedDate}T00:00:00Z`),
      day = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
    if (
      !text.includes(source.name) &&
      !(source.attribution && text.includes(source.attribution)) &&
      !(/BlockBeats|律动/i.test(source.name) && /律动|BlockBeats/i.test(text))
    )
      fail("NEWS_ATTRIBUTION", "正文未简短标注新闻来源。");
    if (
      !text.includes(day) &&
      !text.includes(reportedDate.slice(5, 10)) &&
      !text.includes(`${date.getUTCMonth() + 1}/${date.getUTCDate()}`)
    )
      fail("NEWS_DATE", "正文未标注新闻报道日期。");
    const claims = (content.newsClaims || []).filter(
      (c: Doc) => c.sourceId === sourceId,
    );
    if (!claims.length) fail("NEWS_EVIDENCE", "引用新闻需要证据片段。");
    for (const c of claims) {
      if (!c.quote || !text.includes(c.quote))
        fail("NEWS_EVIDENCE", "新闻陈述不是本次成稿中的连续原样片段。", {
          sourceId,
          field: "quote",
          quote: c.quote || "",
        });
      if (!c.evidenceQuote || !source.body.includes(c.evidenceQuote))
        fail("NEWS_EVIDENCE", "新闻证据不在所绑定来源的原文中。", {
          sourceId,
          sourceTitle: source.title,
          field: "evidenceQuote",
          evidenceQuote: c.evidenceQuote || "",
          matchingSourceIds: c.evidenceQuote
            ? news
                .filter((s: Row) => s.body.includes(c.evidenceQuote))
                .map((s: Row) => s.id)
            : [],
        });
      if (
        /考虑|提议|提案|计划|拟|目标|测试|可能|预计/.test(c.evidenceQuote) &&
        !/考虑|提议|提案|计划|拟|目标|测试|可能|预计/.test(c.quote)
      )
        fail("NEWS_PROGRESS", "不能把计划、考虑或测试写成正式实施。");
    }
  }
  if ((content.newsClaims || []).some((c: Doc) => !used.includes(c.sourceId)))
    fail("NEWS_SOURCE", "新闻陈述未列出对应引用来源。");
  for (const s of input.snapshots)
    if (s.expiresAt && Date.parse(s.expiresAt) < Date.now())
      fail("FACTS_STALE", "事实快照已过期。", { snapshotId: s.id });
  const signatures: Doc[] = [];
  for (const old of history.slice(0, rules.dedupWindow)) {
    const score = similarity(text, old.text),
      exact = hash(text) === old.contentHash;
    if (exact || score >= rules.similarityThreshold) {
      signatures.push({ contentId: old.id, score });
      fail(
        "CONTENT_TOO_SIMILAR",
        "与近期文章高度相似，需要换观察重点与表达。",
        { contentId: old.id, score },
      );
      break;
    }
  }
  if (/作为AI|根据(?:您的|你的)要求|这篇(?:帖子|文章)将/.test(text))
    fail("META_NARRATION", "正文包含创作说明。");
  return {
    validationMode,
    articlePolicyVersion: ARTICLE_POLICY_VERSION,
    passed: errors.length === 0,
    errors,
    warnings,
    characterCount: chars(text),
    tokens: unique,
    contentHash: content.contentHash,
    sourceHashes: input.snapshots.map((s: Row) => ({
      id: s.id,
      hash: s.rawHash,
    })),
    similarity: signatures,
  };
}
function skeleton(text: string) {
  return text
    .toLowerCase()
    .replace(/\$[a-z0-9]+/g, "¤")
    .replace(/[+\-]?\d+(?:\.\d+)?/g, "#")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}
export function similarity(a: string, b: string) {
  const aa = skeleton(a),
    bb = skeleton(b);
  if (aa === bb) return 1;
  const shingles = (s: string) =>
    new Set(
      Array.from({ length: Math.max(0, s.length - 2) }, (_, i) =>
        s.slice(i, i + 3),
      ),
    );
  const x = shingles(aa),
    y = shingles(bb);
  if (!x.size || !y.size) return 0;
  let overlap = 0;
  for (const t of x) if (y.has(t)) overlap++;
  const dice = (2 * overlap) / (x.size + y.size);
  const opening = aa.slice(0, 12) === bb.slice(0, 12),
    ending = aa.slice(-12) === bb.slice(-12);
  return Math.min(1, dice + (opening ? 0.12 : 0) + (ending ? 0.12 : 0));
}
