// Run browser tests against owned, isolated native processes and always stop them.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";

const root = new URL("../../", import.meta.url);
const frontend = new URL("app/square-dashboard/", root);
const backend = new URL("app/square-service/", root);
const children = [];
const env = { ...process.env, APP_PROFILE: "fixture", SQUARE_PUBLISH_ENABLED: "false", E2E_BASE_URL: "http://localhost:4300" };
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && process.platform === "win32" && existsSync(chrome)) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = chrome;
async function requireFree(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error(`Port ${port} is occupied; stop that local workbench before this managed test run.`)));
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
function launch(args, cwd) {
  const child = spawn(process.execPath, args, { cwd: fileURLToPath(cwd), env, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });
  child.on("error", (error) => console.error(error.message));
  children.push(child);
  return child;
}
async function ready(url, child) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Workbench process exited before ${url} became ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if ([200, 401].includes(response.status)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Workbench did not become ready: ${url}`);
}
function stop() {
  for (const child of children.toReversed()) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stop(); process.exit(1); });
try {
  await requireFree(4300);
  await requireFree(4321);
  const service = launch(["node_modules/tsx/dist/cli.mjs", "scripts/workbench.ts"], backend);
  const dashboard = launch(["scripts/workbench.mjs"], frontend);
  await Promise.all([ready("http://127.0.0.1:4321/api/v1/health", service), ready("http://127.0.0.1:4300", dashboard)]);
  const test = launch(["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], frontend);
  process.exitCode = await new Promise((resolve) => test.once("exit", (code) => resolve(code ?? 1)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
}
