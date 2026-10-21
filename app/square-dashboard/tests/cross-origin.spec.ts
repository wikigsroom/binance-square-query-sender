import { test, expect } from "@playwright/test";

test("runtime API origin supports actual cross-origin login, reload and authenticated image requests", async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => {
      window.__SQUARE_CONFIG__ = { apiOrigin: "http://localhost:4321" };
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByLabel("用户名", { exact: true }).fill("owner");
    await page
      .getByLabel("密码", { exact: true })
      .fill("fixture-password-1234");
    const response = page.waitForResponse(
      (r) =>
        r.url() === "http://localhost:4321/api/v1/auth/login" &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "登录管理台", exact: true }).click();
    const login = await response;
    expect(login.status()).toBe(200);
    expect(login.headers()["access-control-allow-credentials"]).toBe("true");
    await expect(
      page.getByRole("heading", { name: "账号独立计划", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "账号独立计划", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "图库与生图", exact: true }).click();
    const img = page.locator(".media-card img").first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute(
      "src",
      /^http:\/\/localhost:4321\/api\/v1\/assets\//,
    );
    await expect
      .poll(() =>
        img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
      )
      .toBe(true);
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "登录管理台", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("account preset weights save over credentialed cross-origin PUT and survive reopening", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => {
      window.__SQUARE_CONFIG__ = { apiOrigin: "http://localhost:4321" };
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/accounts");
    await page.getByLabel("用户名", { exact: true }).fill("owner");
    await page.getByLabel("密码", { exact: true }).fill("fixture-password-1234");
    await page.getByRole("button", { name: "登录管理台", exact: true }).click();
    await page.getByRole("heading", { name: "账号与计划", exact: true }).waitFor();
    const account = page.locator(".account-table tbody tr")
      .filter({ has: page.getByText("日常看盘", { exact: true }) })
      .getByRole("button", { name: "管理", exact: true });
    await account.click();
    await page.getByRole("tab", { name: "预设权重", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const originalWeight = await dialog.getByLabel("权重1", { exact: true }).inputValue();
    await dialog.getByLabel("权重1", { exact: true }).fill("7.25");
    const saving = page.waitForResponse((response) =>
      response.url().startsWith("http://localhost:4321/api/v1/accounts/") &&
      response.url().endsWith("/preset-bindings") && response.request().method() === "PUT");
    await dialog.getByRole("button", { name: "保存绑定", exact: true }).click();
    const saved = await saving;
    expect(saved.status()).toBe(200);
    expect(saved.headers()["access-control-allow-origin"]).toBe("http://localhost:4300");
    expect(saved.headers()["access-control-allow-credentials"]).toBe("true");
    expect((await saved.json()).data.bindings[0].weight).toBe(7.25);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await account.click();
    await page.getByRole("tab", { name: "预设权重", exact: true }).click();
    await expect(dialog.getByLabel("权重1", { exact: true })).toHaveValue("7.25");
    await dialog.getByLabel("权重1", { exact: true }).fill(originalWeight);
    const restoring = page.waitForResponse((response) =>
      response.url().endsWith("/preset-bindings") && response.request().method() === "PUT");
    await dialog.getByRole("button", { name: "保存绑定", exact: true }).click();
    expect((await restoring).status()).toBe(200);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
