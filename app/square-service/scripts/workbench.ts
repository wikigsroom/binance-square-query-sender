// Isolated local UI workbench. All model/market responses come from a loopback fixture server.
// Real publishing is hard-disabled even if the parent environment has credentials configured.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fixture } from "../tests/fixture.js";
import { now } from "../src/core.js";
process.env.APP_PROFILE = "fixture";
const f = await fixture();
f.config.publishEnabled = false;
await f.db.update("accounts", f.account.id, {
  name: "日常看盘",
  tags: ["市场观察"],
  notes: "隔离开发样本，无真实广场凭据",
});
await f.db.update("connections", f.connection.id, {
  name: "本机开发夹具 · 非真实 AI",
  provider: "custom",
  protocol: "openai_chat_images",
});
await f.db.update("models", f.model.id, { name: "开发夹具模型（非真实 AI）" });
await f.db.update("presets", f.preset.id, {
  name: "三币行情 · 散户观察",
  description: "观察滚动24小时涨跌幅，用自然中文表达具体观点，近期新闻可选。",
});
await f.db.update("runtime", "ai", {
  defaultTextModelId: f.model.id,
  defaultImageModelId: f.imageModel.id,
});
const names = ["链上慢观察", "事件笔记", "周末碎碎念"];
for (let i = 0; i < names.length; i++) {
  const a = await f.control.createAccount({
    name: names[i],
    apiKey: `fixture-unused-square-key-${i}`,
    tags: [i === 0 ? "链上数据" : i === 1 ? "新闻事件" : "个人观点"],
  });
  await f.control.bindings(a.id, {
    expectedVersion: 1,
    bindings: [{ presetId: f.preset.id, weight: i + 1, enabled: true }],
  });
}
for (let i = 0; i < 2; i++) {
  const p = await f.db.need("presets", f.preset.id),
    rules = {
      ...p.draftRules,
      tone: i
        ? "自然聊天，围绕实际事件，保留疑问"
        : "克制、有具体态度，多关注已实现的进展",
    };
  const draft = await f.control.savePreset({
    name: i ? "新闻事件 · 兑现追踪" : "项目进展 · 独立观点",
    description: i
      ? "将消息的报道时间、实施阶段和价格表现分开描述。"
      : "先看具体进展，再谈上涨下跌，不编造持仓或交易经历。",
    rules,
  });
  await f.control.publishPreset(draft.id, { expectedVersion: draft.version });
}
const imageRoot = path.resolve("../../imagegen"),
  images = (await readdir(imageRoot).catch(() => []))
    .filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
    .slice(0, 7);
for (const name of images)
  try {
    await f.media.ingest(
      await readFile(path.join(imageRoot, name)),
      { name, collection: "市场配图", tags: ["已有素材"], style: "市场插画" },
      { type: "library" },
    );
  } catch {}
for (let i = 0; i < 2; i++) {
  await f.control.newJob(null, "preview", {
    presetId: f.preset.id,
    idempotencyKey: `workbench-preview-${i}`,
  });
  await f.execute();
}
const accounts = await f.db.list("accounts");
const presets = await f.db.list("presets");
for (let i = 0; i < accounts.length; i++) {
  const binding = await f.db.need("bindings", accounts[i].id);
  await f.control.bindings(accounts[i].id, {
    expectedVersion: binding.version,
    bindings: presets.map((p, index) => ({
      presetId: p.id,
      weight: [5, 3, 2][(index + i) % 3],
      enabled: true,
    })),
  });
  const delay = [660, 1590, 2640, 4110][i];
  await f.db.update("schedules", accounts[i].id, {
    enabled: true,
    minIntervalSeconds: [600, 1200, 1800, 3600][i],
    maxIntervalSeconds: [1200, 2400, 3600, 5400][i],
    anchorAt: now(),
    sampledDelaySeconds: delay,
    nextDueAt: new Date(Date.now() + delay * 1000).toISOString(),
  });
}
await f.db.update("sources", "source_jinse", {
  url: `http://127.0.0.1:${f.port}/jinse`,
  allowedHosts: ["127.0.0.1"],
  allowPrivateNetwork: true,
  enabled: true,
});
// Source previews exercise real parsing/HTTP with synthetic local material only.
await f.db.update("sources", "source_blockbeats", {
  url: `http://127.0.0.1:${f.port}/newsflash`,
  allowedHosts: ["127.0.0.1"],
  allowPrivateNetwork: true,
  enabled: true,
});
await f.app.listen({ host: "127.0.0.1", port: 4321 });
await f.pipeline.start();
console.log(
  "Isolated workbench: http://localhost:4300 | owner / fixture-password-1234 | Real publishing disabled.",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void f.close().then(() => process.exit(0)));
