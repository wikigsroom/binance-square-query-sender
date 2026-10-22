import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { IMAGE_POLICY_VERSION, MEME_INDUSTRIES, memeImageFields } from "../src/image-policy.js";

test("an image job keeps its industry and layout when the mandatory brief is reapplied", () => {
  const first = memeImageFields({ prompt: "旧要求：制作没有文字的金融杂志封面。", requestedAspectRatio: "1:1" });
  const again = memeImageFields({ ...first, prompt: "替换成没有梗点的产品海报", requestedAspectRatio: "1:1" });
  assert.deepEqual(again, first);
  assert.equal(first.imagePolicy.version, IMAGE_POLICY_VERSION);
  assert.ok(MEME_INDUSTRIES.some(([id]) => id === first.imagePolicy.industry));
  assert.match(first.prompt, /只允许生成各行各业的 meme 梗图/);
  assert.match(first.prompt, /画面宽高比：1:1/);
  assert.equal(first.requestedPrompt, "旧要求：制作没有文字的金融杂志封面。");
});

test("manual jobs and legacy queued images send meme briefs to the actual image endpoint", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const manual = await f.media.createJob({ modelId: f.imageModel.id, prompt: "画一幅精美的新闻编辑插画。" });
  const frozen = manual.imagePolicy;
  await f.media.generate(manual);
  const completed = await f.db.need("image_jobs", manual.id);
  assert.equal(completed.state, "completed");
  assert.deepEqual(completed.imagePolicy, frozen);
  assert.equal(f.state.imageRequests[0].prompt, completed.prompt);

  const old = await f.db.insert("image_jobs", {
    modelId: f.imageModel.id, prompt: "画一张宏观金融概念摄影，完全没有梗点。",
    parameters: {}, state: "queued", publicationJobId: "historical-frozen-publication", assetId: null,
  });
  await f.media.generate(old);
  const upgraded = await f.db.need("image_jobs", old.id);
  assert.equal(upgraded.imagePolicy.kind, "industry_meme_only");
  assert.equal(upgraded.requestedPrompt, old.prompt);
  assert.equal(upgraded.publicationJobId, old.publicationJobId);
  assert.equal(f.state.imageRequests[1].prompt, upgraded.prompt);
  const runs = await f.db.list("generation_runs", "data->>'type'='image'");
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.equal(run.imagePolicy.version, IMAGE_POLICY_VERSION);
    assert.equal(run.prompt, run.requestBody.prompt);
    assert.match(run.requestBody.prompt, /只允许生成各行各业的 meme 梗图/);
    assert.match(run.requestBody.prompt, /笑点/);
    assert.ok(run.requestedPrompt);
  }
  assert.equal(f.state.calls, 0, "checking image construction must not publish a post");
});

test("the final AI image adapter also applies the rule to a direct legacy request", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const old = await f.db.insert("image_jobs", {
    modelId: f.imageModel.id, prompt: "普通产品展示图", parameters: {}, state: "queued",
  });
  const result = await f.ai.image(old);
  assert.ok(result.bytes.length);
  assert.equal(result.run.imagePolicy.kind, "industry_meme_only");
  assert.equal(result.run.requestedPrompt, "普通产品展示图");
  assert.equal(result.run.prompt, f.state.imageRequests[0].prompt);
  assert.match(result.run.prompt, /只允许生成各行各业的 meme 梗图/);
  assert.equal(f.state.imageCalls, 1);
});
