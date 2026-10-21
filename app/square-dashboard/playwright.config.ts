import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
process.env.TEMP = path.resolve("test-results/browser-temp");
process.env.TMP = process.env.TEMP;
mkdirSync(process.env.TEMP, { recursive: true });
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:4300",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
