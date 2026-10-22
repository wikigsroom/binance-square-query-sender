import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { Doc, Row, hash, now } from "../src/core.js";
import { ARTICLE_POLICY_VERSION, imageBriefInBody } from "../src/article-policy.js";
import { writingHistory, writingRepair, writingRevision } from "../src/writing-context.js";
import { validate } from "../src/validation.js";

const leakedBody = '行业梗图：一只戴工牌的河狸策划，把“资产流通”流程图贴满墙。玩家递来便签：“奖励领完了，明天为什么还来？”';
const historyRow = (text: string, id = "history_example"): Row => ({
  id, text, version: 1, createdAt: now(), updatedAt: now(),
});
const artifactCases = [
  leakedBody,
  "先看实际数据。行业梗图：一只水獭在办公室画箭头。",
  "- **配图说明**：两位同事在白板前争论。",
  "### 配图建议\n一只河狸抱着流程图。",
  "（生图提示词：穿工装的企鹅加班。）",
  "正文。\n梗图可以画成一位快递员寻找门牌。",
  "图像生成提示词：an office animal",
  "Image prompt: an animal in an office",
  "建议画一张医生和程序员互相递需求的梗图。",
  "第一格：策划拿来需求。\n第二格：研发把需求退回。",
  "镜头1：推近白板。\n镜头2：切到角色脸部。",
];

test("article boundaries catch image production artifacts without banning ordinary meme writing", () => {
  for (const text of artifactCases)
    assert.equal(imageBriefInBody(text)?.policyVersion, ARTICLE_POLICY_VERSION, text);
  for (const text of [
    "我觉得这轮Meme热度得看真实使用，不能只看梗图传播。",
    "我现在就像跑轮里的仓鼠，榜单转得快，项目的进展却没跟上。",
    "看得我想笑。涨一天就叫新周期，跌一天就叫没未来？我还是想先看项目交付。",
    "金色报道，团队上线了图片交易功能。我关心的是有没有真实用户。",
    "我拿这张梗图笑了半天，但项目有没有收入，还得看财报。",
  ]) assert.equal(imageBriefInBody(text), null, text);
  const rows = [...artifactCases, "干净的文章", "干净的文章", ""].map((text, index) => historyRow(text, `history_${index}`));
  assert.deepEqual(writingHistory(rows), ["干净的文章"]);
  assert.equal(rows[0].text, leakedBody, "stored posts are not edited");
});

test("image-script bodies require an AI repair in both validation modes", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const job = await f.job();
  const input = await f.sources.collect(job);
  for (const mode of ["strict", "publish_first"] as const) {
    for (const text of artifactCases) {
      const content = { text, contentHash: hash(text), tokens: [], claims: [], usedSourceIds: [], newsClaims: [] } as unknown as Row;
      const result = validate(content, job.rules, input, [], [], mode);
      assert.equal(result.passed, false, `${mode}: ${text}`);
      assert.ok(result.errors.some((issue: Doc) => issue.code === "IMAGE_BRIEF_IN_BODY"));
      assert.ok(!result.warnings.some((issue: Doc) => issue.code === "IMAGE_BRIEF_IN_BODY"));
      assert.equal(result.articlePolicyVersion, ARTICLE_POLICY_VERSION);
      assert.equal(content.text, text, "never strip paragraphs from a model output");
    }
  }
});

test("revision, repair and review wire contexts cannot recycle a rejected image script or image-only metadata", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const base = await f.job();
  const marker = "IMAGE_SCRIPT_THAT_MUST_NOT_RETURN_TO_THE_AUTHOR";
  const contaminated = `${leakedBody}${marker}`;
  const job = {
    ...base,
    baseText: contaminated,
    revision: "围绕实际进展重写，保留自然口语。",
    rules: { ...base.rules, sourceRules: base.rules.sourceRules.map((source: Doc) => ({ ...source, imagePrompt: marker })) },
  };
  const input = await f.sources.collect(job);
  const snapshot = {
    id: "news_snapshot", type: "news", title: "AAA 计划测试升级", body: "AAA 团队计划测试协议升级。",
    publishedAt: now(), name: "律动", relatedTokens: ["AAA"], imagePrompt: marker, metadata: { image: marker },
    version: 1, createdAt: now(), updatedAt: now(),
  };
  const repair = { previousDraft: { text: contaminated, tokens: input.tokens, claims: [{ quote: contaminated }], newsClaims: [{ quote: contaminated }] }, errors: [{ code: "IMAGE_BRIEF_IN_BODY", quote: contaminated }] };
  const { content } = await f.ai.text(job, { ...input, snapshots: [snapshot] }, [historyRow(contaminated)], repair);
  await f.ai.review(job, content, { ...input, snapshots: [snapshot] }, [historyRow(contaminated)]);
  for (const wire of f.state.textRequests) {
    const payload = JSON.parse(wire.body.messages[1].content);
    assert.ok(!JSON.stringify(payload).includes(marker));
    assert.equal(payload.rules.direction, job.rules.direction);
    assert.deepEqual(payload.facts, input.facts);
    assert.equal((payload.news || payload.sources)[0].body, snapshot.body);
  }
  const payload = JSON.parse(f.state.textRequests[0].body.messages[1].content);
  assert.equal(payload.task.baseText, null);
  assert.equal(payload.task.rewriteFromFacts, true);
  assert.equal(payload.task.revision, job.revision);
  assert.equal(payload.repairErrors.previousDraft, null);
  assert.equal(payload.repairErrors.rewriteFromFacts, true);
  assert.equal(payload.outputContract.contentType, "article_body");
  assert.equal(payload.outputContract.imageInstructionsAllowed, false);
  assert.equal(job.baseText, contaminated);
  assert.equal(repair.previousDraft.text, contaminated);

  const ordinary = { previousDraft: { text: "一篇需要补标签的正常文章", tokens: ["AAA"] }, errors: [{ code: "TOKEN_TAGS" }] };
  assert.deepEqual(writingRepair(ordinary), ordinary);
  assert.equal(writingRevision({ ...job, baseText: "一篇正常的旧文章" }).baseText, "一篇正常的旧文章");
});

test("publish-first repairs a leaked script with the approved model before one successful submission", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const runtime = await f.db.need("runtime", "main");
  await f.control.runtime({ expectedVersion: runtime.version, contentValidationMode: "publish_first" });
  f.state.authorTexts.push(leakedBody);
  await f.job();
  const done = await f.execute();
  assert.equal(done.state, "published", JSON.stringify(done.error));
  assert.equal(f.state.modelCalls, 2);
  assert.equal(f.state.calls, 1);
  const versions = await f.db.list("content_versions", "data->>'jobId'=$1", [done.id]);
  assert.equal(versions.length, 2);
  assert.ok(versions.some((version) => version.text === leakedBody), "preserve the rejected AI output for diagnosis");
  const post = (await f.db.list("posts"))[0];
  assert.equal(imageBriefInBody(post.text), null);
  assert.equal(post.contentId, done.contentId);
  const author = JSON.parse(f.state.textRequests[1].body.messages[1].content);
  assert.equal(author.repairErrors.previousDraft, null);
  assert.ok(!JSON.stringify(author).includes(leakedBody));
  assert.equal((await f.db.list("publish_attempts")).length, 1);
  assert.equal((await f.pipeline.verify(post.id)).status, "verified");
});

test("persistent image-script output stops finitely before image generation, upload or submission", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const runtime = await f.db.need("runtime", "main");
  await f.control.runtime({ expectedVersion: runtime.version, contentValidationMode: "publish_first" });
  const job = await f.job();
  await f.db.update("jobs", job.id, { rules: { ...job.rules, image: { ...job.rules.image, mode: "generate", modelId: f.imageModel.id } } });
  f.state.authorTexts.push(...Array(job.rules.repairAttempts + 1).fill(leakedBody));
  let uploads = 0;
  f.state.beforeUpload = async () => { uploads++; };
  const done = await f.execute();
  assert.equal(done.state, "failed");
  assert.equal(done.error.code, "TEXT_VALIDATION_FAILED");
  assert.ok(done.error.details.errors.some((issue: Doc) => issue.code === "IMAGE_BRIEF_IN_BODY"));
  assert.equal(f.state.modelCalls, job.rules.repairAttempts + 1);
  assert.equal(f.state.imageCalls, 0);
  assert.equal(uploads, 0);
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("publish_attempts")).length, 0);
  assert.equal((await f.db.need("accounts", f.account.id)).blockReason, null);
});

test("the last gate rejects a legacy passed script before upload and before submission intent", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const runtime = await f.db.need("runtime", "main");
  await f.control.runtime({ expectedVersion: runtime.version, contentValidationMode: "publish_first" });
  await f.job();
  const job = await f.pipeline.claim();
  assert.ok(job);
  const input = await f.sources.collect(job);
  f.state.authorTexts.push(leakedBody);
  const { content } = await f.ai.text(job, input, []);
  const validation = await f.db.insert("validation_runs", {
    jobId: job.id, contentId: content.id, presetVersionId: job.presetVersionId,
    contentHash: content.contentHash, passed: true, validationMode: "publish_first",
  });
  for (const intent of [false, true])
    await assert.rejects(() => f.pipeline.gate(job, content, validation, input, f.asset, intent), { code: "IMAGE_BRIEF_IN_BODY" });
  assert.equal(f.state.calls, 0);
  assert.equal((await f.db.list("publish_attempts")).length, 0);
});
