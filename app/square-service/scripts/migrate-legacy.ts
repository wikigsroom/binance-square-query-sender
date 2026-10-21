import path from "node:path";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import {
  Database,
  Vault,
  configFromEnv,
  hash,
  now,
  id,
  requireThat,
  errorInfo,
} from "../src/core.js";
import { Control } from "../src/control.js";
import { Http } from "../src/http.js";
import { AI } from "../src/ai.js";
import { Media } from "../src/media.js";

// Offline import only: this module never starts a worker or contacts Square/model services.
const args = process.argv.slice(2),
  sourceFlag = args.indexOf("--source");
requireThat(
  sourceFlag >= 0 && args[sourceFlag + 1],
  "SOURCE_REQUIRED",
  "用法：npm run migrate:legacy -- --source <旧项目目录> [--apply]",
);
const root = path.resolve(args[sourceFlag + 1]),
  apply = args.includes("--apply"),
  config = configFromEnv();
const report: any = {
  mode: apply ? "apply" : "dry_run",
  at: now(),
  sourceRoot: root,
  accounts: [],
  assets: [],
  history: [],
  notes: [
    "迁入账号默认暂停。旧内容标记 legacy_unverified，不能作为 AI 成稿证据重发。",
  ],
};
let db: Database | undefined, http: Http | undefined;
try {
  const keys = await readFile(path.join(root, "keys.txt"), "utf8").catch(
      () => "",
    ),
    unique = [
      ...new Set(
        keys
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
  let oldAccounts: any[] = [];
  try {
    const parsed = JSON.parse(
      await readFile(path.join(root, "accounts.json"), "utf8"),
    );
    oldAccounts = Array.isArray(parsed) ? parsed : parsed.accounts || [];
  } catch {}
  for (const old of oldAccounts)
    if (old.apiKey && !unique.includes(old.apiKey)) unique.push(old.apiKey);
  const imageRoot = path.join(root, "imagegen"),
    images = (await readdir(imageRoot).catch(() => [])).filter((n) =>
      /\.(png|jpe?g|webp|gif)$/i.test(n),
    );
  const runRoot = path.join(root, "runs"),
    states = (await readdir(runRoot).catch(() => [])).filter((n) =>
      n.endsWith(".state.json"),
    );
  let control: Control | undefined, media: Media | undefined;
  if (apply) {
    db = await Database.connect(
      config.databaseUrl,
      path.join(config.dataDir, "pgdata"),
    );
    control = new Control(db, new Vault(config.encryptionKey));
    await control.bootstrap();
    http = new Http();
    media = new Media(
      db,
      new AI(db, new Vault(config.encryptionKey), http),
      config,
    );
  }
  const mapping = new Map<string, string>();
  for (let i = 0; i < unique.length; i++) {
    const key = unique[i],
      old = oldAccounts.find((a) => a.apiKey === key),
      name = old?.name || old?.label || `迁入账号 ${i + 1}`;
    try {
      let account;
      if (apply) {
        const existing = (
          await db!.list(
            "credentials",
            "data->>'kind'='square' AND data->>'fingerprint'=$1",
            [control!.vault.fingerprint(key)],
          )
        )[0];
        account = existing
          ? await db!.need("accounts", existing.ownerId)
          : await control!.createAccount({
              name,
              apiKey: key,
              uid: old?.uid || "",
              tags: ["legacy-import"],
            });
        mapping.set(old?.id || String(i), account.id);
      }
      report.accounts.push({
        index: i + 1,
        name,
        mask: `•••• ${key.slice(-4)}`,
        status: apply ? "mapped_paused" : "would_import",
        accountId: account?.id,
      });
    } catch (e) {
      report.accounts.push({
        index: i + 1,
        status: "rejected",
        error: errorInfo(e),
      });
    }
  }
  for (const name of images) {
    try {
      if (!apply) {
        report.assets.push({ name, status: "would_import" });
        continue;
      }
      const asset = await media!.ingest(
        await readFile(path.join(imageRoot, name)),
        { name, collection: "legacy-import" },
        { type: "library", importBatch: report.at },
      );
      report.assets.push({ name, status: "imported", assetId: asset.id });
    } catch (e) {
      report.assets.push({ name, status: "rejected", error: errorInfo(e) });
    }
  }
  for (const name of states) {
    try {
      const old = JSON.parse(await readFile(path.join(runRoot, name), "utf8"));
      if (!old.text) continue;
      const fingerprint = hash(`${name}:${old.postId || ""}:${old.text}`);
      if (!apply) {
        report.history.push({ file: name, status: "would_import_unverified" });
        continue;
      }
      const oldJob = (
        await db!.list("jobs", "data->>'legacyFingerprint'=$1", [fingerprint])
      )[0];
      if (oldJob) {
        report.history.push({
          file: name,
          status: "already_imported",
          jobId: oldJob.id,
        });
        continue;
      }
      const job = await db!.insert("jobs", {
        kind: "imported",
        state: "legacy_unverified",
        stage: "legacy_unverified",
        legacyFingerprint: fingerprint,
        accountId: mapping.get(old.accountId) || null,
        presetId: null,
        presetVersionId: null,
        legacyOrigin: name,
      });
      const content = await db!.insert("content_versions", {
        jobId: job.id,
        generationRunId: null,
        text: old.text,
        contentHash: hash(old.text),
        tokens: [...String(old.text).matchAll(/\$([A-Z0-9]+)/g)].map(
          (m) => m[1],
        ),
        characterCount: Array.from(old.text).length,
        legacyUnverified: true,
        sourceIds: [],
        usedSourceIds: [],
      });
      await db!.update("jobs", job.id, { contentId: content.id });
      await db!.insert("posts", {
        jobId: job.id,
        accountId: job.accountId,
        contentId: content.id,
        text: old.text,
        tokens: content.tokens,
        publishStatus: "legacy_unverified",
        verificationStatus: "not_started",
        remoteId: old.postId ? String(old.postId) : null,
        url: old.url || old.postUrl || null,
        publishedAt: old.publishedAt || null,
        legacyUnverified: true,
      });
      report.history.push({
        file: name,
        status: "imported_unverified",
        jobId: job.id,
      });
    } catch (e) {
      report.history.push({
        file: name,
        status: "rejected",
        error: errorInfo(e),
      });
    }
  }
  const reportDir = path.join(config.dataDir, "migration-reports");
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        accounts: report.accounts.length,
        images: report.assets.length,
        history: report.history.length,
        reportPath,
      },
      null,
      2,
    ),
  );
} finally {
  await http?.close();
  await db?.close();
}
