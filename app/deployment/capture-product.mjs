// Read-only production documentation capture. Credentials never enter the manifest.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../square-dashboard/node_modules/@playwright/test/index.mjs";

const here = new URL("./", import.meta.url);
const out = new URL("../../docs/product/screenshots/", here);
const site = process.env.SQUARE_CAPTURE_ORIGIN || "https://bn.sid.mom";
const api = process.env.SQUARE_CAPTURE_API_ORIGIN || "https://bn-api.sid.mom";
const credentials = JSON.parse(await readFile(new URL(".private/bootstrap.json", here), "utf8"));
await mkdir(out, { recursive: true });
process.env.TEMP = fileURLToPath(new URL("browser-temp/", here));
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const manifest = {
  capturedAt: new Date().toISOString(), environment: "production", origin: site,
  readOnly: true, redactions: ["credential masks", "password fields"],
  screenshots: [], pageErrors: [], blockedMutations: [],
};
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "Asia/Taipei" });
  await context.route(`${api}/api/v1/**`, async (route) => {
    const request = route.request(), method = request.method(), pathname = new URL(request.url()).pathname;
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !["/api/v1/auth/login", "/api/v1/auth/logout"].includes(pathname)) {
      manifest.blockedMutations.push({ method, pathname });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => manifest.pageErrors.push(error.message));
  async function shot(name, caption, fullPage = false) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(550);
    await page.screenshot({ path: fileURLToPath(new URL(name, out)), fullPage,
      mask: [page.locator(".key-mask"), page.locator(".connection-meta"), page.locator("input[type=password]")],
      maskColor: "#b8c3ce", animations: "disabled" });
    manifest.screenshots.push({ file: name, caption, path: new URL(page.url()).pathname + new URL(page.url()).search,
      viewport: page.viewportSize(), theme: await page.locator("html").getAttribute("data-theme") || "light" });
    console.log(`Captured ${name}`);
  }
  async function visit(path, title) {
    await page.goto(`${site}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.getByRole("heading", { name: title, exact: true }).waitFor({ timeout: 30000 });
  }
  await page.goto(`${site}/overview`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByLabel("用户名", { exact: true }).waitFor();
  await shot("01-login.png", "管理员登录 / Administrator sign-in");
  await page.getByLabel("用户名", { exact: true }).fill(credentials.adminUsername);
  await page.getByLabel("密码", { exact: true }).fill(credentials.adminPassword);
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  await page.getByRole("heading", { name: "账号独立计划", exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => localStorage.setItem("square-theme", "light"));
  await visit("/overview", "账号独立计划");
  await shot("02-overview-light.png", "生产运行总览（浅色）/ Production overview, light");
  const runtime = await page.request.get(`${api}/api/v1/runtime`);
  assert.equal(runtime.status(), 200);
  const runtimeData = (await runtime.json()).data;
  manifest.runtime = { contentValidationMode: runtimeData.contentValidationMode, paused: runtimeData.paused, publishTransportEnabled: runtimeData.publishTransportEnabled };
  await page.evaluate(() => localStorage.setItem("square-theme", "dark"));
  await visit("/overview", "账号独立计划");
  await shot("03-overview-dark.png", "生产运行总览（深色）/ Production overview, dark");
  await page.evaluate(() => localStorage.setItem("square-theme", "light"));
  await visit("/accounts", "账号与计划");
  await page.locator(".account-name").first().waitFor();
  await shot("04-accounts.png", "多账号与独立随机计划 / Accounts and independent schedules");
  await page.locator(".account-name").first().click();
  await page.getByRole("dialog").getByRole("tab", { name: "独立计划", exact: true }).waitFor();
  await shot("05-account-schedule.png", "账号随机周期与下一次执行 / Per-account random interval");
  await page.getByRole("tab", { name: "预设权重", exact: true }).click();
  await shot("06-preset-weights.png", "多预设权重和有效概率 / Weighted preset bindings");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).first().click();
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await shot("07-key-only-import.png", "只需 API Key 的批量导入（空表单）/ Key-only import, empty form");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).first().click();
  await visit("/presets", "内容预设");
  await page.getByRole("button", { name: "编辑规则" }).first().waitFor();
  await shot("08-preset-library.png", "十种内容与生图预设 / Ten content and image playbooks", true);
  await page.getByRole("button", { name: "编辑规则" }).first().click();
  await page.getByRole("dialog").getByRole("tab", { name: "内容与文字", exact: true }).waitFor();
  await shot("09-preset-editor.png", "内容预设与字数、文风约束 / Versioned content rules");
  await page.getByRole("tab", { name: "配图规则", exact: true }).click();
  await shot("10-image-rules.png", "预设配套的图片模型和风格 / Per-preset image generation rules");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).first().click();
  await visit("/posts", "帖子中心");
  await page.getByRole("button", { name: "查看来源与回执" }).first().waitFor();
  await shot("11-posts.png", "真实发布记录与搜索 / Actual posts and search");
  await page.getByRole("button", { name: "查看来源与回执" }).first().click();
  await page.getByRole("dialog").locator(".article-preview").waitFor();
  await shot("12-post-detail.png", "正文、配图、来源及发布回执 / Post, image, sources and receipt");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).first().click();
  await visit("/media", "图库与生图");
  await page.locator(".media-card").first().waitFor();
  await page.locator(".media-card img").first().evaluate((img) => img.decode().catch(() => {}));
  await shot("13-media-library.png", "托管图库及 AI 配图 / Managed library and generated images");
  await visit("/jobs", "任务与日志");
  await page.getByRole("button", { name: "详情", exact: true }).first().waitFor();
  await shot("14-jobs.png", "任务状态、排队与错误记录 / Job states, queues and errors");
  await page.getByRole("button", { name: "详情", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "阶段日志", exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "阶段日志", exact: true }).click();
  await shot("15-job-events.png", "任务阶段时间线 / Per-job event timeline");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).first().click();
  await visit("/settings?section=models", "系统设置");
  await page.getByRole("heading", { name: "让合适的 AI，写出你的内容。", exact: true }).waitFor();
  await shot("16-model-connections.png", "明确的文字、图片模型与协议连接 / Explicit model and protocol configuration", true);
  await visit("/settings?section=sources", "系统设置");
  await page.getByRole("heading", { name: "素材与新闻来源", exact: true }).waitFor();
  await page.locator(".source-card").first().waitFor();
  await shot("17-news-market-sources.png", "金色、律动与币安现货来源 / Jinse, BlockBeats and Binance spot sources", true);
  await visit("/settings?section=runtime", "系统设置");
  await page.getByLabel("内容校验模式", { exact: true }).waitFor();
  await shot("18-runtime-controls.png", "并发、内容校验模式与 Worker / Runtime controls and worker");
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("/overview", "账号独立计划");
  await shot("19-mobile-overview.png", "移动端总览 / Mobile overview", true);
  await visit("/accounts", "账号与计划");
  await page.locator(".account-name").first().waitFor();
  await shot("20-mobile-accounts.png", "移动端账号 / Mobile accounts", true);
  const after = (await (await page.request.get(`${api}/api/v1/runtime`)).json()).data;
  assert.equal(after.contentValidationMode, runtimeData.contentValidationMode);
  assert.equal(after.paused, runtimeData.paused);
  assert.equal(after.publishTransportEnabled, runtimeData.publishTransportEnabled);
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  assert.equal(manifest.blockedMutations.length, 0, "Capture attempted a non-authentication write");
  manifest.passed = manifest.pageErrors.length === 0;
} catch (error) {
  manifest.passed = false;
  manifest.error = String(error.message).split(credentials.adminPassword).join("[redacted]");
  console.error(manifest.error);
} finally {
  await browser.close();
  manifest.browserClosed = true;
  manifest.finishedAt = new Date().toISOString();
  await writeFile(new URL("../capture-manifest.json", out), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(JSON.stringify({ passed: manifest.passed, screenshots: manifest.screenshots.length, browserClosed: manifest.browserClosed }));
if (!manifest.passed) process.exitCode = 1;
