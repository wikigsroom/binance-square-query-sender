import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../square-dashboard/node_modules/@playwright/test/index.mjs";

const root = new URL("./", import.meta.url);
const output = new URL("../../docs/cors-put-fix/", root);
await mkdir(output, { recursive: true });
process.env.TEMP = fileURLToPath(new URL("./browser-temp/", root));
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const credentials = JSON.parse(await readFile(new URL(".private/bootstrap.json", root), "utf8"));
const api = "https://bn-api.sid.mom/api/v1";
const report = { checkedAt: new Date().toISOString(), url: "https://bn.sid.mom/accounts", preflights: [], browserWrites: [], pageErrors: [], requestErrors: [] };
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
  const signingIn = page.waitForResponse((response) => response.url() === `${api}/auth/login` && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  const csrf = (await (await signingIn).json()).data.csrf;
  await page.getByRole("heading", { name: "账号与计划", exact: true }).waitFor();
  const list = await page.request.get(`${api}/accounts?limit=100`);
  assert.equal(list.status(), 200);
  const accounts = (await list.json()).data;
  const account = accounts.find((a) => a.id === "acct_530ac324-094d-43fa-ae62-8eaa8d53b7f0") || accounts[0];
  const paths = [`/accounts/${account.id}/preset-bindings`, `/accounts/${account.id}/schedule`];
  for (const path of paths) {
    const before = await page.request.get(api + path);
    assert.equal(before.status(), 200);
    const original = (await before.json()).data;
    const preflight = await page.request.fetch(api + path, { method: "OPTIONS", headers: {
      Origin: "https://bn.sid.mom", "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type,x-csrf-token,idempotency-key",
    } });
    assert.equal(preflight.status(), 204);
    assert.ok(preflight.headers()["access-control-allow-methods"].includes("PUT"));
    report.preflights.push({ path, status: preflight.status(), allowedMethods: preflight.headers()["access-control-allow-methods"] });
    const actual = await page.evaluate(async ({ url, csrf }) => {
      const response = await fetch(url, { method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: -1, bindings: [] }),
      });
      const payload = await response.json();
      return { status: response.status, code: payload.error?.code };
    }, { url: api + path, csrf });
    assert.equal(actual.status, 409);
    const after = await page.request.get(api + path);
    assert.deepEqual((await after.json()).data, original);
    report.browserWrites.push({ path, ...actual, responseReadableAcrossOrigins: true, configurationUnchanged: true });
  }
  await page.locator(".account-table tbody tr").filter({ has: page.getByText(account.name, { exact: true }) })
    .getByRole("button", { name: "管理", exact: true }).click();
  await page.getByRole("tab", { name: "预设权重", exact: true }).click();
  await page.getByRole("button", { name: "保存绑定", exact: true }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL("production-bindings.png", output)) });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "关闭", exact: true }).first().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  report.passed = report.preflights.length === 2 && report.browserWrites.length === 2 && report.pageErrors.length === 0 && report.requestErrors.length === 0;
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
