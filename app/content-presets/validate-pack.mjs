import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseRules } from "../square-service/dist/src/rules.js";

const packPath = new URL("./presets.json", import.meta.url);
const bytes = await readFile(packPath);
const pack = JSON.parse(bytes);
assert.equal(pack.presets.length, 10);
assert.equal(new Set(pack.presets.map((p) => p.key)).size, 10);
assert.equal(new Set(pack.presets.map((p) => p.name)).size, 10);
assert.equal(new Set(pack.presets.map((p) => p.rules.direction)).size, 10);
assert.equal(new Set(pack.presets.map((p) => p.rules.image.prompt)).size, 10);
assert.equal(new Set(pack.presets.map((p) => p.rules.image.style)).size, 10);
const checks = pack.presets.map((preset) => {
  const rules = parseRules(preset.rules);
  assert.deepEqual(rules, preset.rules, `${preset.key}: schema must preserve every field`);
  assert.equal(rules.image.mode, "generate");
  assert.equal(rules.image.fallback, "block");
  assert.ok(rules.image.prompt.length > 100);
  assert.equal(rules.image.modelId, "@default");
  assert.equal(rules.modelId, "@default");
  assert.equal(rules.image.parameters.size, "1024x1024");
  assert.equal(rules.image.parameters.quality, "medium");
  assert.ok(rules.sourceRules.some((s) => s.sourceId === "source_binance" && s.required));
  assert.ok(rules.sourceRules.some((s) => s.sourceId === "source_blockbeats"));
  assert.ok(rules.sourceRules.some((s) => s.sourceId === "source_jinse"));
  assert.equal(rules.tagCount, rules.tokenCount);
  if (rules.selection === "market_top5") assert.equal(rules.bothSides, true);
  return {
    key: preset.key, name: preset.name, status: "passed",
    preferredCharacters: [rules.preferredMin, rules.preferredMax], hardLimit: rules.maxChars,
    imageMode: rules.image.mode, imageFallback: rules.image.fallback, imageStyle: rules.image.style,
  };
});
const report = {
  packId: pack.packId, checkedAt: new Date().toISOString(),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  schema: "square-service parseRules", status: "passed", count: checks.length, checks,
};
const destination = new URL("../../docs/content-presets/", import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL("validation.json", destination), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, count: checks.length, report: fileURLToPath(new URL("validation.json", destination)) }));
