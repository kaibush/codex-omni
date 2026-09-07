import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";
import type { Message, SessionDetailPage } from "../apps/web/src/types";

async function historyFixture(page: Page) {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  const detail = await apiJson<SessionDetailPage>(
    page.request,
    `/api/sessions/${created.session.id}`
  );
  const messages: Message[] = Array.from({ length: 90 }, (_, index) => ({
    id: `history-${String(index).padStart(3, "0")}`,
    sessionId: created.session.id,
    role: index === 0 ? "user" : "assistant",
    content: `History card ${String(index).padStart(3, "0")}`,
    providerId: created.provider.id,
    eventType: index === 0 ? "user.message" : "assistant.completed",
    itemId: index === 0 ? null : `history-run:item-${index}`,
    dataJson: null,
    createdAt: 1_000 + index,
    updatedAt: 1_000 + index
  }));
  let olderRequests = 0;
  let historyGate: Promise<void> | undefined;
  await page.route(`**/api/sessions/${created.session.id}?*`, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const before = query.get("beforeId");
    if (before) {
      olderRequests += 1;
      await historyGate;
    }
    const end = before ? messages.findIndex((message) => message.id === before) : messages.length;
    const start = Math.max(0, end - 50);
    const first = messages[start]!;
    await route.fulfill({
      json: {
        ...detail,
        messages: messages.slice(start, end),
        hasMore: start > 0,
        nextCursor: start > 0 ? { id: first.id, createdAt: first.createdAt } : null
      }
    });
  });
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  await expect(page.getByText("History card 089", { exact: true })).toBeVisible();
  return {
    olderRequests: () => olderRequests,
    holdHistory() {
      let release!: () => void;
      historyGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    }
  };
}

test("can load exhausted history again after returning to an unchanged latest page", async ({
  page
}) => {
  const fixture = await historyFixture(page);
  const older = page.getByRole("button", { name: "加载更早的对话", exact: true });
  for (let round = 1; round <= 2; round += 1) {
    await older.click();
    await expect.poll(fixture.olderRequests).toBe(round);
    await expect(older).toHaveCount(0);
    await page.locator(".chat-scroll").evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(page.getByText("History card 000", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "返回最新", exact: true }).click();
    await expect(page.getByText("History card 089", { exact: true })).toBeVisible();
    await expect(older).toHaveCount(1);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("ignores a late history response after returning to the latest messages", async ({ page }) => {
  const fixture = await historyFixture(page);
  const release = fixture.holdHistory();
  await page.getByRole("button", { name: "加载更早的对话", exact: true }).click();
  await expect.poll(fixture.olderRequests).toBe(1);
  await page.getByRole("button", { name: "返回最新", exact: true }).click();
  const response = page.waitForResponse((res) => res.url().includes("beforeId="));
  release();
  await response;
  await expect(page.getByText("History card 089", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回最新", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加载更早的对话", exact: true })).toHaveCount(1);
});

test.describe("mobile history gestures", () => {
  test.use({ hasTouch: true });

  test("releases live follow on a native touch swipe after returning to latest", async ({
    page
  }) => {
    await historyFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "折叠项目侧栏", exact: true }).click();
    await page.getByRole("button", { name: "加载更早的对话", exact: true }).click();
    await expect(page.getByRole("button", { name: "加载更早的对话", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "返回最新", exact: true }).click();
    const scroller = page.locator(".chat-scroll");
    await expect(page.getByText("History card 089", { exact: true })).toBeVisible();
    const before = await scroller.evaluate((node) => node.scrollTop);
    const box = (await scroller.boundingBox())!;
    const client = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.35;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const distance of [8, 24, 60, 120, 180]) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + distance }]
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(before - 50);
    await expect(page.getByRole("button", { name: "返回最新", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await client.detach();
  });
});

test("does not revive a cancelled run while replaying legacy progress events", async ({ page }) => {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  const detail = await apiJson<SessionDetailPage>(
    page.request,
    `/api/sessions/${created.session.id}`
  );
  await page.route(`**/api/sessions/${created.session.id}?*`, (route) =>
    route.fulfill({
      json: {
        ...detail,
        session: { ...detail.session, status: "cancelled" },
        latestRun: {
          id: "run-message",
          role: "run",
          eventType: "run.cancelled",
          createdAt: 1000,
          updatedAt: 2000,
          dataJson: JSON.stringify({
            runId: "cancelled-run",
            status: "cancelled",
            startedAt: 1000,
            endedAt: 2000
          })
        }
      }
    })
  );
  let connection: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/ws", (ws) => {
    connection = ws;
    ws.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      if (command.type !== "session.subscribe") return;
      ws.send(
        JSON.stringify({
          type: "session.snapshot",
          sessionId: created.session.id,
          requestId: "cancelled-run",
          seq: 2,
          payload: {
            session: { ...detail.session, status: "cancelled" },
            run: {
              id: "cancelled-run",
              status: "cancelled",
              startedAt: 1000,
              endedAt: 2000,
              reason: "manual-cancel"
            },
            approvals: [],
            queue: [],
            replayTruncated: false,
            serverTime: Date.now()
          }
        })
      );
    });
  });
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  const stopped = page.locator(".composer-summary").getByTitle("已手动终止", { exact: true });
  await expect(stopped).toBeVisible();
  for (const event of [
    { type: "run.started", seq: 0, payload: { startedAt: 1000 } },
    { type: "turn.started", seq: 1, payload: { startedAt: 1000 } },
    {
      type: "assistant.completed",
      seq: 2,
      payload: { itemId: "answer", text: "Replayed stream output", firstResponseAt: 1500 }
    }
  ]) {
    connection!.send(
      JSON.stringify({ ...event, sessionId: created.session.id, requestId: "cancelled-run" })
    );
  }
  await expect(page.getByText("Replayed stream output", { exact: true })).toBeVisible();
  await expect(stopped).toBeVisible();
});
