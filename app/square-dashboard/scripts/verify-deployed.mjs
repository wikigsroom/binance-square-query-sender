import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
process.env.TEMP = path.resolve("test-results/browser-temp");
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const report = { url: "https://bn.sid.mom", pageErrors: [], apiErrors: [], apiOrigin: "", frontendLoaded: false };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => report.pageErrors.push(e.message));
  page.on("requestfailed", (r) => {
    if (r.url().startsWith("https://bn-api.sid.mom"))
      report.apiErrors.push({ url: r.url(), error: r.failure()?.errorText });
  });
  const response = await page.goto(report.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  report.status = response.status();
  await page.locator("#root > *").first().waitFor({ timeout: 15000 });
  await page.locator(".loading").waitFor({ state: "detached", timeout: 20000 });
  report.apiOrigin = await page.evaluate(() => window.__SQUARE_CONFIG__?.apiOrigin);
  report.frontendLoaded = await page.locator("#root").innerText().then((t) => t.length > 20);
  report.title = await page.title();
  report.apiProxyPending = report.apiErrors.length > 0;
  report.visibleStatus = await page.locator("#root").innerText();
  await page.screenshot({ path: "../../docs/deployment/frontend-before-api-proxy.png", fullPage: true });
} catch (e) {
  report.error = e.message;
} finally {
  await browser.close();
}
await writeFile("../../docs/deployment/browser-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
