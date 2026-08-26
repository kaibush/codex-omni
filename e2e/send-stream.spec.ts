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
  await expect(page.getByText("已收到：hello stream")).toBeVisible();
  await page.reload();
  await expect(page.getByText("已收到：hello stream")).toBeVisible();
});
