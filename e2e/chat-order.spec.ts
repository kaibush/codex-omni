import { expect, test, type Route, type WebSocketRoute } from "@playwright/test";
import type { Message, SessionDetailPage } from "../apps/web/src/types";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

test("keeps live, delayed history, backfill and reload in the same conversation order", async ({
  page
}) => {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  const original = await apiJson<SessionDetailPage>(
    page.request,
    `/api/sessions/${created.session.id}`
  );
  const settings = await apiJson<Record<string, unknown>>(page.request, "/api/settings");
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      json: { ...settings, timelineView: "flat", showReasoning: true }
    })
  );
  await page.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 3_600_000;
  });
  const startedAt = Date.now();
  const row = (
    role: Message["role"],
    itemId: string,
    offset: number,
    content: string,
    eventSeq: number,
    data = {}
  ): Message => ({
    id: `msg-${itemId}`,
    sessionId: created.session.id,
    role,
    content,
    itemId: role === "user" ? null : `run:${itemId}`,
    eventType:
      role === "user"
        ? "user.message"
        : role === "assistant"
          ? "assistant.completed"
          : role === "reasoning"
            ? "reasoning.delta"
            : "tool.output",
    providerId: created.provider.id,
    createdAt: startedAt + offset,
    updatedAt: startedAt + offset,
    dataJson: JSON.stringify({ phase: "completed", eventSeq, ...data })
  });
  const user = row("user", "user", 0, "检查服务状态", 0);
  const thinking = row("reasoning", "thinking", 10, "先检查容器", 1);
  const commentary = row("assistant", "commentary", 20, "我接着确认容器是否健康。", 2);
  const tool = row("tool", "command", 30, "healthy", 4, {
    tool: "command",
    command: "docker compose ps",
    status: "completed"
  });
  const thinkingAgain = row("reasoning", "thinking-again", 40, "再核对版本", 5);
  const reply = row("assistant", "reply", 50, "服务已健康，版本已核对。", 8);
  const backfill = {
    ...row("tool", "backfill", 25, "checked", 0, {
      tool: "command",
      command: "check version",
      status: "completed"
    }),
    itemId: "jsonl:backfill"
  };
  let detail: SessionDetailPage = {
    ...original,
    session: { ...original.session, status: "running" },
    messages: [user],
    latestRun: null
  };
  let holdHistory = false;
  let heldHistory: Route | undefined;
  await page.route(`**/api/sessions/${created.session.id}?*`, (route) => {
    if (holdHistory) {
      holdHistory = false;
      heldHistory = route;
      return;
    }
    return route.fulfill({ json: detail });
  });
  let connection: WebSocketRoute | undefined;
  const snapshot = () =>
    connection!.send(
      JSON.stringify({
        type: "session.snapshot",
        sessionId: created.session.id,
        requestId: "run",
        payload: {
          session: detail.session,
          run: { id: "run", status: detail.latestRun ? "completed" : "running", startedAt },
          approvals: [],
          queue: [],
          replayTruncated: false,
          serverTime: Date.now()
        }
      })
    );
  await page.routeWebSocket("**/api/ws", (ws) => {
    ws.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "session.subscribe") return;
      connection = ws;
      snapshot();
    });
  });
  const send = (
    message: Message,
    type = message.eventType!,
    overrides: Record<string, unknown> = {}
  ) => {
    const [requestId, ...parts] = message.itemId!.split(":");
    const data = JSON.parse(message.dataJson!);
    connection!.send(
      JSON.stringify({
        type,
        sessionId: created.session.id,
        requestId,
        seq: overrides.eventSeq ?? data.eventSeq,
        payload: {
          ...data,
          itemId: parts.join(":"),
          text: message.content,
          messageId: message.id,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          ...overrides
        }
      })
    );
  };
  const cardIds = () =>
    page
      .locator("article[data-message-id]")
      .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-message-id")));
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  await expect(page.getByText(user.content, { exact: true }).first()).toBeVisible();
  await expect.poll(() => Boolean(connection)).toBe(true);
  send(thinking);
  send(commentary);
  send(tool, "tool.started", { output: "", eventSeq: 3, phase: "started", status: "in_progress" });
  await expect
    .poll(cardIds)
    .toEqual([
      "msg-user",
      "reasoning-run-thinking",
      "assistant-run-commentary",
      "tool-run-command"
    ]);

  // Hold a snapshot taken after commentary while later progress is rendered.
  holdHistory = true;
  snapshot();
  await expect.poll(() => Boolean(heldHistory)).toBe(true);
  send(tool, "tool.output", { output: tool.content });
  send(thinkingAgain);
  send(reply, "assistant.delta", {
    text: undefined,
    delta: "服务已健康",
    eventSeq: 6,
    phase: "updated"
  });
  const liveOrder = [
    "msg-user",
    "reasoning-run-thinking",
    "assistant-run-commentary",
    "tool-run-command",
    "reasoning-run-thinking-again",
    "assistant-run-reply"
  ];
  await expect.poll(cardIds).toEqual(liveOrder);
  detail = { ...detail, messages: [user, thinking, commentary] };
  await heldHistory!.fulfill({ json: detail });
  await expect.poll(cardIds).toEqual(liveOrder);

  send(backfill, "tool.output", { output: backfill.content });
  const finalOrder = [...liveOrder.slice(0, 3), "tool-jsonl-backfill", ...liveOrder.slice(3)];
  await expect.poll(cardIds).toEqual(finalOrder);
  detail = {
    ...detail,
    session: { ...detail.session, status: "idle" },
    messages: [user, thinking, commentary, backfill, tool, thinkingAgain, reply],
    latestRun: {
      ...row("run", "completed", 60, "", 9),
      eventType: "turn.completed",
      dataJson: JSON.stringify({
        runId: "run",
        status: "completed",
        startedAt,
        endedAt: startedAt + 60
      })
    }
  };
  snapshot();
  await expect(page.getByText(reply.content, { exact: true })).toBeVisible();
  send(reply, "assistant.delta", {
    text: undefined,
    delta: "旧的重复增量",
    eventSeq: 7,
    phase: "updated"
  });
  const refreshed = page.waitForResponse((response) =>
    response.url().includes(`/api/sessions/${created.session.id}?`)
  );
  connection!.send(
    JSON.stringify({
      type: "turn.completed",
      sessionId: created.session.id,
      requestId: "run",
      seq: 9,
      payload: { startedAt, endedAt: startedAt + 60 }
    })
  );
  await refreshed;
  await expect(page.getByText(reply.content, { exact: true })).toBeVisible();
  await expect(page.getByText(/旧的重复增量/)).toHaveCount(0);
  await expect.poll(cardIds).toEqual(finalOrder);
  await page.reload();
  await expect.poll(cardIds).toEqual(finalOrder);
  await expect(page.getByText(reply.content, { exact: true })).toBeVisible();
});
