import { expect, test } from "@playwright/test";
import { createChatSession, ensureWorkspace } from "./helpers";

test("sends a message, streams the fake reply, and keeps it after reload", async ({ page }) => {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  const composer = page.getByPlaceholder(/询问 Codex/);
  await expect(composer).toBeVisible();
  await composer.fill("hello stream");
  const send = page.getByRole("button", { name: "发送消息" });
  await expect(send).toBeEnabled();
  await send.click();
  await page.getByRole("button", { name: "使用该模型发送" }).click();
  await expect(page.getByText("已收到：hello stream")).toBeVisible();
  await page.reload();
  await expect(page.getByText("已收到：hello stream")).toBeVisible();
});

test("keeps queued messages through reload and another completed turn until explicitly inserted", async ({
  page
}) => {
  await ensureWorkspace(page, "queue");
  const created = await createChatSession(page);
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  const composer = page.getByPlaceholder(/询问 Codex/);
  await composer.fill("manual first");
  await page.getByRole("button", { name: "加入消息队列", exact: true }).click();
  await page.getByRole("button", { name: "使用该模型发送" }).click();
  const queue = page.locator("section").filter({ has: page.getByText(/^待发送 ·/) });
  await expect(queue.getByText("manual first", { exact: true })).toBeVisible();
  await expect(queue.getByRole("button", { name: "直接插入队列消息", exact: true })).toHaveText("");
  await expect(page.getByText("已收到：manual first", { exact: true })).toHaveCount(0);
  await composer.fill("manual second");
  await page.getByRole("button", { name: "加入消息队列", exact: true }).click();
  await expect(queue.getByRole("button", { name: "直接插入队列消息", exact: true })).toHaveCount(2);
  await page.reload();
  await expect(queue.getByRole("button", { name: "直接插入队列消息", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "继续下一条" })).toHaveCount(0);
  await queue.getByRole("button", { name: "直接插入队列消息", exact: true }).first().click();
  await expect(page.getByText("已收到：manual first", { exact: true })).toBeVisible();
  await expect(queue.getByText("manual first", { exact: true })).toHaveCount(0);
  await expect(queue.getByText("manual second", { exact: true })).toBeVisible();
  await page.reload();
  await expect(queue.getByText("manual second", { exact: true })).toBeVisible();
  await expect(page.getByText("已收到：manual second", { exact: true })).toHaveCount(0);
  await queue.getByRole("button", { name: "直接插入队列消息", exact: true }).click();
  await expect(page.getByText("已收到：manual second", { exact: true })).toBeVisible();
  await expect(queue).toHaveCount(0);
});
