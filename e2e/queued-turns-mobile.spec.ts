import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";
import type { QueuedTurn, SessionDetailPage } from "../apps/web/src/types";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function tapLowerEdge(page: Page, button: Locator) {
  const box = (await button.boundingBox())!;
  const target = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const extra = getComputedStyle(element, "::before");
    return {
      width: rect.width - parseFloat(extra.left) - parseFloat(extra.right),
      height: rect.height - parseFloat(extra.top) - parseFloat(extra.bottom)
    };
  });
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height + 4);
}

test("keeps queue icons readable and touch actions usable at narrow phone widths", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await ensureWorkspace(page, "queue");
  const created = await createChatSession(page);
  const original = await apiJson<SessionDetailPage>(
    page.request,
    `/api/sessions/${created.session.id}`
  );
  const session = { ...original.session, status: "running" as const };
  let queue: QueuedTurn[] = [];
  let connection: WebSocketRoute | undefined;
  const commands: Array<{ type: string; queueId?: string; direction?: string; message?: string }> =
    [];
  const snapshot = () =>
    connection?.send(
      JSON.stringify({
        type: "session.snapshot",
        sessionId: session.id,
        requestId: "mobile-run",
        payload: {
          session,
          run: { id: "mobile-run", status: "running", startedAt: Date.now() },
          approvals: [],
          queue,
          replayTruncated: false,
          serverTime: Date.now()
        }
      })
    );
  await page.route(`**/api/sessions/${session.id}?*`, (route) =>
    route.fulfill({ json: { ...original, session } })
  );
  await page.routeWebSocket("**/api/ws", (ws) => {
    connection = ws;
    ws.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      if (command.type === "session.subscribe") return snapshot();
      if (!command.type.startsWith("queue.")) return;
      commands.push(command);
      if (command.type === "queue.move") {
        const index = queue.findIndex((item) => item.id === command.queueId);
        const destination = command.direction === "up" ? index - 1 : index + 1;
        const [item] = queue.splice(index, 1);
        queue.splice(destination, 0, item!);
      } else if (command.type === "queue.update") {
        queue = queue.map((item) =>
          item.id === command.queueId
            ? {
                ...item,
                message: command.message,
                options: { displayMessage: command.displayMessage ?? command.message }
              }
            : item
        );
      } else {
        queue = queue.filter((item) => item.id !== command.queueId);
        ws.send(
          JSON.stringify({
            type: "queue.acknowledged",
            sessionId: session.id,
            payload: {
              queueId: command.queueId,
              status: command.type === "queue.steer" ? "steered" : "removed"
            }
          })
        );
      }
      snapshot();
    });
  });

  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    queue = ["检查手机布局", "确认排队顺序", "完成后自动发送"].map((message, index) => ({
      id: `queued-${index}`,
      sessionId: session.id,
      projectId: created.project.id,
      providerId: created.provider.id,
      message,
      options: {},
      createdAt: Date.now() + index,
      updatedAt: Date.now() + index
    }));
    commands.length = 0;
    await page.goto(`/projects/${created.project.id}/sessions/${session.id}`);
    const panel = page.locator("section").filter({ has: page.getByText(/^待发送 ·/) });
    const insert = panel.getByRole("button", { name: "直接插入队列消息", exact: true });
    const more = panel.getByRole("button", { name: "队列消息更多操作", exact: true });
    await expect(insert).toHaveCount(3);
    await expect(more).toHaveCount(3);
    await expect(insert.first()).toHaveText("");
    await expect(insert.first().locator("svg")).toHaveClass(/lucide-send-horizontal/);
    await expect(more.first().locator("svg")).toHaveClass(/lucide-ellipsis/);
    await expect(panel.getByRole("button", { name: "编辑队列消息" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
    const iconBox = (await insert.first().locator("svg").boundingBox())!;
    expect(iconBox.width).toBe(16);
    expect(iconBox.height).toBe(16);
    const insertBox = (await insert.first().boundingBox())!;
    const moreBox = (await more.first().boundingBox())!;
    expect(moreBox.x - insertBox.x - insertBox.width).toBeGreaterThanOrEqual(12);
    expect(moreBox.y).toBe(insertBox.y);
    await page.screenshot({ path: `/tmp/codex-omni-queue-mobile-${width}.png` });

    await tapLowerEdge(page, more.first());
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "上移", exact: true })).toBeDisabled();
    for (const item of await menu.getByRole("menuitem").all()) {
      await expect.poll(async () => (await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    await menu.getByRole("menuitem", { name: "下移", exact: true }).tap();
    await expect
      .poll(() => commands.at(-1))
      .toMatchObject({ type: "queue.move", queueId: "queued-0", direction: "down" });
    await tapLowerEdge(page, more.first());
    await menu.getByRole("menuitem", { name: "编辑消息", exact: true }).tap();
    const edit = panel.getByRole("textbox");
    await expect(edit).toBeVisible();
    await edit.fill("修改后的排队消息");
    await tapLowerEdge(page, panel.getByRole("button", { name: "保存", exact: true }));
    await expect
      .poll(() => commands.at(-1))
      .toMatchObject({ type: "queue.update", queueId: "queued-1", message: "修改后的排队消息" });
    await expect(panel.getByText("修改后的排队消息", { exact: true })).toBeVisible();
    await tapLowerEdge(page, insert.first());
    await expect
      .poll(() => commands.at(-1))
      .toMatchObject({ type: "queue.steer", queueId: "queued-1" });
    expect(commands.filter((command) => command.type === "queue.steer")).toHaveLength(1);
    await tapLowerEdge(page, more.first());
    await menu.getByRole("menuitem", { name: "删除消息", exact: true }).tap();
    await expect
      .poll(() => commands.at(-1))
      .toMatchObject({ type: "queue.remove", queueId: "queued-0" });
    await expect(insert).toHaveCount(1);
  }
});
