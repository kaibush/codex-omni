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

for (const mode of ["fork", "current", "backup"] as const) {
  test(`${mode} rewind restores the request and attachments with the selected retention mode`, async ({
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
    await expect(dialog.getByRole("combobox", { name: "回退方式" })).toContainText("回退当前对话");
    if (mode !== "current") {
      await dialog.getByRole("combobox", { name: "回退方式" }).click();
      await page
        .getByRole("option", {
          name: mode === "fork" ? "分叉新对话，保留原对话" : "回退当前对话，并保存备份",
          exact: true
        })
        .click();
    }
    await expect(dialog).toContainText("项目文件保持当前状态");
    await page.screenshot({ path: testInfo.outputPath(`rewind-${mode}.png`) });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/sessions/${created.session.id}/rewind`) &&
        response.request().method() === "POST"
    );
    await dialog
      .getByRole("button", { name: mode === "fork" ? "分叉并回退" : "回退当前对话", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const result = (await response.json()) as { session: Session; backupSessionId: string | null };
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/sessions/${result.session.id}$`));
    await expect(composer).toHaveValue("需要回退并重新编辑的请求");
    await expect(page.locator(".composer-attachment")).toContainText("reference.txt");
    await expect(page.locator(".event-card-user")).toHaveCount(1);
    const originalId = result.backupSessionId ?? (mode === "fork" ? created.session.id : null);
    if (originalId) {
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
    } else {
      expect(result.session.id).toBe(created.session.id);
      expect(
        await apiJson(page.request, `/api/projects/${created.project.id}/sessions`)
      ).toHaveLength(1);
      await expect(
        page.getByText("当前对话已回退，后续发送将从上方保留的历史继续。可以修改输入后重新发送。", {
          exact: true
        })
      ).toBeVisible();
    }
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
  await dialog.getByRole("combobox", { name: "回退位置" }).click();
  await page.getByRole("option", { name: "保留这条回复，移除后续内容", exact: true }).click();
  await expect(dialog).toContainText("保留这条回复及之前的对话");
  await dialog.getByRole("button", { name: "回退当前对话", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".event-card-user")).toHaveCount(1);
  await expect(page.getByText("已收到：保留这一轮上下文", { exact: true })).toBeVisible();
  await expect(created.composer).toHaveValue("");
});

test("undoes successive complete turns from assistant replies in the same conversation", async ({
  page
}, testInfo) => {
  const created = await fixture(page);
  const currentUrl = page.url();
  const replies = page.locator(".event-card-bot").filter({
    has: page.getByRole("button", { name: "回退到此处", exact: true })
  });
  for (const index of [0, 1]) {
    await expect(replies).toHaveCount(2 - index);
    await replies.last().getByRole("button", { name: "回退到此处", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "回退对话", exact: true });
    await expect(dialog.getByRole("combobox", { name: "回退位置" })).toContainText("撤销这整轮");
    await expect(dialog).toContainText("将撤销 1 轮");
    if (index === 0) await page.screenshot({ path: testInfo.outputPath("undo-turn.png") });
    await dialog.getByRole("button", { name: "回退当前对话", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(currentUrl);
    await expect(page.locator(".event-card-user")).toHaveCount(1 - index);
    await expect(replies).toHaveCount(1 - index);
    await expect(created.composer).toHaveValue(
      index === 0 ? "需要回退并重新编辑的请求" : "保留这一轮上下文"
    );
    expect(
      await apiJson(page.request, `/api/projects/${created.project.id}/sessions`)
    ).toHaveLength(1);
    await page.reload();
    await expect(page.locator(".event-card-user")).toHaveCount(1 - index);
    await expect(replies).toHaveCount(1 - index);
  }
});

test("replaces cached history even when the browser misses rewind and reconnect notifications", async ({
  page
}) => {
  let suppressSnapshots = false;
  await page.routeWebSocket("**/api/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const event = JSON.parse(String(message));
      if (
        event.type === "session.rewound" ||
        (suppressSnapshots && event.type === "session.snapshot")
      )
        return;
      socket.send(message);
    });
  });
  const created = await fixture(page);
  await expect(page.locator(`article[data-message-id="${created.point.id}"]`)).toBeVisible();
  suppressSnapshots = true;
  const result = await apiJson<{ session: Session }>(
    page.request,
    `/api/sessions/${created.session.id}/rewind`,
    {
      method: "POST",
      csrf: created.csrf,
      data: { messageId: created.point.id }
    }
  );
  expect(result.session.id).toBe(created.session.id);
  // The ordinary detail response must replace the old timeline even without
  // either WebSocket notification and without navigating away from this page.
  await page.getByRole("button", { name: "Session 更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "重新加载", exact: true }).click();
  await expect(page.locator(`article[data-message-id="${created.point.id}"]`)).toHaveCount(0);
  await expect(page.locator(".event-card-user")).toHaveCount(1);
  suppressSnapshots = false;
  await created.composer.fill("回退后的全新请求");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.locator(".event-card-bot").filter({ hasText: "回退后的全新请求" })
  ).toBeVisible();
  await expect(page.locator(".event-card-user")).toHaveCount(2);
  await expect(page.locator(`article[data-message-id="${created.point.id}"]`)).toHaveCount(0);
});
