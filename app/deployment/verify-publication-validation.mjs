import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../square-dashboard/node_modules/@playwright/test/index.mjs";

const root = new URL("./", import.meta.url);
const output = new URL("../../docs/publishing-validation/", root);
await mkdir(output, { recursive: true });
process.env.TEMP = fileURLToPath(new URL("browser-temp/", root));
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const credentials = JSON.parse(await readFile(new URL(".private/bootstrap.json", root), "utf8"));
const jobId = "job_376da861-1635-452f-ac2a-074eea5addae";
const publishFirst = process.argv.includes("--publish-first");
const api = "https://bn-api.sid.mom/api/v1";
const report = { checkedAt: new Date().toISOString(), jobId, pageErrors: [], requestErrors: [] };
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(api) && !request.failure()?.errorText.includes("ERR_ABORTED")) report.requestErrors.push({ url: request.url(), error: request.failure()?.errorText });
  });
  await page.goto(publishFirst ? "https://bn.sid.mom/settings?section=runtime" : `https://bn.sid.mom/jobs?job=${jobId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("用户名", { exact: true }).fill(credentials.adminUsername);
  await page.getByLabel("密码", { exact: true }).fill(credentials.adminPassword);
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  if (publishFirst)
    await page.getByRole("heading", { name: "运行参数", exact: true }).waitFor();
  else
    await page.getByRole("dialog").getByText(jobId, { exact: true }).waitFor();
  const response = await page.request.get(`${api}/publication-jobs/${jobId}`);
  assert.equal(response.status(), 200);
  const job = (await response.json()).data;
  assert.ok(job.validation);
  assert.ok(job.validationHistory.length >= 3);
  report.validationId = job.validation.id;
  report.validationRounds = job.validationHistory.length;
  report.errorCodes = job.validation.errors.map((error) => error.code);
  if (publishFirst) {
    await page.getByRole("heading", { name: "运行参数", exact: true }).waitFor();
    assert.equal(await page.getByLabel("内容校验模式", { exact: true }).inputValue(), "publish_first");
    const runtimeResponse = await page.request.get(`${api}/runtime`);
    assert.equal(runtimeResponse.status(), 200);
    const runtime = (await runtimeResponse.json()).data;
    assert.equal(runtime.contentValidationMode, "publish_first");
    assert.equal(runtime.paused, false);
    assert.equal(runtime.publishTransportEnabled, true);
    report.contentValidationMode = runtime.contentValidationMode;
    report.globallyPaused = runtime.paused;
    report.publishTransportEnabled = runtime.publishTransportEnabled;
    await page.screenshot({ path: fileURLToPath(new URL("publish-first-settings.png", output)), fullPage: true });
  } else {
    const dialog = page.getByRole("dialog");
    await dialog.getByText(jobId, { exact: true }).waitFor();
    await dialog.getByRole("alert").getByText("TOKEN_TAGS", { exact: true }).waitFor();
    assert.match(await dialog.getByRole("alert").innerText(), /应有：\$BTC、\$ETH/);
    assert.equal(job.validation.passed, false);
    assert.equal(job.validation.contentId, job.contentId);
    assert.equal(job.attempts.length, 0);
    report.visibleRequiredTags = true;
    await page.screenshot({ path: fileURLToPath(new URL("failed-validation-details.png", output)), fullPage: true });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  report.passed = report.pageErrors.length === 0 && report.requestErrors.length === 0;
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
