import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Message, Session } from "../apps/web/src/types";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

async function fixture(page: Page) {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  const composer = page.locator(".composer-shell textarea");
  await composer.fill("保留这一轮上下文");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "使用该模型发送", exact: true }).click();
  await expect(page.getByText("已收到：保留这一轮上下文", { exact: true })).toBeVisible();
  await composer.fill("需要回退并重新编辑的请求");
  await page.locator('footer input[type="file"]').setInputFiles({
    name: "reference.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("ATTACHMENT_TO_KEEP")
  });
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  let detail!: { session: Session; messages: Message[] };
  await expect
    .poll(async () => {
      detail = await apiJson(page.request, `/api/sessions/${created.session.id}`);
      return (
        detail.session.status === "idle" &&
        detail.messages.filter((m) => m.role === "assistant").length === 2
      );
    })
    .toBe(true);
  const point = detail.messages.findLast((m) => m.role === "user")!;
  const attachment = JSON.parse(point.dataJson!).attachments[0] as {
    path: string;
    name: string;
    kind: string;
  };
  await writeFile(path.join(created.directory, "keep.txt"), "FILES_ARE_NOT_REWOUND");
  return { ...created, point, attachment, composer, originalMessages: detail.messages };
}

for (const mode of ["fork", "current"] as const) {
  test(`${mode} rewind restores an editable request and attachments while preserving the original history`, async ({
    page
  }, testInfo) => {
    const created = await fixture(page);
    const { point, composer, attachment } = created;
    await composer.fill("回退前尚未发送的草稿");
    const observer = mode === "current" ? await page.context().newPage() : null;
    if (observer) {
      await observer.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
      await expect(observer.locator(`article[data-message-id="${point.id}"]`)).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "折叠项目侧栏", exact: true }).click();
    }
    const anchor = page.locator(`article[data-message-id="${point.id}"]`);
    await anchor.getByRole("button", { name: "回退到此处", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "回退对话", exact: true });
    await expect(dialog.getByRole("combobox", { name: "回退方式" })).toContainText("分叉新对话");
    if (mode === "current") {
      await dialog.getByRole("combobox", { name: "回退方式" }).click();
      await page.getByRole("option", { name: "回退当前对话，自动保存备份", exact: true }).click();
    }
    await expect(dialog).toContainText("项目文件保持当前状态");
    await page.screenshot({ path: testInfo.outputPath(`rewind-${mode}.png`) });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/sessions/${created.session.id}/rewind`) &&
        response.request().method() === "POST"
    );
    await dialog
      .getByRole("button", { name: mode === "fork" ? "分叉并回退" : "备份并回退", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const result = (await response.json()) as { session: Session; backupSessionId: string | null };
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/sessions/${result.session.id}$`));
    await expect(composer).toHaveValue("需要回退并重新编辑的请求");
    await expect(page.locator(".composer-attachment")).toContainText("reference.txt");
    await expect(page.locator(".event-card-user")).toHaveCount(1);
    const originalId = result.backupSessionId ?? created.session.id;
    const original = await apiJson<{ messages: Message[] }>(
      page.request,
      `/api/sessions/${originalId}`
    );
    expect(original.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(
      created.originalMessages.filter((m) => m.role === "user").map((m) => m.content)
    );
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).text,
        `codex-omni:draft:${created.project.id}:${originalId}`
      )
    ).toBe("回退前尚未发送的草稿");
    if (observer) {
      await observer.bringToFront();
      await expect(observer.locator(`article[data-message-id="${point.id}"]`)).toHaveCount(0);
      await expect(observer.locator(".event-card-user")).toHaveCount(1);
      await observer.close();
      await page.bringToFront();
    }
    await page.reload();
    await expect(composer).toHaveValue("需要回退并重新编辑的请求");
    await expect(page.locator(".composer-attachment")).toContainText("reference.txt");
    await expect(page.locator(".event-card-user")).toHaveCount(1);
    await composer.fill("修改后的新请求");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    if (mode === "fork")
      await page.getByRole("button", { name: "使用该模型发送", exact: true }).click();
    await expect
      .poll(async () => {
        const next = await apiJson<{ messages: Message[] }>(
          page.request,
          `/api/sessions/${result.session.id}`
        );
        return next.messages.filter((m) => m.role === "user").length;
      })
      .toBe(2);
    const next = await apiJson<{ messages: Message[] }>(
      page.request,
      `/api/sessions/${result.session.id}`
    );
    const resent = next.messages.findLast((m) => m.role === "user")!;
    expect(resent.content).toContain("修改后的新请求");
    expect(JSON.parse(resent.dataJson!).attachments).toEqual([attachment]);
    expect(await readFile(path.resolve(created.directory, attachment.path), "utf8")).toBe(
      "ATTACHMENT_TO_KEEP"
    );
    expect(await readFile(path.join(created.directory, "keep.txt"), "utf8")).toBe(
      "FILES_ARE_NOT_REWOUND"
    );
  });
}

test("rejects another session's anchor and retains the selected assistant response", async ({
  page
}) => {
  const created = await fixture(page);
  const other = await createChatSession(page);
  const rejected = await page.request.post(`/api/sessions/${other.session.id}/rewind`, {
    headers: { "x-csrf-token": created.csrf },
    data: { mode: "current", messageId: created.point.id }
  });
  expect(rejected.status()).toBe(404);
  const reply = created.originalMessages.find((m) => m.role === "assistant")!;
  const row = page.locator(".event-card-bot").filter({ hasText: reply.content });
  await row.getByRole("button", { name: "回退到此处", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "回退对话", exact: true });
  await expect(dialog).toContainText("保留这条回复及之前的对话");
  await dialog.getByRole("button", { name: "分叉并回退", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".event-card-user")).toHaveCount(1);
  await expect(page.getByText("已收到：保留这一轮上下文", { exact: true })).toBeVisible();
  await expect(created.composer).toHaveValue("");
});
