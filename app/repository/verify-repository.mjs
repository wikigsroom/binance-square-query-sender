// Inspect the Git index without printing any detected credential value.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const records = execFileSync("git", ["ls-files", "--stage", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
assert.ok(records.length, "Stage the repository files before verification.");
const files = records.map((record) => record.slice(record.indexOf("\t") + 1));
const tracked = new Set(files);
const findings = [];
const privateValues = [];
function collect(value, name = "") {
  if (Array.isArray(value)) return value.forEach((v) => collect(v, name));
  if (value && typeof value === "object") return Object.entries(value).forEach(([k, v]) => collect(v, k));
  if (typeof value === "string" && value.length >= 8 && /password|api.?key|secret|token|encryption/i.test(name) && !/REPLACE|EXAMPLE|PLACEHOLDER/.test(value)) privateValues.push(value);
}
for (const name of ["app/deployment/.private/bootstrap.json", "app/deployment/.private/ssh.json", "accounts.json", "settings.json"]) {
  try { collect(JSON.parse(readFileSync(path.join(root, name), "utf8").replace(/^\uFEFF/, ""))); } catch {}
}
try { privateValues.push(...readFileSync(path.join(root, "keys.txt"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length >= 16)); } catch {}
for (const record of records) if (record.startsWith("160000 ")) findings.push({ file: record.slice(record.indexOf("\t") + 1), reason: "nested Git link instead of source" });
const forbidden = /(^|\/)(node_modules|\.private|\.git|browser-temp|test-results|playwright-report|batches|runs|snapshots|state|data)(\/|$)|(^|\/)\.env($|\.(?!example$))|^(keys\.txt|accounts\.json|settings\.json|posts\.json)$|\.(?:pem|key|p12|bundle|zip|tgz|tar\.gz)$/i;
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{28,}\b/,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{28,}\b/,
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/,
];
let checkedLinks = 0, bytes = 0;
for (const name of files) {
  if (forbidden.test(name)) findings.push({ file: name, reason: "private or generated runtime path" });
  const full = path.join(root, name);
  if (!existsSync(full)) { findings.push({ file: name, reason: "staged path missing from working tree" }); continue; }
  const size = statSync(full).size;
  bytes += size;
  if (size > 20 * 1024 * 1024) findings.push({ file: name, reason: "unexpectedly large repository artifact" });
  const buffer = readFileSync(full);
  if (buffer.subarray(0, 8192).includes(0)) continue;
  const body = buffer.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(body)) || privateValues.some((value) => body.includes(value))) findings.push({ file: name, reason: "possible credential; value withheld" });
  if (!name.endsWith(".md")) continue;
  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target) || target.includes("${")) continue;
    target = decodeURIComponent(target.split("#")[0].split("?")[0]);
    if (!target) continue;
    checkedLinks++;
    const resolved = path.resolve(path.dirname(full), target), relative = path.relative(root, resolved).replaceAll("\\", "/");
    if (!tracked.has(relative) && !files.some((file) => file.startsWith(relative + "/"))) findings.push({ file: name, reason: "untracked or broken documentation link", target });
  }
}
for (const required of ["README.md", "README.en.md", "AGENTS.md", "docs/product/README.md", "docs/product/capture-manifest.json", "app/square-service/src/main.ts", "app/square-dashboard/src/main.tsx"]) if (!tracked.has(required)) findings.push({ file: required, reason: "required repository file absent" });
try {
  const capture = JSON.parse(readFileSync(path.join(root, "docs/product/capture-manifest.json"), "utf8"));
  if (!capture.passed || !capture.browserClosed || !capture.readOnly || capture.screenshots.length < 15) findings.push({ file: "docs/product/capture-manifest.json", reason: "incomplete production capture" });
  for (const shot of capture.screenshots) if (!tracked.has("docs/product/screenshots/" + shot.file)) findings.push({ file: shot.file, reason: "capture image absent from repository" });
} catch { findings.push({ file: "docs/product/capture-manifest.json", reason: "capture manifest unreadable" }); }
console.log(JSON.stringify({ passed: findings.length === 0, trackedFiles: files.length, totalBytes: bytes, documentationLinks: checkedLinks, findings }, null, 2));
if (findings.length) process.exitCode = 1;
