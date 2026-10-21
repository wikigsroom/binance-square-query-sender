import { configFromEnv } from "./core.js";
import { buildServer } from "./server.js";
const config = configFromEnv();
const { app, pipeline } = await buildServer(config);
await app.listen({ host: config.host, port: config.port });
console.log(
  `Square API listening on ${config.host}:${config.port}. Publishing transport: ${config.publishEnabled ? "enabled" : "disabled"}.`,
);
if (config.runWorker) await pipeline.start();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
