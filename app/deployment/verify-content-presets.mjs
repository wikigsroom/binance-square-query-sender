import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../square-dashboard/node_modules/@playwright/test/index.mjs";

const directory = new URL("./", import.meta.url);
const output = new URL("../../docs/content-presets/", directory);
process.env.TEMP = fileURLToPath(new URL("./browser-temp/", directory));
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
await mkdir(output, { recursive: true });
const credentials = JSON.parse(await readFile(new URL(".private/bootstrap.json", directory), "utf8"));
const pack = JSON.parse(await readFile(new URL("../content-presets/presets.json", directory), "utf8"));
const imported = JSON.parse(await readFile(new URL("import-report.json", output), "utf8"));
const report = { url: "https://bn.sid.mom/presets", checkedAt: new Date().toISOString(), pageErrors: [], requestErrors: [], checks: {} };
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => report.requestErrors.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(report.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("用户名", { exact: true }).fill(credentials.adminUsername);
  await page.getByLabel("密码", { exact: true }).fill(credentials.adminPassword);
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  await page.getByRole("heading", { name: "内容预设", exact: true }).waitFor();
  await page.locator(".preset-card").first().waitFor();
  const cards = page.locator(".preset-card");
  assert.equal(await cards.count(), 10);
  report.checks.presetNames = [];
  for (const preset of pack.presets) {
    const card = cards.filter({ has: page.getByRole("heading", { name: preset.name, exact: true }) });
    assert.equal(await card.count(), 1);
    assert.equal(await card.getByText("已有图库", { exact: true }).count(), 1);
    assert.equal(await card.getByText(/^PUBLISHED v\d+$/).count(), 1);
    report.checks.presetNames.push(preset.name);
  }
  report.checks.tenPublishedPresetsWithLibraryOnly = true;
  await page.screenshot({ path: fileURLToPath(new URL("production-presets.png", output)), fullPage: true });
  const sample = pack.presets.find((p) => p.key === "feature-essay");
  const sampleCard = cards.filter({ has: page.getByRole("heading", { name: sample.name, exact: true }) });
  await sampleCard.getByRole("button", { name: "编辑规则", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("优先最少字符", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("优先最少字符", { exact: true }).inputValue(), "1200");
  assert.equal(await dialog.getByLabel("优先最多字符", { exact: true }).inputValue(), "1800");
  assert.equal(await dialog.getByLabel("硬上限（含空白和标签）", { exact: true }).inputValue(), "2000");
  report.checks.essayLengthRulesVisible = true;
  await dialog.getByRole("tab", { name: "配图规则", exact: true }).click();
  assert.equal(await dialog.getByLabel("图片来源", { exact: true }).inputValue(), sample.rules.image.mode);
  assert.equal(await dialog.getByLabel("图库匹配为空时", { exact: true }).inputValue(), sample.rules.image.fallback);
  assert.equal(await dialog.getByLabel("风格", { exact: true }).inputValue(), sample.rules.image.style);
  assert.equal(await dialog.getByLabel("生图要求", { exact: true }).inputValue(), sample.rules.image.prompt);
  assert.equal(await dialog.getByLabel("批准的 GPT Image 2 模型", { exact: true }).inputValue(), imported.models.image.id);
  report.checks.approvedImageModelAndPromptVisible = true;
  await page.screenshot({ path: fileURLToPath(new URL("production-image-rules.png", output)), fullPage: false });
  await dialog.getByRole("tab", { name: "模型与质量", exact: true }).click();
  assert.equal(await dialog.getByLabel("批准的文字模型", { exact: true }).inputValue(), imported.models.text.id);
  report.checks.approvedTextModelVisible = true;
  await dialog.getByRole("button", { name: "关闭", exact: true }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  report.checks.mobileNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert.ok(report.checks.mobileNoHorizontalOverflow);
  await page.screenshot({ path: fileURLToPath(new URL("production-mobile.png", output)), fullPage: false });
  const applicationOrigins = ["https://bn.sid.mom", "https://bn-api.sid.mom"];
  report.passed = report.pageErrors.length === 0 && !report.requestErrors.some((error) =>
    applicationOrigins.includes(new URL(error.url).origin) && !error.error?.includes("ERR_ABORTED"));
} catch (error) {
  report.passed = false;
  report.error = error.message;
} finally {
  await browser.close();
  report.browserClosed = true;
}
await writeFile(new URL("browser-verification.json", output), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
