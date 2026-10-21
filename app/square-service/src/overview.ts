import { Database, Doc } from "./core.js";
import { resolveModel } from "./providers.js";

export async function loadOverview(db: Database) {
  const [accounts, schedules, jobs, runtime, beats, stats] = await Promise.all([
    db.list("accounts"),
    db.list("schedules", "(data->>'enabled')::boolean"),
    db.list("jobs", "TRUE", [], 6),
    db.need("runtime", "main"),
    db.list("heartbeats", "data->>'role'='worker'", [], 10),
    db.sql(`SELECT
      (SELECT count(*) FROM accounts WHERE data->>'status'<>'archived')::int AS accounts,
      (SELECT count(*) FROM schedules WHERE (data->>'enabled')::boolean)::int AS enabled,
      (SELECT count(*) FROM accounts WHERE data->>'blockReason' IS NOT NULL)::int AS blocked,
      (SELECT count(*) FROM jobs WHERE data->>'state'='submission_unknown')::int AS unknown,
      (SELECT count(*) FROM accounts a WHERE a.data->>'blockReason' IS NOT NULL OR EXISTS (SELECT 1 FROM jobs j WHERE j.data->>'accountId'=a.id AND j.data->>'state'='submission_unknown'))::int AS attention,
      (SELECT count(*) FROM posts WHERE data->>'publishStatus'='published' AND ((data->>'publishedAt')::timestamptz AT TIME ZONE 'Asia/Taipei')::date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date)::int AS "publishedToday",
      (SELECT count(*) FROM posts WHERE data->>'verificationStatus'='verified' AND (COALESCE(data->>'verifiedAt',data->>'publishedAt')::timestamptz AT TIME ZONE 'Asia/Taipei')::date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date)::int AS "verifiedToday",
      (SELECT count(*) FROM posts WHERE data->>'verificationStatus' IN ('pending','unavailable'))::int AS "pendingVerification",
      (SELECT count(*) FROM presets WHERE (data->>'enabled')::boolean AND data->>'publishedVersionId' IS NOT NULL)::int AS "publishedPresets",
      (SELECT count(*) FROM assets WHERE (data->>'enabled')::boolean)::int AS assets,
      (SELECT count(*) FROM models m JOIN connections c ON m.data->>'connectionId'=c.id WHERE (m.data->>'approved')::boolean AND m.data->>'type'='text' AND (c.data->>'enabled')::boolean)::int AS "textModels"`),
  ]);
  let defaultText: Doc;
  try {
    const selected = await resolveModel(db, "@default", "text");
    defaultText = {
      available: true,
      name: selected.model.name,
      externalId: selected.model.externalId,
    };
  } catch {
    defaultText = { available: false };
  }
  const counts = stats.rows[0];
  return {
    runtime,
    counts,
    setup: {
      defaultText,
      textModels: counts.textModels,
      publishedPresets: counts.publishedPresets,
      assets: counts.assets,
      accounts: counts.accounts,
    },
    upcoming: schedules
      .map((s) => ({
        ...s,
        account: accounts.find((a) => a.id === s.accountId),
      }))
      .sort((a: Doc, b: Doc) =>
        (a.nextDueAt || "z").localeCompare(b.nextDueAt || "z"),
      ),
    recentJobs: jobs,
    worker:
      beats.find(
        (b) => b.state === "running" && Date.now() - Date.parse(b.at) < 15000,
      ) || null,
  };
}
