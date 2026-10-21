import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
process.env.TEMP = path.resolve("test-results/browser-temp");
process.env.TMP = process.env.TEMP;
await mkdir(process.env.TEMP, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const errors = [],
  results = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4300");
  await page.getByLabel("用户名", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-1234");
  await page.getByRole("button", { name: "登录管理台" }).click();
  await page.getByRole("heading", { name: "账号独立计划" }).waitFor();
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => localStorage.setItem("square-theme", theme),
        theme,
      );
      for (const route of [
        "overview",
        "accounts",
        "presets",
        "media",
        "posts",
        "jobs",
        "settings",
      ]) {
        await page.goto(`http://localhost:4300/${route}`);
        await page.locator("main h1").waitFor();
        await page.locator(".loading").waitFor({ state: "detached" });
        const inspected = await page.evaluate(() => {
          const rgba = (v) => (v.match(/[\d.]+/g) || []).map(Number);
          const luma = (c) =>
            c
              .slice(0, 3)
              .map((x) => x / 255)
              .map((x) =>
                x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
              )
              .reduce((n, x, i) => n + x * [0.2126, 0.7152, 0.0722][i], 0);
          const background = (el) => {
            let layers = [],
              current = el;
            while (current) {
              const style = getComputedStyle(current);
              if (style.backgroundImage !== "none") return null;
              const bg = rgba(style.backgroundColor);
              layers.push(bg);
              if ((bg[3] ?? 1) === 1) break;
              current = current.parentElement;
            }
            return layers.reverse().reduce(
              (p, c) => {
                const a = c[3] ?? 1;
                return c.slice(0, 3).map((v, i) => v * a + p[i] * (1 - a));
              },
              [255, 255, 255],
            );
          };
          const contrast = [];
          for (const el of document.querySelectorAll("body *")) {
            if (
              !el.getClientRects().length ||
              el.closest(":disabled, [inert], svg")
            )
              continue;
            const text = [...el.childNodes]
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent.trim())
              .join("");
            if (!text || text.length < 2) continue;
            const style = getComputedStyle(el);
            if (style.visibility !== "visible" || +style.opacity < 1) continue;
            const fg = rgba(style.color),
              bg = background(el);
            if (!bg || fg[3] === 0) continue;
            const [a, b] = [luma(fg), luma(bg)].sort((a, b) => b - a),
              ratio = (a + 0.05) / (b + 0.05);
            const large =
              parseFloat(style.fontSize) >= 24 ||
              (parseFloat(style.fontSize) >= 18.66 && +style.fontWeight >= 700);
            if (ratio < (large ? 3 : 4.5))
              contrast.push({
                text: text.slice(0, 60),
                className: el.className,
                ratio: +ratio.toFixed(2),
                foreground: style.color,
                background: bg,
              });
          }
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            heading: document.querySelector("main h1")?.textContent,
            contrast,
          };
        });
        results.push({ width, theme, route, ...inspected });
      }
    }
  }
  await mkdir("docs/checks", { recursive: true });
  await writeFile(
    "docs/checks/ui-audit.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        environment:
          "Native Chromium with isolated loopback API, no real AI or publication.",
        pageErrors: errors,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      pages: results.length,
      pageErrors: errors,
      overflow: results
        .filter((r) => r.overflow)
        .map((r) => [r.width, r.theme, r.route]),
      contrastIssues: results.reduce((n, r) => n + r.contrast.length, 0),
    }),
  );
} finally {
  await browser.close();
}
