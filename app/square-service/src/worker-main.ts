import { configFromEnv, requireThat } from "./core.js";
import { buildServer } from "./server.js";
const config = configFromEnv();
requireThat(
  config.databaseUrl,
  "POSTGRESQL_REQUIRED",
  "独立 Worker 需要 PostgreSQL；PGlite 仅支持 API 内的开发 Worker。",
  500,
);
const { app, pipeline } = await buildServer(config);
await pipeline.start();
console.log("Square worker started.");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
