import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/settings?section=sources");
  await page.getByLabel("用户名", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-1234");
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "素材与新闻来源", exact: true }),
  ).toBeVisible();
});

test("source workspace shows actual market reads, searchable news, token aliases and built-in source defaults", async ({
  page,
}) => {
  await expect(page.locator(".source-card")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "涨幅榜 Top 5", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".source-market-table tbody tr")).toHaveCount(6);
  await page.getByLabel("搜索币种或交易对", { exact: true }).fill("AAA");
  await expect(page.locator(".source-market-table tbody tr")).toHaveCount(1);
  const jinse = page
    .locator(".source-card")
    .filter({
      has: page.getByRole("heading", { name: "金色财经", exact: true }),
    });
  await jinse.getByRole("button", { name: "查看快讯", exact: true }).click();
  await expect(page.locator(".news-item")).toHaveCount(2);
  await page.getByLabel("币种代码", { exact: true }).fill("ETH");
  await expect(page.locator(".news-item")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "以太坊开发进展", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("搜索标题或正文", { exact: true })
    .fill("不存在的测试关键词");
  await expect(
    page.getByText("来源已读取，但当前时间范围和筛选条件下没有匹配快讯。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("搜索标题或正文", { exact: true }).fill("");
  await expect(page.locator(".news-item")).toHaveCount(1);
  await page.getByRole("button", { name: "添加数据源", exact: true }).click();
  await page.getByLabel("来源类型", { exact: true }).selectOption("jinse");
  await expect(page.getByLabel("来源名称", { exact: true })).toHaveValue(
    "金色财经",
  );
  await expect(page.getByLabel("读取地址", { exact: true })).toHaveValue(
    "https://www.jinse2.com/lives",
  );
  await expect(
    page.getByLabel("允许域名（逗号分隔）", { exact: true }),
  ).toHaveValue(/api\.jinse2\.com/);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
});

test("bulk source refresh, publisher evidence and mobile layouts remain usable", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "读取全部已启用来源", exact: true })
    .click();
  await expect(page.locator(".source-batch-result")).toContainText("已读取");
  await expect(page.locator(".source-batch-result p")).toHaveCount(3);
  const blockbeats = page
    .locator(".source-card")
    .filter({
      has: page.getByRole("heading", {
        name: "区块律动 BlockBeats",
        exact: true,
      }),
    });
  await blockbeats
    .getByRole("button", { name: "查看快讯", exact: true })
    .click();
  await expect(page.locator(".news-item")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "查看读取来源", exact: true }),
  ).toHaveAttribute("href", /\/news\/123$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".news-item")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
