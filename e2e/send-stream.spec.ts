import { expect, test } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";
import type { SessionDetailPage } from "../apps/web/src/types";

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

test("starts queue mode while idle and automatically sends waiting messages after reload", async ({
  page
}) => {
  await ensureWorkspace(page, "queue");
  const created = await createChatSession(page);
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  const composer = page.getByPlaceholder(/询问 Codex/);
  const first = `queued first ${"streaming ".repeat(1000).trim()}`;
  await composer.fill(first);
  await page.getByRole("button", { name: "加入消息队列", exact: true }).click();
  await page.getByRole("button", { name: "使用该模型发送" }).click();
  await expect(page.getByRole("button", { name: "停止当前任务", exact: true })).toBeVisible();
  const queue = page.locator("section").filter({ has: page.getByText(/^待发送 ·/) });
  await composer.fill("queued second");
  await page.getByRole("button", { name: "加入消息队列", exact: true }).click();
  await expect(queue.getByText("queued second", { exact: true })).toBeVisible();
  await expect(queue.getByRole("button", { name: "直接插入队列消息", exact: true })).toHaveText(
    "插入"
  );
  await expect(queue.getByText("当前任务结束后自动发送", { exact: true })).toBeVisible();
  await composer.fill("queued third");
  await page.getByRole("button", { name: "加入消息队列", exact: true }).click();
  await expect(queue.getByRole("button", { name: "直接插入队列消息", exact: true })).toHaveCount(2);
  await page.reload();
  await expect(queue.getByRole("button", { name: "直接插入队列消息", exact: true })).toHaveCount(2);
  await expect(page.getByText("已收到：queued second", { exact: true })).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByText("已收到：queued third", { exact: true })).toBeVisible();
  await expect(queue).toHaveCount(0);
  const detail = await apiJson<SessionDetailPage>(
    page.request,
    `/api/sessions/${created.session.id}`
  );
  expect(
    detail.messages.filter((message) => message.role === "user").map((message) => message.content)
  ).toEqual([first, "queued second", "queued third"]);
  await page.reload();
  await expect(page.getByText("已收到：queued second", { exact: true })).toBeVisible();
  await expect(page.getByText("已收到：queued third", { exact: true })).toBeVisible();
  await expect(queue).toHaveCount(0);
});
