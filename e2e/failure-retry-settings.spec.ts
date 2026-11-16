import { expect, test } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

const keyword = "The requested item was created under a different";
const resourceMismatch = JSON.stringify({
  error: {
    message: `OpenAI Responses bad request: ${keyword} *** OpenAI resource. Use the same resource that created the item to access it.`,
    type: "invalid_request_error"
  }
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 }
]) {
  test(`retry settings persist and explain resource mismatch at ${viewport.width}px`, async ({
    page
  }) => {
    await ensureWorkspace(page);
    await page.setViewportSize(viewport);
    const csrf = (await apiJson<{ csrfToken: string }>(page.request, "/api/auth/session"))
      .csrfToken;
    const original = await apiJson<Record<string, unknown>>(page.request, "/api/settings");
    await apiJson(page.request, "/api/settings", {
      method: "PUT",
      csrf,
      data: {
        ...original,
        failureRetryEnabled: false,
        failureRetryMode: "builtin",
        failureRetryBackoff: "exponential",
        failureRetryIncludeKeywords: "",
        failureRetryExcludeKeywords: ""
      }
    });
    await page.goto("/settings/runtime");
    await page.getByRole("tab", { name: "重试", exact: true }).click();
    await page.getByRole("switch", { name: "失败后自动重试", exact: true }).check();
    await page.getByLabel("测试错误匹配", { exact: true }).fill(resourceMismatch);
    await expect(page.getByRole("status").filter({ hasText: "被内置规则排除" })).toContainText(
      "不会自动重试"
    );
    await page.getByRole("button", { name: "添加资源不匹配规则", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "命中强制重试关键词" })).toContainText(
      "会自动重试"
    );
    await page.getByLabel("强制重试关键词", { exact: true }).fill(`${keyword}\nupstream busy\n`);
    await page.getByLabel("排除关键词", { exact: true }).fill("different *** OpenAI resource");
    await expect(page.getByRole("status").filter({ hasText: "命中排除关键词" })).toContainText(
      "不会自动重试"
    );
    await page
      .getByLabel("排除关键词", { exact: true })
      .fill("insufficient quota\ninvalid API key");
    await page.getByRole("combobox", { name: "等待方式", exact: true }).click();
    await page.getByRole("option", { name: "固定间隔", exact: true }).click();
    await page.getByLabel("首次等待（秒）", { exact: true }).fill("7");
    await page.getByLabel("封顶等待（秒）", { exact: true }).fill("30");
    await page.getByLabel("最多重试次数", { exact: true }).fill("4");
    await expect(page.getByText("前 4 次：7 → 7 → 7 → 7 秒", { exact: true })).toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/settings") && response.request().method() === "PUT"
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    const settings = await apiJson<Record<string, unknown>>(page.request, "/api/settings");
    expect(settings).toMatchObject({
      failureRetryEnabled: true,
      failureRetryMode: "builtin",
      failureRetryBackoff: "fixed",
      failureRetryDelayMs: 7000,
      failureRetryMaxDelayMs: 30000,
      failureRetryMaxAttempts: 4,
      failureRetryIncludeKeywords: `${keyword}\nupstream busy\n`,
      failureRetryExcludeKeywords: "insufficient quota\ninvalid API key"
    });
    // Older clients omit new fields. Saving their payload must not reset the rules.
    const legacy = { ...settings };
    for (const key of [
      "failureRetryMode",
      "failureRetryBackoff",
      "failureRetryIncludeKeywords",
      "failureRetryExcludeKeywords"
    ])
      delete legacy[key];
    await apiJson(page.request, "/api/settings", { method: "PUT", csrf, data: legacy });
    await page.reload();
    await page.getByRole("tab", { name: "重试", exact: true }).click();
    await expect(page.getByLabel("强制重试关键词", { exact: true })).toHaveValue(
      `${keyword}\nupstream busy\n`
    );
    await expect(page.getByRole("combobox", { name: "等待方式", exact: true })).toContainText(
      "固定间隔"
    );
    await page.getByLabel("测试错误匹配", { exact: true }).fill(resourceMismatch);
    await expect(page.getByRole("status").filter({ hasText: "命中强制重试关键词" })).toContainText(
      "会自动重试"
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/codex-omni-retry-settings-${viewport.width}.png`,
      fullPage: true
    });
    const invalid = await page.request.put("/api/settings", {
      headers: { "x-csrf-token": csrf },
      data: { ...settings, failureRetryMode: "invalid" }
    });
    expect(invalid.status()).toBe(400);
  });
}

test("compact retry settings save multiline keywords and stay within mobile bounds", async ({
  page
}) => {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "运行设置", exact: true });
  await panel.getByRole("tab", { name: "重试", exact: true }).click();
  await panel.getByRole("combobox", { name: "重试范围", exact: true }).click();
  await page.getByRole("option", { name: "仅自定义关键词", exact: true }).click();
  await expect(panel).toBeVisible();
  const include = panel.getByLabel("强制重试关键词", { exact: true });
  await include.fill("first line");
  await include.press("End");
  await include.press("Enter");
  await include.pressSequentially("second line", { delay: 30 });
  await expect(include).toHaveValue("first line\nsecond line");
  await include.blur();
  await expect
    .poll(
      async () =>
        (await apiJson<Record<string, unknown>>(page.request, "/api/settings"))
          .failureRetryIncludeKeywords
    )
    .toBe("first line\nsecond line");
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await panel.getByLabel("测试错误匹配", { exact: true }).fill("second line");
  await expect(panel.getByRole("status")).toContainText("命中强制重试关键词");
  await page.screenshot({ path: "/tmp/codex-omni-retry-compact-mobile.png", fullPage: true });
  await include.fill("save when closing\nsecond line");
  await include.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await apiJson<Record<string, unknown>>(page.request, "/api/settings"))
          .failureRetryIncludeKeywords
    )
    .toBe("save when closing\nsecond line");
});
