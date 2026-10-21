import { test, expect } from "@playwright/test";

test("bulk account import needs only one key per line and reports original line numbers", async ({
  page,
}) => {
  await page.goto("/accounts");
  await page.getByLabel("用户名", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-1234");
  await page.getByRole("button", { name: "登录管理台", exact: true }).click();
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    input = dialog.getByLabel("API Key 列表", { exact: true }),
    submit = dialog.getByRole("button", { name: "开始导入", exact: true });
  await expect(dialog.getByRole("textbox")).toHaveCount(1);
  await expect(submit).toBeDisabled();
  await input.fill(" \r\n\t\r\n ");
  await expect(submit).toBeDisabled();
  const suffix = Date.now().toString(36),
    first = `fixture-import-browser-first-${suffix}`,
    second = `fixture-import-browser-second-${suffix}`;
  await input.fill(`\r\n  ${first}  \r\n\r\nshort\r\n${first}\r\n${second}`);
  await expect(
    dialog.getByText("待导入 4 个 API Key", { exact: true }),
  ).toBeVisible();
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith("/accounts/import") && r.request().method() === "POST",
  );
  await submit.click();
  const response = await sent;
  expect(response.request().postDataJSON()).toEqual({
    accounts: [
      { apiKey: first },
      { apiKey: "short" },
      { apiKey: first },
      { apiKey: second },
    ],
  });
  await expect(input).toHaveValue("");
  const report = dialog.getByRole("region", { name: "导入结果", exact: true });
  await expect(report).toContainText(/成功导入 2 个，\s*重复 1 个，\s*失败 1 个。/);
  const rows = report.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  for (const [index, line, status] of [
    [0, "2", "已导入"],
    [1, "4", "失败"],
    [2, "5", "重复"],
    [3, "6", "已导入"],
  ] as const) {
    await expect(rows.nth(index).locator("td").nth(0)).toHaveText(line);
    await expect(rows.nth(index).locator("td").nth(1)).toHaveText(status);
  }
  await expect(report).not.toContainText(first);
  await expect(report).not.toContainText(second);
  const result = (await response.json()).data;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(report).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const created = result.filter((r: any) => r.status === "created");
  for (const a of created) {
    const row = page
      .locator(".account-table tbody tr")
      .filter({ hasText: a.name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("已暂停");
  }
});
