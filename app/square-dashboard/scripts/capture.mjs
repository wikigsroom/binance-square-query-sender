import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const output = path.resolve("docs/screenshots");
await mkdir(output, { recursive: true });
process.env.TEMP = path.resolve("test-results/browser-temp");
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4300");
  await page.getByLabel("用户名", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-1234");
  await page.getByRole("button", { name: "登录管理台" }).click();
  await page.getByRole("heading", { name: "账号独立计划" }).waitFor();
  const shots = [];
  async function shot(name) {
    await page.locator(".loading").waitFor({ state: "detached" });
    const hasDialog = !!(await page.locator("dialog[open]").count());
    if (!hasDialog)
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((img) => img.decode().catch(() => {})),
      );
    });
    await page.locator(".toast").last().waitFor({
      state: "detached",
      timeout: 7000,
    });
    await page.screenshot({
      path: path.join(output, name),
      fullPage: !hasDialog,
      animations: "disabled",
    });
    shots.push(name);
  }
  await shot("overview.png");
  for (const [id, name, title] of [
    ["accounts", "accounts.png", "账号与计划"],
    ["presets", "presets.png", "内容预设"],
    ["media", "media.png", "图库与生图"],
    ["posts", "posts.png", "帖子中心"],
    ["jobs", "jobs.png", "任务与日志"],
    ["settings", "settings.png", "系统设置"],
  ]) {
    await page.getByRole("link", { name: title, exact: true }).click();
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.locator(".loading").waitFor({ state: "detached" });
    await page.waitForTimeout(200);
    await shot(name);
  }
  await page.getByRole("button", { name: "添加 AI 连接", exact: true }).click();
  await page.getByRole("button", { name: "OpenAI", exact: true }).click();
  await shot("ai-connection.png");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "检查并选模型", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "读取可用模型", exact: true }).click();
  await page.getByText("模型列表可读 · 2 个", { exact: true }).waitFor();
  await shot("ai-model-discovery.png");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "切换深色模式", exact: true }).click();
  await shot("settings-dark.png");
  await page.getByRole("link", { name: "运行总览", exact: true }).click();
  await shot("overview-dark.png");
  await page.getByRole("button", { name: "切换浅色模式", exact: true }).click();
  await page.getByRole("link", { name: "账号与计划", exact: true }).click();
  await page.getByRole("button", { name: "日常看盘 市场观察" }).click();
  await page.getByRole("tab", { name: "预设权重" }).click();
  await shot("account-weights.png");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("link", { name: "任务与日志", exact: true }).click();
  await page.locator("tbody tr .link").first().click();
  await page.getByRole("button", { name: "实际提示词", exact: true }).click();
  await shot("prompt-lineage.png");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("link", { name: "账号与计划", exact: true }).click();
  await page
    .getByRole("heading", { name: "账号与计划", exact: true })
    .waitFor();
  await shot("mobile-accounts.png");
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("link", { name: "系统设置", exact: true }).click();
  await shot("mobile-settings.png");
  await writeFile(
    path.join(output, "capture.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        url: "http://localhost:4300",
        environment:
          "Isolated development fixture, no real model or publication. Actual screenshots of running UI and API.",
        viewport: { desktop: [1440, 1000], mobile: [390, 844] },
        captureMode: "Full document at scroll origin; open dialogs use the viewport.",
        screenshots: shots,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Saved ${shots.length} actual UI screenshots to ${output}`);
} finally {
  await browser.close();
}
