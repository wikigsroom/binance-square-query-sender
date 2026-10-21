import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

process.env.TEMP = path.resolve("test-results/browser-temp");
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const output = path.resolve("../../docs/source-upgrade");
await mkdir(output, { recursive: true });
const credentials = JSON.parse(await readFile("../deployment/.private/bootstrap.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
const report = { url: "https://bn.sid.mom/settings?section=sources", checkedAt: new Date().toISOString(), pageErrors: [], requestErrors: [], checks: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => report.requestErrors.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(report.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("用户名", { exact: true }).fill(credentials.adminUsername);
  await page.getByLabel("密码", { exact: true }).fill(credentials.adminPassword);
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  await page.getByRole("heading", { name: "素材与新闻来源", exact: true }).waitFor({ timeout: 20000 });
  await page.locator(".source-market-table tbody tr").first().waitFor({ timeout: 30000 });
  report.checks.login = true;
  report.checks.sourceCards = await page.locator(".source-card").count();
  report.checks.marketRows = await page.locator(".source-market-table tbody tr").count();
  await page.locator(".source-preview").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "production-market.png"), fullPage: false });
  for (const [key, name] of [["jinse", "金色财经"], ["blockbeats", "区块律动 BlockBeats"]]) {
    await page.locator(".source-card").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("button", { name: "查看快讯", exact: true }).click();
    await page.locator(".news-item").first().waitFor({ timeout: 30000 });
    report.checks[key] = { visibleNews: await page.locator(".news-item").count(), transport: await page.locator(".source-read-line").innerText() };
    await page.getByLabel("币种代码", { exact: true }).fill("ETH");
    await page.waitForResponse((r) => r.url().includes("/content?") && r.url().includes("tokens=ETH") && r.status() === 200);
    await page.locator(".source-preview .loading").waitFor({ state: "detached" });
    report.checks[key].ethFilteredCount = await page.locator(".news-item").count();
    const cleared = page.waitForResponse((r) => r.url().includes("/content?") && !r.url().includes("tokens=ETH") && r.status() === 200);
    await page.getByLabel("币种代码", { exact: true }).fill("");
    await cleared;
    await page.locator(".source-preview .loading").waitFor({ state: "detached" });
    await page.locator(".news-item").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `production-${key}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".news-item").first().scrollIntoViewIfNeeded();
  report.checks.mobileNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: path.join(output, "production-mobile.png"), fullPage: false });
  report.passed = report.pageErrors.length === 0 && report.checks.sourceCards >= 3 && report.checks.marketRows > 0 && report.checks.jinse.visibleNews > 0 && report.checks.blockbeats.visibleNews > 0 && report.checks.mobileNoHorizontalOverflow;
} catch (error) {
  report.passed = false;
  report.error = error.message;
} finally {
  await browser.close();
  report.browserClosed = true;
}
await writeFile(path.join(output, "browser-verification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
