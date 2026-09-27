import { expect, test, type Page } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

async function fixture(page: Page) {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  const claude = await apiJson<{ id: string; name: string }>(page.request, "/api/providers", {
    method: "POST",
    csrf: created.csrf,
    data: {
      name: `Claude ${created.session.id}`,
      kind: "claude-code",
      homeMode: "api-key",
      apiKey: "fixture-key",
      baseUrl: "http://127.0.0.1:1",
      model: "sonnet",
      models: ["sonnet", "opus"],
      isDefault: true
    }
  });
  const another = await apiJson<{ id: string; name: string }>(page.request, "/api/providers", {
    method: "POST",
    csrf: created.csrf,
    data: {
      name: `Claude Other ${created.session.id}`,
      kind: "claude-code",
      homeMode: "api-key",
      apiKey: "fixture-key-2",
      baseUrl: "http://127.0.0.1:1",
      model: "opus",
      models: ["opus"]
    }
  });
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  await expect(page.getByRole("combobox", { name: "客户端", exact: true })).toBeVisible();
  return { ...created, claude, another };
}

test("continues across clients and providers in the same conversation, with an optional new continuation", async ({
  page
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const created = await fixture(page);
  await page.getByPlaceholder(/询问 Codex/).fill("ORIGINAL_CODEX_REQUEST");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "使用该模型发送" }).click();
  await expect(page.getByText("已收到：ORIGINAL_CODEX_REQUEST", { exact: true })).toBeVisible();
  const client = page.getByRole("combobox", { name: "客户端", exact: true });
  await expect(client).toBeEnabled();
  await client.click();
  await page.getByRole("option", { name: "Claude Code", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "切换客户端 / 供应商" });
  await expect(dialog.getByRole("radio", { name: /在当前对话继续/ })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await dialog.getByRole("button", { name: "在当前对话继续", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/sessions/${created.session.id}$`));
  await expect(client).toHaveText("Claude Code");
  await expect(page.getByText("已收到：ORIGINAL_CODEX_REQUEST", { exact: true })).toBeVisible();
  await page.getByPlaceholder(/询问 Claude Code/).fill("CONTINUED_WITH_CLAUDE");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByText("已收到：CONTINUED_WITH_CLAUDE", { exact: true })).toBeVisible();
  await expect(client).toBeEnabled();
  await page.getByRole("combobox", { name: "供应商", exact: true }).click();
  await expect(page.getByRole("option", { name: "Fake Provider", exact: true })).not.toBeVisible();
  await page.getByRole("option", { name: created.another.name, exact: true }).click();
  await dialog.getByRole("button", { name: "在当前对话继续", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/sessions/${created.session.id}$`));
  const detail = await apiJson<{
    session: { providerId: string; clientType: string };
    messages: Array<{ content: string }>;
  }>(page.request, `/api/sessions/${created.session.id}`);
  expect(detail.session).toMatchObject({
    providerId: created.another.id,
    clientType: "claude-code"
  });
  expect(detail.messages.some((message) => message.content === "ORIGINAL_CODEX_REQUEST")).toBe(
    true
  );
  expect(detail.messages.some((message) => message.content === "CONTINUED_WITH_CLAUDE")).toBe(true);
  await page.getByPlaceholder(/询问 Claude Code/).fill("DRAFT_TO_KEEP");
  await client.click();
  await page.getByRole("option", { name: "Codex", exact: true }).click();
  await dialog.getByRole("radio", { name: /新建续接对话/ }).click();
  await dialog.getByRole("button", { name: "创建续接对话", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(`/sessions/${created.session.id}$`));
  await expect(client).toHaveText("Codex");
  await expect(page.getByPlaceholder(/询问 Codex/)).toHaveValue("DRAFT_TO_KEEP");
  const newId = new URL(page.url()).pathname.split("/").at(-1)!;
  const continued = await apiJson<{ session: { parentSessionId: string; clientType: string } }>(
    page.request,
    `/api/sessions/${newId}`
  );
  expect(continued.session).toMatchObject({
    parentSessionId: created.session.id,
    clientType: "codex"
  });
  expect(errors).toEqual([]);
});

test("creates a Claude conversation with its own providers and native runtime controls", async ({
  page
}) => {
  const created = await fixture(page);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建对话", exact: true });
  await dialog.getByRole("button", { name: /Claude Code 原生计划/ }).click();
  await dialog.getByRole("button", { name: "开始全新对话" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("combobox", { name: "客户端", exact: true })).toHaveText(
    "Claude Code"
  );
  await expect(page.getByRole("combobox", { name: "供应商", exact: true })).toHaveText(
    created.claude.name
  );
  await expect(page.getByPlaceholder(/询问 Claude Code/)).toBeVisible();
  await page.getByRole("button", { name: /运行设置/ }).click();
  const runtime = page.getByRole("dialog", { name: "运行设置", exact: true });
  await expect(runtime.getByRole("combobox", { name: "工具权限", exact: true })).toBeVisible();
  await runtime.getByRole("button", { name: "计划", exact: true }).click();
  await expect(runtime.getByRole("button", { name: "计划", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.screenshot({ path: "/tmp/codex-omni-claude-workspace.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(runtime).toBeVisible();
  const bounds = await runtime.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/codex-omni-claude-mobile.png", fullPage: true });
  await runtime.getByRole("button", { name: "关闭", exact: true }).click();
});
