import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

process.env.TEMP = path.resolve("test-results/browser-temp");
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const output = path.resolve("../../docs/account-import-upgrade");
await mkdir(output, { recursive: true });
const credentials = JSON.parse(await readFile("../deployment/.private/bootstrap.json", "utf8"));
const api = "https://bn-api.sid.mom/api/v1";
const report = {
  checkedAt: new Date().toISOString(),
  url: "https://bn.sid.mom/accounts",
  pageErrors: [],
  requestErrors: [],
  checks: {},
};
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => report.pageErrors.push(e.message));
  page.on("requestfailed", (r) => report.requestErrors.push({ url: r.url(), error: r.failure()?.errorText }));
  await page.goto(report.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("用户名", { exact: true }).fill(credentials.adminUsername);
  await page.getByLabel("密码", { exact: true }).fill(credentials.adminPassword);
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  await page.getByRole("heading", { name: "账号与计划", exact: true }).waitFor();
  const before = await page.request.get(`${api}/accounts?limit=100`);
  assert.equal(before.status(), 200);
  const beforeIds = (await before.json()).data.map((a) => a.id).sort();
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("API Key 列表", { exact: true });
  const button = dialog.getByRole("button", { name: "开始导入", exact: true });
  report.checks.onlyOneKeyField = await dialog.getByRole("textbox").count() === 1;
  report.checks.emptySubmitDisabled = await button.isDisabled();
  assert.ok(report.checks.onlyOneKeyField && report.checks.emptySubmitDisabled);
  await page.screenshot({ path: path.join(output, "production-import.png") });
  // Deliberately invalid input exercises the deployed API without creating a test account.
  await input.fill("short");
  const response = page.waitForResponse((r) => r.url().endsWith("/accounts/import") && r.request().method() === "POST");
  await button.click();
  const imported = await response;
  assert.equal(imported.status(), 200);
  const result = (await imported.json()).data;
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "rejected");
  assert.equal(result[0].code, "INVALID_CREDENTIAL");
  assert.deepEqual(imported.request().postDataJSON(), { accounts: [{ apiKey: "short" }] });
  await dialog.getByRole("region", { name: "导入结果", exact: true }).waitFor();
  report.checks.keyOnlyRequestAccepted = true;
  report.checks.invalidKeyRejectedWithoutNameRequirement = true;
  report.checks.keyInputCleared = await input.inputValue() === "";
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  report.checks.mobileNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: path.join(output, "production-import-mobile.png") });
  const after = await page.request.get(`${api}/accounts?limit=100`);
  assert.equal(after.status(), 200);
  assert.deepEqual((await after.json()).data.map((a) => a.id).sort(), beforeIds);
  report.checks.noProductionAccountsCreated = true;
  report.passed = report.pageErrors.length === 0 && !report.requestErrors.some((e) => e.url.startsWith(api)) && Object.values(report.checks).every(Boolean);
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
