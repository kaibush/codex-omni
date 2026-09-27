import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { Message, SessionDetailPage } from "../apps/web/src/types";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

const source = "https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093";
const answer = [
  "| 城市 | 现在 | 体感 | 天气 | 今天高/低 | 降水概率 |",
  "|---|---|---|---|---|---|",
  "| 悉尼 | 14°C | 13°C | 小毛毛雨 | 17° / 14° | 接近 100% |",
  "| 墨尔本 | 10°C | 8°C | 晴 | 16° / 9° | 0% |",
  "| 布里斯班 | 18°C | 20°C | 晴 | 26° / 12° | 0% |",
  "| 珀斯 | 15°C | 15°C | 大部晴朗 | 19° / 12° | 约 82% |",
  "| 阿德莱德 | 13°C | 11°C | 大部晴朗 | 21° / 12° | 约 59% |",
  "| 堪培拉 | 9°C | 7°C | 阴 | 12° / 9° | 约 93% |",
  "",
  `Sources: [Open-Meteo 澳大利亚主要城市](${source})`
].join("\n");

async function claudeFixture(page: Page, legacy: boolean) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  const original = await apiJson<SessionDetailPage>(
    page.request,
    `/api/sessions/${created.session.id}`
  );
  const startedAt = Date.now();
  const reply = (index: number, complete: boolean, eventSeq: number): Message => ({
    id: `reply-${index}`,
    sessionId: created.session.id,
    role: "assistant",
    content: answer,
    providerId: created.provider.id,
    eventType: complete ? "assistant.completed" : "assistant.delta",
    itemId: `run:msg_weather:${index}`,
    dataJson: JSON.stringify({ clientType: "claude-code", eventSeq, completed: complete }),
    createdAt: startedAt + index,
    updatedAt: startedAt + eventSeq
  });
  let finished = legacy;
  let messages = legacy ? [reply(0, true, 641), reply(1, false, 640)] : [];
  const detail = (): SessionDetailPage => ({
    ...original,
    session: {
      ...original.session,
      clientType: "claude-code",
      status: finished ? "idle" : "running"
    },
    messages,
    latestRun: finished
      ? {
          ...reply(0, true, 650),
          id: "run-completed",
          role: "run",
          eventType: "turn.completed",
          content: "",
          dataJson: JSON.stringify({
            runId: "run",
            status: "completed",
            startedAt,
            endedAt: startedAt + 650
          })
        }
      : null
  });
  await page.route(`**/api/sessions/${created.session.id}?*`, (route) =>
    route.fulfill({ json: detail() })
  );
  let connection: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/ws", (ws) => {
    ws.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "session.subscribe") return;
      connection = ws;
      ws.send(
        JSON.stringify({
          type: "session.snapshot",
          sessionId: created.session.id,
          requestId: "run",
          payload: {
            session: detail().session,
            run: {
              id: "run",
              status: finished ? "completed" : "running",
              startedAt,
              ...(finished ? { endedAt: startedAt + 650 } : {})
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  await expect.poll(() => Boolean(connection)).toBe(true);
  await expect(page.locator(".composer-shell textarea")).toBeVisible();
  return {
    send(type: string, seq: number, payload: Record<string, unknown>) {
      connection!.send(
        JSON.stringify({
          type,
          sessionId: created.session.id,
          requestId: "run",
          seq,
          payload: { clientType: "claude-code", eventSeq: seq, ...payload }
        })
      );
    },
    complete() {
      finished = true;
      messages = [reply(1, true, 4)];
    },
    startedAt
  };
}

async function expectMarkdown(page: Page) {
  const reply = page.locator('article[data-message-id^="assistant-"]');
  await expect(reply).toHaveCount(1);
  await expect(reply.locator("table")).toHaveCount(1);
  await expect(reply.locator("td", { hasText: /^悉尼$/ })).toHaveCount(1);
  await expect(reply.getByRole("link", { name: "Open-Meteo 澳大利亚主要城市" })).toHaveAttribute(
    "href",
    source
  );
  await expect(reply.locator(".markdown-stream-pre")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
}

test.describe("Claude Markdown on mobile", () => {
  test.use({ hasTouch: true });

  test("renders legacy duplicated replies once in every view and after reload", async ({
    page
  }, testInfo) => {
    await claudeFixture(page, true);
    for (const view of ["折叠", "平铺", "展开"]) {
      await page
        .getByRole("group", { name: "时间线显示" })
        .getByRole("button", { name: view, exact: true })
        .click();
      await expectMarkdown(page);
    }
    await page.reload();
    await expectMarkdown(page);
    const table = page.locator(".markdown table");
    expect(await table.evaluate((node) => getComputedStyle(node).overflowX)).toBe("auto");
    await page.screenshot({ path: testInfo.outputPath("claude-markdown-mobile.png") });
  });

  test("switches streamed Claude text to Markdown when its original block completes", async ({
    page
  }) => {
    const fixture = await claudeFixture(page, false);
    fixture.send("reasoning.delta", 1, {
      itemId: "msg_weather:0",
      text: "Check weather",
      phase: "updated"
    });
    fixture.send("reasoning.delta", 2, {
      itemId: "msg_weather:0",
      text: "Check weather",
      phase: "completed"
    });
    fixture.send("assistant.delta", 3, {
      itemId: "msg_weather:1",
      delta: answer,
      messageId: "reply-1",
      createdAt: fixture.startedAt + 1
    });
    const reply = page.locator('article[data-message-id="assistant-run-msg_weather:1"]');
    await expect(reply.locator(".markdown-stream-pre")).toHaveText(answer);
    await expect(reply.locator("table")).toHaveCount(0);
    fixture.send("assistant.completed", 4, {
      itemId: "msg_weather:1",
      text: answer,
      completed: true,
      messageId: "reply-1",
      createdAt: fixture.startedAt + 1
    });
    await expectMarkdown(page);
    fixture.complete();
    fixture.send("turn.completed", 5, {
      startedAt: fixture.startedAt,
      endedAt: fixture.startedAt + 650
    });
    await expect(page.locator(".composer-summary")).toContainText("完成");
    await page.reload();
    await expectMarkdown(page);
  });
});
