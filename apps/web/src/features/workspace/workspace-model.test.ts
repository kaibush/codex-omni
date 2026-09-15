/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@/types";
import {
  boundOutboundCommands,
  loadExpandedProjectIds,
  MAX_OUTBOUND_COMMAND_BYTES,
  MAX_OUTBOUND_COMMANDS,
  persistExpandedProjectIds,
  SIDEBAR_PROJECT_EXPANDED_KEY,
  timelineMessageId,
  upsert,
  toggleExpandedProjectId,
  type QueuedCommand
} from "./workspace-model";
import type { TimelineItem } from "@/types";

const command = (id: number, size: number): QueuedCommand => ({
  id: String(id),
  sessionId: "session",
  data: "d".repeat(size),
  message: ""
});

describe("outbound command bounds", () => {
  it("keeps the newest commands within the count limit", () => {
    const result = boundOutboundCommands(
      Array.from({ length: MAX_OUTBOUND_COMMANDS + 8 }, (_, index) => command(index, 10))
    );

    expect(result).toHaveLength(MAX_OUTBOUND_COMMANDS);
    expect(result[0]?.id).toBe("8");
    expect(result.at(-1)?.id).toBe(String(MAX_OUTBOUND_COMMANDS + 7));
  });

  it("keeps queued command data within the byte budget", () => {
    const size = Math.floor(MAX_OUTBOUND_COMMAND_BYTES / 2);
    const result = boundOutboundCommands([command(1, size), command(2, size), command(3, size)]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("3");
  });
});

describe("timeline message ids", () => {
  it("keeps steered user cards on the persisted message id", () => {
    const message: Message = {
      id: "msg-steer",
      sessionId: "s",
      role: "user",
      content: "还有西安的",
      providerId: "p",
      eventType: "user.message",
      itemId: "steer:client-1",
      dataJson: JSON.stringify({ steer: true }),
      createdAt: 1,
      updatedAt: 1
    };
    expect(timelineMessageId(message)).toBe("msg-steer");
  });

  it("keeps namespaced assistant cards unique after a steered continuation", () => {
    const message: Message = {
      id: "msg-asst",
      sessionId: "s",
      role: "assistant",
      content: "西安也下雨。",
      providerId: "p",
      eventType: "assistant.completed",
      itemId: "run-1:s1:m1",
      dataJson: null,
      createdAt: 2,
      updatedAt: 2
    };
    expect(timelineMessageId(message)).toBe("assistant-run-1-s1:m1");
  });
});

describe("timeline upsert", () => {
  it("inserts timestamped late events at their original position", () => {
    const current: TimelineItem[] = [
      { id: "user", kind: "user", createdAt: 10 },
      { id: "assistant", kind: "assistant", createdAt: 40 }
    ];
    expect(
      upsert(current, "tool", { kind: "tool", createdAt: 20, data: { command: "ls" } }).map(
        (item) => item.id
      )
    ).toEqual(["user", "tool", "assistant"]);
  });
});

afterEach(() => {
  localStorage.clear();
});

describe("sidebar project expanded ids", () => {
  it("toggles a project id on and off", () => {
    expect(toggleExpandedProjectId([], "p1")).toEqual(["p1"]);
    expect(toggleExpandedProjectId(["p1"], "p1")).toEqual([]);
    expect(toggleExpandedProjectId(["p1", "p2"], "p1")).toEqual(["p2"]);
    expect(toggleExpandedProjectId(["p1"], "p2")).toEqual(["p1", "p2"]);
  });

  it("loads an empty list when storage is missing or invalid", () => {
    expect(loadExpandedProjectIds()).toEqual([]);
    localStorage.setItem(SIDEBAR_PROJECT_EXPANDED_KEY, "not-json");
    expect(loadExpandedProjectIds()).toEqual([]);
    localStorage.setItem(SIDEBAR_PROJECT_EXPANDED_KEY, JSON.stringify({ p1: true }));
    expect(loadExpandedProjectIds()).toEqual([]);
    localStorage.setItem(SIDEBAR_PROJECT_EXPANDED_KEY, JSON.stringify(["p1", 2, "p2"]));
    expect(loadExpandedProjectIds()).toEqual(["p1", "p2"]);
  });

  it("persists expanded project ids for the next load", () => {
    persistExpandedProjectIds(["a", "b"]);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_PROJECT_EXPANDED_KEY) ?? "[]")).toEqual([
      "a",
      "b"
    ]);
    expect(loadExpandedProjectIds()).toEqual(["a", "b"]);
    persistExpandedProjectIds(new Set(["c"]));
    expect(loadExpandedProjectIds()).toEqual(["c"]);
  });
});
