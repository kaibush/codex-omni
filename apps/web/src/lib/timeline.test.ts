import { describe, expect, it } from "vitest";
import {
  capHistoryTimelineEvents,
  capTimelineEvents,
  compactTimelineEvents,
  displayTimelineEvents,
  HISTORY_TIMELINE_MAX_ITEMS,
  mergeSessionTimeline
} from "./timeline";
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

  it("drops stale streaming reasoning that is no longer on the latest page", () => {
    expect(
      mergeSessionTimeline({
        historical: [item("m3", 30)],
        current: [item("old-reason", 10, { kind: "reasoning", streaming: true }), item("m3", 30)],
        historyExpanded: false
      }).map((entry) => entry.id)
    ).toEqual(["m3"]);
  });

  it("keeps view_image input.path when history overwrites a live tool card", () => {
    const merged = mergeSessionTimeline({
      historical: [
        item("tool-r1-img", 30, {
          kind: "tool",
          data: { tool: "view_image", phase: "completed", output: "" }
        })
      ],
      current: [
        item("tool-r1-img", 30, {
          kind: "tool",
          data: {
            tool: "view_image",
            phase: "started",
            input: { path: "/repo/.codex-uploads/shot.png" }
          }
        })
      ],
      historyExpanded: false
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.data).toMatchObject({
      path: "/repo/.codex-uploads/shot.png",
      input: { path: "/repo/.codex-uploads/shot.png" },
      phase: "completed"
    });
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

describe("capTimelineEvents", () => {
  it("keeps the tail of a long live session", () => {
    const items = Array.from({ length: 200 }, (_, index) => item(`m-${index}`, index));
    const result = capTimelineEvents(items);
    expect(result).toHaveLength(120);
    expect(result[0]?.id).toBe("m-80");
    expect(result.at(-1)?.id).toBe("m-199");
  });

  it("snaps the tail window back to a nearby user turn", () => {
    const items = [
      ...Array.from({ length: 100 }, (_, index) => item(`tool-${index}`, index, { kind: "tool" })),
      item("user-1", 100, { kind: "user", text: "continue" }),
      ...Array.from({ length: 40 }, (_, index) =>
        item(`live-${index}`, 101 + index, { kind: "tool" })
      )
    ];
    const result = capTimelineEvents(items, { maxItems: 30 });
    expect(result[0]?.id).toBe("user-1");
    expect(result.at(-1)?.id).toBe("live-39");
  });

  it("returns the same array when the window already fits", () => {
    const items = [item("a", 1), item("b", 2)];
    expect(capTimelineEvents(items)).toBe(items);
  });

  it("counts tool payloads so huge outputs cannot keep the whole tail", () => {
    const items = Array.from({ length: 40 }, (_, index) =>
      item(`tool-${index}`, index, {
        kind: "tool",
        text: "ok",
        data: { output: "n".repeat(80_000) }
      })
    );
    const result = capTimelineEvents(items, { maxItems: 40, maxChars: 200_000 });
    expect(result.length).toBeLessThan(items.length);
    expect(result.at(-1)?.id).toBe("tool-39");
  });
});

describe("capHistoryTimelineEvents", () => {
  it("keeps a bounded oldest edge while live updates are paused", () => {
    const items = Array.from({ length: HISTORY_TIMELINE_MAX_ITEMS + 80 }, (_, index) =>
      item(`item-${index}`, index, { kind: "tool", text: `output-${index}` })
    );
    const result = capHistoryTimelineEvents(items);
    expect(result).toHaveLength(HISTORY_TIMELINE_MAX_ITEMS);
    expect(result[0]?.id).toBe("item-0");
    expect(result.at(-1)?.id).toBe(`item-${HISTORY_TIMELINE_MAX_ITEMS - 1}`);
  });
});
