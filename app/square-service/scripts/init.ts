import {
  Database,
  Vault,
  configFromEnv,
  passwordHash,
  requireThat,
} from "../src/core.js";
import { Control } from "../src/control.js";
import path from "node:path";
const config = configFromEnv(),
  password = process.env.ADMIN_PASSWORD || "";
requireThat(
  password.length >= 12,
  "ADMIN_PASSWORD_REQUIRED",
  "请通过 ADMIN_PASSWORD 提供至少12字符密码。",
  500,
);
const db = await Database.connect(
  config.databaseUrl,
  path.join(config.dataDir, "pgdata"),
);
try {
  await new Control(db, new Vault(config.encryptionKey)).bootstrap();
  const existing = await db.list("admin_users");
  requireThat(
    !existing.length,
    "ADMIN_ALREADY_EXISTS",
    "管理员已存在，不覆盖密码。",
    409,
  );
  await db.insert("admin_users", {
    username: process.env.ADMIN_USERNAME || "owner",
    passwordHash: await passwordHash(password),
  });
  console.log("Administrator initialized. Schedules remain paused.");
} finally {
  await db.close();
}
