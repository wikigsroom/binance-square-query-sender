import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-1234");
  await page.getByRole("button", { name: "登录管理台" }).click();
  await expect(
    page.getByRole("heading", { name: "账号独立计划" }),
  ).toBeVisible();
});
test("navigation, independent schedules and structured account editing", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const accountName = "浏览器流程测试-" + suffix;
  await page.getByRole("link", { name: "账号与计划", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "账号与计划", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "日常看盘 市场观察" }).click();
  await expect(page.getByText("抽样起点", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "预设权重" }).click();
  await expect(page.getByText("保存绑定", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await page.getByLabel("账号名称", { exact: true }).fill(accountName);
  await page
    .getByLabel("Square API Key", { exact: false })
    .fill("fixture-browser-key-" + suffix);
  await page.getByRole("button", { name: "保存账号", exact: true }).click();
  await expect(page.getByText(accountName, { exact: true })).toBeVisible();
  await page.getByLabel("搜索账号").fill(accountName);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(
    page.locator("tbody").getByText("已暂停", { exact: true }),
  ).toBeVisible();
});
test("post search, preview lineage and actual rendered prompt", async ({
  page,
}) => {
  await page.getByRole("link", { name: "帖子中心", exact: true }).click();
  await page.getByLabel("搜索正文").fill("不服气");
  await expect(page.locator(".post-row").first()).toBeVisible();
  await page.getByRole("button", { name: "查看来源与回执" }).first().click();
  await expect(page.getByText("字符数", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "任务与完整提示词" }).click();
  await page.getByRole("button", { name: "实际提示词", exact: true }).click();
  await expect(
    page.getByText("实际发送的完整提示词", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("未返回，仅有请求参数", { exact: true }),
  ).toHaveCount(0);
});
test("presets, library and model settings render real backend resources", async ({
  page,
}) => {
  await page.getByRole("link", { name: "内容预设", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(3);
  await page.getByRole("button", { name: "编辑规则" }).first().click();
  await expect(page.getByLabel("内容方向", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "配图规则" }).click();
  await expect(page.getByLabel("图片来源", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).last().click();
  await page.getByRole("link", { name: "图库与生图", exact: true }).click();
  await expect(page.locator(".media-card").first()).toBeVisible();
  await page.getByRole("link", { name: "系统设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^批准模型/ })).toBeVisible();
  await expect(
    page.getByText("本机开发夹具 · 非真实 AI", { exact: true }).first(),
  ).toBeVisible();
});
test("mobile navigation and document have no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("link", { name: "账号与计划", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "账号与计划", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("AI setup discovers models, registers a choice and saves the default route", async ({
  page,
}) => {
  await page.getByRole("link", { name: "系统设置", exact: true }).click();
  await page
    .getByRole("button", { name: "检查并选模型", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "读取可用模型", exact: true }).click();
  await expect(
    page.getByText("模型列表可读 · 2 个", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".discovered-models > div")).toHaveCount(2);
  await page.getByRole("button", { name: "手动登记", exact: true }).click();
  const modelName = "浏览器接入测试-" + Date.now().toString(36);
  await page.getByLabel("显示名称", { exact: true }).fill(modelName);
  await page
    .getByLabel("实际模型 ID", { exact: true })
    .fill("fixture-browser-model-" + Date.now());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登记模型", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const option = page
    .getByLabel("默认文字模型", { exact: true })
    .locator("option")
    .filter({ hasText: modelName });
  const value = await option.getAttribute("value");
  await page.getByLabel("默认文字模型", { exact: true }).selectOption(value!);
  await page.getByRole("button", { name: "保存默认模型", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存默认模型", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("默认文字模型", { exact: true })).toHaveValue(
    value!,
  );
  await page.getByRole("link", { name: "内容预设", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑规则", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "模型与质量", exact: true }).click();
  await page
    .getByLabel("批准的文字模型的服务连接", { exact: true })
    .selectOption("@default");
  await expect(page.getByLabel("批准的文字模型", { exact: true })).toHaveValue(
    "@default",
  );
  await expect(
    page.getByLabel("批准的文字模型", { exact: true }),
  ).toContainText(modelName);
});

test("provider presets edit the actual protocol and endpoint; theme persists", async ({
  page,
}) => {
  await page.getByRole("button", { name: "切换深色模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: "添加 AI 连接", exact: true }).click();
  await page.getByRole("button", { name: "Anthropic", exact: true }).click();
  await expect(page.getByLabel("API 基础地址", { exact: true })).toHaveValue(
    "https://api.anthropic.com/v1",
  );
  await expect(page.getByLabel("请求协议", { exact: true })).toHaveValue(
    "anthropic_messages",
  );
  await page.getByRole("button", { name: "OpenAI", exact: true }).click();
  await expect(page.getByLabel("请求协议", { exact: true })).toHaveValue(
    "openai_responses_images",
  );
  await page
    .getByRole("button", { name: "自定义 / 兼容网关", exact: true })
    .click();
  await expect(page.getByLabel("请求协议", { exact: true })).toHaveValue(
    "openai_chat_images",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "切换浅色模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("mobile drawer traps focus, closes with Escape, and AI settings fit narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  await menu.click();
  await expect(page.locator(".main-shell")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("link", { name: "系统设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "默认 AI 模型", exact: true }),
  ).toBeVisible();
  const intro = await page.locator(".ai-intro-copy").boundingBox();
  const headline = await page.locator(".ai-intro-copy h2").boundingBox();
  expect(intro!.width).toBeGreaterThan(250);
  expect(headline!.height).toBeLessThan(80);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "添加 AI 连接", exact: true }).click();
  await expect(page.getByLabel("连接名称", { exact: true })).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
});

test("custom AI connection can be saved, discovered, edited and rotated through the UI", async ({
  page,
}) => {
  await page.getByRole("link", { name: "系统设置", exact: true }).click();
  const endpoint = await page
    .locator(".connection-card .endpoint-box .mono")
    .first()
    .innerText();
  await page.getByRole("button", { name: "添加 AI 连接", exact: true }).click();
  const suffix = Date.now().toString(36),
    name = "自有服务测试-" + suffix;
  await page.getByLabel("连接名称", { exact: true }).fill(name);
  await page.getByLabel("API 基础地址", { exact: true }).fill(endpoint);
  await page
    .getByLabel("API Key", { exact: true })
    .fill("fixture-ui-provider-" + suffix);
  await page.getByText("高级接入设置", { exact: true }).click();
  await page.getByLabel("允许访问自有内网服务", { exact: true }).check();
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "检查连接与选择模型", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "读取可用模型", exact: true }).click();
  await expect(
    page.getByText("模型列表可读 · 2 个", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const card = page.locator(".connection-card").filter({ hasText: name });
  await expect(card.getByText(/模型列表可读/)).toBeVisible();
  await card.getByRole("button", { name: "配置", exact: true }).click();
  await page.getByLabel("连接名称", { exact: true }).fill(name + "已更新");
  await page.getByLabel("替换 API Key", { exact: true }).check();
  await page
    .getByLabel("新的 API Key", { exact: true })
    .fill("fixture-ui-rotated-" + suffix + "NEXT");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const updated = page
    .locator(".connection-card")
    .filter({ hasText: name + "已更新" });
  await expect(updated.getByText(/NEXT/)).toBeVisible();
  await expect(updated.locator(".probe-line")).toContainText(
    "尚未检查模型列表",
  );
});
