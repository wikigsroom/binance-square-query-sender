import crypto from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export type Doc = Record<string, any>;
export type Row = Doc & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const normalize = (s: string) => s.replace(/\r\n?/g, "\n");
export const hash = (s: string | Buffer) =>
  crypto.createHash("sha256").update(s).digest("hex");
export const chars = (s: string) => Array.from(s).length;
export const random = () => crypto.randomInt(0, 0x100000000) / 0x100000000;

export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    public details: Doc = {},
    public retryable = false,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: any,
  code: string,
  message: string,
  status = 422,
  details: Doc = {},
): asserts condition {
  if (!condition) throw new Fault(code, message, status, details);
}
export function redact(value: any, secrets: string[] = []): any {
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(apiKey|authorization|password|cookie|secret|ciphertext|box|access_token)$/i.test(
          k,
        )
          ? "[redacted]"
          : redact(v, secrets),
      ]),
    );
  if (typeof value !== "string") return value;
  let output = value
    .replace(/\bsk-[a-zA-Z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:token|key|signature|credential)=[^&\s]*)/gi,
      "[redacted-query]",
    );
  for (const secret of secrets.filter((s) => s.length >= 4))
    output = output.split(secret).join("[redacted]");
  return output;
}
export function errorInfo(e: any): Doc {
  return redact({
    code: e.code || "INTERNAL_ERROR",
    message: e.message || String(e),
    details: e.details || {},
    retryable: !!e.retryable,
  });
}

export class Vault {
  private key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, "base64");
    requireThat(
      this.key.length === 32,
      "ENCRYPTION_KEY_REQUIRED",
      "ENCRYPTION_KEY 必须是32字节的 base64 编码。",
      500,
    );
  }
  seal(text: string) {
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  open(box: string) {
    const b = Buffer.from(box, "base64"),
      decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.key,
        b.subarray(0, 12),
      );
    decipher.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([
      decipher.update(b.subarray(28)),
      decipher.final(),
    ]).toString();
  }
  fingerprint(text: string) {
    return crypto.createHmac("sha256", this.key).update(text).digest("hex");
  }
}
const scrypt = promisify(crypto.scrypt);
export async function passwordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function passwordMatches(password: string, saved: string) {
  const [salt, key] = saved.split(":");
  if (!salt || !key) return false;
  const result = (await scrypt(password, salt, 64)) as Buffer,
    target = Buffer.from(key, "hex");
  return (
    result.length === target.length && crypto.timingSafeEqual(result, target)
  );
}

export const tables = [
  "admin_users",
  "sessions",
  "accounts",
  "credentials",
  "presets",
  "preset_versions",
  "bindings",
  "schedules",
  "jobs",
  "generation_runs",
  "content_versions",
  "source_snapshots",
  "source_reads",
  "assets",
  "image_jobs",
  "validation_runs",
  "publish_attempts",
  "posts",
  "verification_runs",
  "events",
  "audit_events",
  "connections",
  "models",
  "sources",
  "runtime",
  "heartbeats",
  "idempotency",
] as const;
export type Table = (typeof tables)[number];
type Query = { query: (sql: string, params?: any[]) => Promise<any> };
function row(r: any): Row {
  return {
    ...r.data,
    id: r.id,
    version: r.version,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
export class Store {
  constructor(public client: Query) {}
  async sql(sql: string, params: any[] = []) {
    return this.client.query(sql, params);
  }
  async get(table: Table, key: string, lock = false): Promise<Row | null> {
    const q = await this.sql(
      `SELECT * FROM ${table} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [key],
    );
    return q.rows[0] ? row(q.rows[0]) : null;
  }
  async need(table: Table, key: string, lock = false) {
    const r = await this.get(table, key, lock);
    requireThat(r, "NOT_FOUND", `${table} 记录不存在。`, 404);
    return r;
  }
  async list(
    table: Table,
    where = "TRUE",
    params: any[] = [],
    limit = 1000,
  ): Promise<Row[]> {
    const q = await this.sql(
      `SELECT * FROM ${table} WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${params.length + 1}`,
      [...params, limit],
    );
    return q.rows.map(row);
  }
  async insert(table: Table, data: Doc, key = id(table.replace(/s$/, ""))) {
    const q = await this.sql(
      `INSERT INTO ${table}(id,data) VALUES($1,$2::jsonb) RETURNING *`,
      [key, JSON.stringify(data)],
    );
    return row(q.rows[0]);
  }
  async update(table: Table, key: string, changes: Doc, expected?: number) {
    const q = await this.sql(
      `UPDATE ${table} SET data=data || $2::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=$1${expected === undefined ? "" : " AND version=$3"} RETURNING *`,
      expected === undefined
        ? [key, JSON.stringify(changes)]
        : [key, JSON.stringify(changes), expected],
    );
    requireThat(
      q.rows[0],
      "CONFIG_VERSION_CONFLICT",
      "配置已改变，请刷新后重试。",
      409,
    );
    return row(q.rows[0]);
  }
  async event(jobId: string, type: string, data: Doc = {}) {
    return this.insert("events", redact({ jobId, type, ...data }));
  }
  async audit(type: string, resourceId: string, details: Doc = {}) {
    return this.insert("audit_events", redact({ type, resourceId, details }));
  }
}
export class Database extends Store {
  embedded: PGlite | null = null;
  pool: pg.Pool | null = null;
  private tail: Promise<any> = Promise.resolve();
  static async connect(url: string | undefined, directory: string) {
    const db = new Database({
      query: async () => {
        throw new Error("not connected");
      },
    });
    if (url) {
      db.pool = new pg.Pool({ connectionString: url, max: 12 });
      db.client = db.pool;
    } else {
      if (directory !== ":memory:") await mkdir(directory, { recursive: true });
      db.embedded = new PGlite(
        directory === ":memory:" ? undefined : directory,
      );
      await db.embedded.waitReady;
      db.client = db.embedded;
    }
    const migration = await readFile(
      new URL("../database/001.sql", import.meta.url),
      "utf8",
    );
    if (db.embedded) await db.embedded.exec(migration);
    else await db.pool!.query(migration);
    return db;
  }
  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.embedded) {
      const run = this.tail.then(() =>
        this.embedded!.transaction((t) => fn(new Store(t))),
      );
      this.tail = run.catch(() => {});
      return run;
    }
    const c = await this.pool!.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(new Store(c));
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async close() {
    if (this.embedded) await this.embedded.close();
    if (this.pool) await this.pool.end();
  }
}
export function configFromEnv() {
  const dataDir = path.resolve(process.env.DATA_DIR || "./data");
  return {
    dataDir,
    databaseUrl: process.env.DATABASE_URL || "",
    encryptionKey: process.env.ENCRYPTION_KEY || "",
    origin: process.env.PUBLIC_ORIGIN || "http://localhost:4300",
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4310),
    secureCookie: process.env.COOKIE_SECURE === "true",
    runWorker: process.env.RUN_WORKER !== "false",
    publishEnabled: process.env.SQUARE_PUBLISH_ENABLED === "true",
    profile: process.env.APP_PROFILE || "normal",
    proxy: process.env.OUTBOUND_PROXY_URL || "",
    importRoots: (process.env.IMPORT_ROOTS || "")
      .split(";")
      .filter(Boolean)
      .map((p) => path.resolve(p)),
  };
}
export type Config = ReturnType<typeof configFromEnv>;
