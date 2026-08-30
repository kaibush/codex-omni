import { describe, expect, it } from "vitest";
import { compactTimelineEvents, displayTimelineEvents, mergeSessionTimeline } from "./timeline";
import type { TimelineItem } from "@/types";

const item = (id: string, createdAt: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({
  id,
  kind: extra.kind ?? "user",
  createdAt,
  ...extra
});

describe("mergeSessionTimeline", () => {
  it("drops older page leftovers after a latest-page refresh", () => {
    expect(
      mergeSessionTimeline({
        historical: [item("m3", 30), item("m4", 40), item("m5", 50)],
        current: [item("m1", 10), item("m2", 20), item("m3", 30), item("m4", 40), item("live", 60)],
        historyExpanded: false
      }).map((entry) => entry.id)
    ).toEqual(["m3", "m4", "m5", "live"]);
  });

  it("keeps explicitly loaded older messages before the latest page", () => {
    expect(
      mergeSessionTimeline({
        historical: [item("m3", 30), item("m4", 40), item("m5", 50)],
        current: [item("m1", 10), item("m2", 20), item("m3", 30), item("m4", 40), item("live", 60)],
        historyExpanded: true
      }).map((entry) => entry.id)
    ).toEqual(["m1", "m2", "m3", "m4", "m5", "live"]);
  });

  it("keeps loaded rows that share the latest-page boundary timestamp", () => {
    expect(
      mergeSessionTimeline({
        historical: [item("m3", 30), item("m4", 40)],
        current: [item("m1", 30), item("m2", 30), item("m3", 30), item("m4", 40)],
        historyExpanded: true
      }).map((entry) => entry.id)
    ).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("keeps a live row after the latest overlap even when timestamps match", () => {
    expect(
      mergeSessionTimeline({
        historical: [item("m3", 30), item("m4", 40)],
        current: [item("m3", 30), item("m4", 40), item("live", 40)],
        historyExpanded: false
      }).map((entry) => entry.id)
    ).toEqual(["m3", "m4", "live"]);
  });

  it("keeps streaming and error items that are not in the fetched page", () => {
    expect(
      mergeSessionTimeline({
        historical: [item("m3", 30)],
        current: [
          item("m3", 30),
          item("stream", 31, { kind: "assistant", streaming: true }),
          item("error", 20, { kind: "error" })
        ],
        historyExpanded: false
      }).map((entry) => entry.id)
    ).toEqual(["m3", "stream", "error"]);
  });
});

describe("compactTimelineEvents", () => {
  it("groups reasoning and activity items by request", () => {
    const result = compactTimelineEvents([
      item("reasoning-r1-a", 1, { kind: "reasoning", text: "先检查" }),
      item("reasoning-r1-b", 2, { kind: "reasoning", text: "再修改" }),
      item("tool-r1-a", 3, { kind: "tool", data: { command: "pnpm test" } }),
      item("file-r1-b", 4, { kind: "file", data: { changes: [] } }),
      item("assistant-r1-c", 5, { kind: "assistant", text: "完成" })
    ]);
    expect(result.map((entry) => entry.kind)).toEqual(["reasoning", "activity", "assistant"]);
    expect(result[0]?.text).toContain("先检查");
    expect(result[0]?.text).toContain("再修改");
  });

  it("keeps plan and collab tools out of activity groups", () => {
    const result = compactTimelineEvents([
      item("plan-1", 1, { kind: "tool", data: { tool: "update_plan", items: [] } }),
      item("tool-1", 2, { kind: "tool", data: { command: "pnpm test" } }),
      item("file-1", 3, { kind: "file", data: { changes: [] } }),
      item("collab-1", 4, { kind: "tool", data: { tool: "spawn_agent", prompt: "go" } })
    ]);
    expect(result.map((entry) => entry.id)).toEqual([
      "plan-1",
      "activity-group-tool-1",
      "collab-1"
    ]);
  });

  it("keeps notices, user input, images and stdin out of activity groups", () => {
    const result = compactTimelineEvents([
      item("notice-1", 1, {
        kind: "tool",
        data: { tool: "runtime_error", message: "Model metadata for `grok-4.6` not found." }
      }),
      item("ask-1", 2, { kind: "tool", data: { tool: "request_user_input", questions: [] } }),
      item("img-1", 3, { kind: "tool", data: { tool: "view_image", path: "shot.png" } }),
      item("stdin-1", 4, { kind: "tool", data: { tool: "write_stdin", session_id: 1 } }),
      item("tool-1", 5, { kind: "tool", data: { command: "pnpm test" } }),
      item("file-1", 6, { kind: "file", data: { changes: [] } })
    ]);
    expect(result.map((entry) => entry.id)).toEqual([
      "notice-1",
      "ask-1",
      "img-1",
      "stdin-1",
      "activity-group-tool-1"
    ]);
  });

  it("drops empty runtime_error placeholders", () => {
    const result = compactTimelineEvents([
      item("empty-1", 1, { kind: "tool", data: { tool: "runtime_error", message: "" } }),
      item("tool-1", 2, { kind: "tool", data: { command: "pwd" } })
    ]);
    expect(result.map((entry) => entry.id)).toEqual(["tool-1"]);
  });

  it("folds interleaved reasoning and commands between assistant messages", () => {
    const result = compactTimelineEvents([
      item("assistant-1", 1, { kind: "assistant", text: "开始" }),
      item("r1", 2, { kind: "reasoning", text: "先跑测试" }),
      item("cmd-1", 3, { kind: "tool", data: { command: "pnpm test" } }),
      item("r2", 4, { kind: "reasoning", text: "再看文件" }),
      item("cmd-2", 5, { kind: "tool", data: { command: "ls" } }),
      item("assistant-2", 6, { kind: "assistant", text: "完成" })
    ]);
    expect(result.map((entry) => entry.kind)).toEqual([
      "assistant",
      "reasoning",
      "activity",
      "assistant"
    ]);
    expect(result[1]?.text).toContain("先跑测试");
    expect(result[1]?.text).toContain("再看文件");
  });

  it("keeps one thinking block around plan and sub-agent cards", () => {
    const result = compactTimelineEvents([
      item("assistant-1", 1, { kind: "assistant", text: "开两个子代理" }),
      item("plan-1", 2, { kind: "tool", data: { tool: "update_plan", items: [] } }),
      item("r1", 3, { kind: "reasoning", text: "Spawn first agent" }),
      item("spawn-1", 4, { kind: "tool", data: { tool: "spawn_agent", prompt: "date" } }),
      item("r2", 5, { kind: "reasoning", text: "Spawn second agent" }),
      item("spawn-2", 6, { kind: "tool", data: { tool: "spawn_agent", prompt: "pwd" } }),
      item("assistant-2", 7, { kind: "assistant", text: "完成" })
    ]);
    expect(result.map((entry) => entry.id)).toEqual([
      "assistant-1",
      "plan-1",
      "reasoning-group-r1",
      "spawn-1",
      "spawn-2",
      "assistant-2"
    ]);
  });

  it("keeps the original tool and thinking flow in flat and expanded views", () => {
    const items = [
      item("assistant-1", 1, { kind: "assistant", text: "开始" }),
      item("r1", 2, { kind: "reasoning", text: "先跑测试" }),
      item("cmd-1", 3, { kind: "tool", data: { command: "pnpm test" } }),
      item("r2", 4, { kind: "reasoning", text: "再看文件" }),
      item("cmd-2", 5, { kind: "tool", data: { command: "ls" } })
    ];
    expect(displayTimelineEvents(items, "flat").map((entry) => entry.id)).toEqual([
      "assistant-1",
      "r1",
      "cmd-1",
      "r2",
      "cmd-2"
    ]);
    expect(displayTimelineEvents(items, "expanded").map((entry) => entry.id)).toEqual([
      "assistant-1",
      "r1",
      "cmd-1",
      "r2",
      "cmd-2"
    ]);
    expect(displayTimelineEvents(items, "folded").map((entry) => entry.kind)).toEqual([
      "assistant",
      "reasoning",
      "activity"
    ]);
  });

  it("hides empty runtime_error placeholders in every timeline view", () => {
    const items = [
      item("empty-1", 1, { kind: "tool", data: { tool: "runtime_error", message: "" } }),
      item("r1", 2, { kind: "reasoning", text: "think" }),
      item("tool-1", 3, { kind: "tool", data: { command: "pwd" } })
    ];
    for (const view of ["folded", "flat", "expanded"] as const) {
      expect(displayTimelineEvents(items, view).some((entry) => entry.id === "empty-1")).toBe(
        false
      );
    }
  });
});
