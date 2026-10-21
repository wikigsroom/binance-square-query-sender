import { Database, Doc, Fault, requireThat } from "./core.js";

// Filters and pagination execute in SQL, including unpublished current content versions.
export async function searchPosts(db: Database, q: Doc) {
  const params: any[] = [],
    conditions: string[] = [];
  const bind = (v: any) => {
    params.push(v);
    return `$${params.length}`;
  };
  const multi = (v: any) =>
    String(v)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (q.q)
    conditions.push(`strpos(data->>'text',${bind(String(q.q).trim())})>0`);
  for (const [field, key] of [
    ["accountId", "accountIds"],
    ["presetId", "presetId"],
    ["presetVersionId", "presetVersionId"],
    ["modelId", "modelId"],
    ["connectionId", "connectionId"],
    ["publishStatus", "publishStatus"],
    ["verificationStatus", "verificationStatus"],
  ])
    if (q[key])
      conditions.push(`data->>'${field}'=ANY(${bind(multi(q[key]))}::text[])`);
  if (q.tokens)
    conditions.push(
      `data->'tokens' ?| ${bind(multi(q.tokens).map((t) => t.replace(/^\$/, "").toUpperCase()))}::text[]`,
    );
  if (q.accountTags)
    conditions.push(
      `data->'accountTags' ?| ${bind(multi(q.accountTags))}::text[]`,
    );
  if (q.sourceId) {
    const key = bind(multi(q.sourceId));
    conditions.push(
      `(data->'sourceIds' ?| ${key}::text[] OR EXISTS(SELECT 1 FROM source_snapshots ss WHERE ss.data->>'jobId'=archive.data->>'jobId' AND ss.data->>'sourceId'=ANY(${key}::text[]) AND (ss.data->>'type'='market' OR archive.data->'sourceIds' ? ss.id)))`,
    );
  }
  if (q.remotePostId) {
    const key = bind(q.remotePostId);
    conditions.push(`(data->>'remoteId'=${key} OR data->>'url'=${key})`);
  }
  const field =
    q.dateField === "publishedAt"
      ? "(data->>'publishedAt')::timestamptz"
      : "created_at";
  for (const [key, operator] of [
    ["from", ">="],
    ["to", "<="],
  ])
    if (q[key]) {
      requireThat(
        Number.isFinite(Date.parse(q[key])),
        "INVALID_DATE",
        "日期过滤无效。",
        400,
      );
      conditions.push(`${field} ${operator} ${bind(q[key])}::timestamptz`);
    }
  if (q.cursor) {
    let c: Doc;
    try {
      c = JSON.parse(Buffer.from(q.cursor, "base64url").toString());
    } catch {
      throw new Fault("INVALID_CURSOR", "分页标识无效。", 400);
    }
    requireThat(
      c.id && Number.isFinite(Date.parse(c.createdAt)),
      "INVALID_CURSOR",
      "分页标识无效。",
      400,
    );
    conditions.push(
      `(created_at,id)<(${bind(c.createdAt)}::timestamptz,${bind(c.id)}::text)`,
    );
  }
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 30)) + 1;
  const result = await db.sql(
    `WITH archive AS (
    SELECT p.id,p.version,p.created_at,p.updated_at,p.data || jsonb_build_object('content',c.data,'text',c.data->'text','modelId',c.data->'modelId','connectionId',c.data->'connectionId','tokens',c.data->'tokens','sourceIds',c.data->'usedSourceIds','accountName',COALESCE(a.data->'name','"预览"'::jsonb),'accountTags',COALESCE(a.data->'tags','[]'::jsonb)) AS data
    FROM posts p JOIN content_versions c ON c.id=p.data->>'contentId' LEFT JOIN accounts a ON a.id=p.data->>'accountId'
    UNION ALL
    SELECT 'draft_'||j.id,j.version,j.created_at,j.updated_at,j.data || jsonb_build_object('jobId',j.id,'content',c.data,'text',c.data->'text','modelId',c.data->'modelId','connectionId',c.data->'connectionId','tokens',c.data->'tokens','sourceIds',c.data->'usedSourceIds','publishStatus',j.data->'state','verificationStatus','not_started','remoteId',NULL,'publishedAt',NULL,'accountName',COALESCE(a.data->'name','"预览"'::jsonb),'accountTags',COALESCE(a.data->'tags','[]'::jsonb)) AS data
    FROM jobs j JOIN content_versions c ON c.id=j.data->>'contentId' LEFT JOIN accounts a ON a.id=j.data->>'accountId' WHERE NOT EXISTS(SELECT 1 FROM posts p WHERE p.data->>'jobId'=j.id)
  ) SELECT * FROM archive WHERE ${conditions.join(" AND ") || "TRUE"} ORDER BY created_at DESC,id DESC LIMIT ${bind(limit)}`,
    params,
  );
  return result.rows.map((r: any) => ({
    ...r.data,
    id: r.id,
    version: r.version,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
