import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../square-dashboard/node_modules/@playwright/test/index.mjs";

const directory = new URL("./", import.meta.url);
const output = new URL("../../docs/auto-publishing/", directory);
await mkdir(output, { recursive: true });
process.env.TEMP = fileURLToPath(new URL("./browser-temp/", directory));
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const credentials = JSON.parse(await readFile(new URL(".private/bootstrap.json", directory), "utf8"));
const operation = JSON.parse(await readFile(new URL("enabled.json", output), "utf8"));
const before = JSON.parse(await readFile(new URL("before.json", output), "utf8"));
const sample = before.accounts.find((a) => a.id === operation.sampleAccountId);
const bindings = (detail) => detail.bindings.bindings.map(({ presetId, weight, enabled }) => ({ presetId, weight, enabled }));
const api = "https://bn-api.sid.mom/api/v1";
const report = { url: "https://bn.sid.mom/accounts", checkedAt: new Date().toISOString(), accounts: [], pageErrors: [], requestErrors: [] };
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(api) && !request.failure()?.errorText.includes("ERR_ABORTED"))
      report.requestErrors.push({ url: request.url(), error: request.failure()?.errorText });
  });
  await page.goto(report.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("用户名", { exact: true }).fill(credentials.adminUsername);
  await page.getByLabel("密码", { exact: true }).fill(credentials.adminPassword);
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  await page.getByRole("heading", { name: "账号与计划", exact: true }).waitFor();
  await page.locator(".account-table tbody tr").first().waitFor();
  const read = async (route) => {
    const response = await page.request.get(api + route);
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const runtime = await read("/runtime");
  const health = await read("/health");
  assert.equal(runtime.paused, false);
  assert.equal(health.publishTransportEnabled, true);
  assert.equal(health.worker.state, "running");
  report.globallyPaused = false;
  report.publishTransportEnabled = true;
  report.workerState = health.worker.state;
  assert.equal(await page.locator(".account-table tbody tr").count(), operation.accountCount);
  for (const entry of operation.accounts) {
    const account = await read("/accounts/" + entry.id);
    assert.deepEqual(bindings(account), bindings(sample));
    assert.equal(account.schedule.enabled, true);
    assert.equal(account.schedule.minIntervalSeconds, operation.minIntervalSeconds);
    assert.equal(account.schedule.maxIntervalSeconds, operation.maxIntervalSeconds);
    assert.equal(account.status, "active");
    assert.equal(account.blockReason, null);
    const row = page.locator(".account-table tbody tr").filter({ has: page.getByText(account.name, { exact: true }) });
    assert.equal(await row.getByText("已启用", { exact: true }).count(), 1);
    report.accounts.push({ id: entry.id, name: entry.name, presetCount: account.bindings.bindings.length,
      scheduleEnabled: true, nextDueAt: account.schedule.nextDueAt, blockReason: null });
  }
  assert.equal(await page.getByRole("button", { name: "暂停发布", exact: true }).count(), 1);
  await page.screenshot({ path: fileURLToPath(new URL("production-enabled.png", output)), fullPage: true });
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
