import { expect, test, type Page } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

async function fixture(page: Page) {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  await apiJson(page.request, `/api/providers/${created.provider.id}`, {
    method: "PUT",
    csrf: created.csrf,
    data: { model: "fake-model", models: ["fake-model"] }
  });
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
  const codexPeer = await apiJson<{ id: string; name: string }>(page.request, "/api/providers", {
    method: "POST",
    csrf: created.csrf,
    data: {
      name: `Codex Other ${created.session.id}`,
      kind: "codex",
      homeMode: "api-key",
      apiKey: "fixture-codex-key",
      baseUrl: "http://127.0.0.1:1/v1",
      model: "fixture-model",
      models: ["fixture-model"]
    }
  });
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  await expect(page.getByRole("combobox", { name: "客户端", exact: true })).toBeVisible();
  return { ...created, claude, another, codexPeer };
}

for (const kind of ["codex", "claude-code"] as const) {
  test(`switches providers within one ${kind} conversation and offers a separate continuation`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const created = await fixture(page);
    const source =
      kind === "codex"
        ? created.session
        : await apiJson<{ id: string; providerId: string }>(
            page.request,
            `/api/projects/${created.project.id}/sessions`,
            {
              method: "POST",
              csrf: created.csrf,
              data: { clientType: kind, providerId: created.claude.id }
            }
          );
    const label = kind === "codex" ? "Codex" : "Claude Code";
    const target = kind === "codex" ? created.codexPeer : created.another;
    const foreign = kind === "codex" ? created.claude : created.codexPeer;
    await page.goto(`/projects/${created.project.id}/sessions/${source.id}`);
    const client = page.getByRole("combobox", { name: "客户端", exact: true });
    const provider = page.getByRole("combobox", { name: "供应商", exact: true });
    await expect(client).toHaveText(label);
    await expect(client).toBeDisabled();
    // A blank conversation may use the last composer preference. Explicitly
    // select A so that the later action really switches to another provider.
    const sourceName = kind === "codex" ? "Fake Provider" : created.claude.name;
    await provider.click();
    await page.getByRole("option", { name: sourceName, exact: true }).click();
    await expect(provider).toHaveText(sourceName);
    const originalProvider = await provider.textContent();
    await page.getByPlaceholder(new RegExp("询问 " + label)).fill("ORIGINAL_REQUEST");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByRole("button", { name: "使用该模型发送" }).click();
    await expect(page.getByText("已收到：ORIGINAL_REQUEST", { exact: true })).toBeVisible();
    await expect(provider).toBeEnabled();
    await provider.click();
    await expect(page.getByRole("option", { name: foreign.name, exact: true })).not.toBeVisible();
    await page.getByRole("option", { name: target.name, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "切换供应商", exact: true });
    await expect(dialog.getByRole("radio", { name: /在当前对话继续/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await dialog.getByRole("button", { name: "在当前对话继续", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp("/sessions/" + source.id + "$"));
    await expect(client).toHaveText(label);
    await page.getByPlaceholder(new RegExp("询问 " + label)).fill("CONTINUED_WITH_PROVIDER_B");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      page.getByText("已收到：CONTINUED_WITH_PROVIDER_B", { exact: true })
    ).toBeVisible();
    await expect(provider).toBeEnabled();
    const detail = await apiJson<{
      session: { providerId: string; clientType: string };
      messages: Array<{ content: string }>;
    }>(page.request, `/api/sessions/${source.id}`);
    expect(detail.session).toMatchObject({ providerId: target.id, clientType: kind });
    expect(detail.messages.some((message) => message.content === "ORIGINAL_REQUEST")).toBe(true);
    expect(detail.messages.some((message) => message.content === "CONTINUED_WITH_PROVIDER_B")).toBe(
      true
    );
    // The API enforces the same client boundary as the disabled picker.
    const rejected = await page.request.put(`/api/sessions/${source.id}/provider`, {
      headers: { "x-csrf-token": created.csrf },
      data: { providerId: foreign.id }
    });
    expect(rejected.status()).toBe(400);
    await page.getByPlaceholder(new RegExp("询问 " + label)).fill("DRAFT_TO_KEEP");
    await provider.click();
    await page.getByRole("option", { name: originalProvider!, exact: true }).click();
    await dialog.getByRole("radio", { name: /新建续接对话/ }).click();
    await dialog.getByRole("button", { name: "创建续接对话", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).not.toHaveURL(new RegExp("/sessions/" + source.id + "$"));
    await expect(client).toHaveText(label);
    await expect(page.getByPlaceholder(new RegExp("询问 " + label))).toHaveValue("DRAFT_TO_KEEP");
    const newId = new URL(page.url()).pathname.split("/").at(-1)!;
    const continued = await apiJson<{ session: { parentSessionId: string; clientType: string } }>(
      page.request,
      `/api/sessions/${newId}`
    );
    expect(continued.session).toMatchObject({ parentSessionId: source.id, clientType: kind });
    expect(errors).toEqual([]);
  });
}

test("creates a Claude conversation with its own providers and native runtime controls", async ({
  page
}) => {
  const created = await fixture(page);
  await page.getByPlaceholder(/询问 Codex/).fill("ONLY_CODEX_HISTORY");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "使用该模型发送" }).click();
  await expect(page.getByText("已收到：ONLY_CODEX_HISTORY", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建对话", exact: true });
  const sourceHistory = dialog.getByRole("button", { name: /ONLY_CODEX_HISTORY/ });
  await expect(sourceHistory).toBeVisible();
  await sourceHistory.click();
  await dialog.getByRole("button", { name: /Claude Code 原生计划/ }).click();
  await expect(sourceHistory).not.toBeVisible();
  await dialog.getByRole("button", { name: "开始全新对话" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("combobox", { name: "客户端", exact: true })).toHaveText(
    "Claude Code"
  );
  await expect(page.getByRole("combobox", { name: "供应商", exact: true })).toHaveText(
    created.claude.name
  );
  await expect(page.getByPlaceholder(/询问 Claude Code/)).toBeVisible();
  const createdId = new URL(page.url()).pathname.split("/").at(-1)!;
  const detail = await apiJson<{ session: { parentSessionId: string | null; clientType: string } }>(
    page.request,
    `/api/sessions/${createdId}`
  );
  expect(detail.session).toMatchObject({ parentSessionId: null, clientType: "claude-code" });
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
