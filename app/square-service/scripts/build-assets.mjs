import { mkdir, copyFile } from "node:fs/promises";
await mkdir(new URL("../dist/database/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../database/001.sql", import.meta.url),
  new URL("../dist/database/001.sql", import.meta.url),
);
