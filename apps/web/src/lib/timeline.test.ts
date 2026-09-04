import { describe, expect, it } from "vitest";
import {
  capHistoryPreserveVisible,
  capHistoryTimelineEvents,
  capPausedTimelineEvents,
  capTimelineEvents,
  coalesceDuplicatePlanItems,
  compactTimelineEvents,
  displayTimelineEvents,
  hideSupersededStreamErrors,
  HISTORY_TIMELINE_MAX_ITEMS,
  LIVE_TIMELINE_MAX_CHARS,
  LIVE_TIMELINE_TAIL_ITEMS,
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

  it("keeps active streaming items but drops terminal errors older than the fetched page", () => {
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
    ).toEqual(["m3", "stream"]);
    expect(
      mergeSessionTimeline({
        historical: [item("m3", 30)],
        current: [
          item("m3", 30),
          item("stream", 31, { kind: "assistant", streaming: true }),
          item("error", 32, { kind: "error" })
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

  it("drops recovered stream errors that live-append after a later assistant reply", () => {
    expect(
      mergeSessionTimeline({
        historical: [
          item("user-1", 10, { kind: "user", text: "go" }),
          item("assistant-1", 41, { kind: "assistant", text: "两边都提交了。" })
        ],
        current: [
          item("user-1", 10, { kind: "user", text: "go" }),
          item("assistant-1", 41, { kind: "assistant", text: "两边都提交了。" }),
          item("error-old-run.failed", 99, {
            kind: "error",
            text: "stream disconnected before completion: stream closed before response.completed"
          })
        ],
        historyExpanded: false
      }).map((entry) => entry.id)
    ).toEqual(["user-1", "assistant-1"]);
  });

  it("keeps a current-turn stream error that still has no later assistant", () => {
    expect(
      mergeSessionTimeline({
        historical: [item("user-2", 50, { kind: "user", text: "retry" })],
        current: [
          item("user-2", 50, { kind: "user", text: "retry" }),
          item("error-new-run.failed", 60, {
            kind: "error",
            text: "stream disconnected before completion: stream closed before response.completed"
          })
        ],
        historyExpanded: false
      }).map((entry) => entry.id)
    ).toEqual(["user-2", "error-new-run.failed"]);
  });

  it("coalesces duplicate live and historical plan cards", () => {
    const merged = mergeSessionTimeline({
      historical: [
        item("tool-r1-plan-a", 20, {
          kind: "tool",
          data: {
            tool: "update_plan",
            status: "in_progress",
            items: [
              { text: "Inspect reports", status: "pending" },
              { text: "Add summary", status: "pending" }
            ]
          }
        })
      ],
      current: [
        item("tool-r1-plan-b", 21, {
          kind: "tool",
          data: {
            tool: "update_plan",
            status: "in_progress",
            items: [
              { text: "Inspect reports", status: "completed" },
              { text: "Add summary", status: "pending" }
            ]
          }
        })
      ],
      historyExpanded: false
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.data).toMatchObject({
      items: [
        { text: "Inspect reports", status: "completed" },
        { text: "Add summary", status: "pending" }
      ]
    });
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
    expect(result).toHaveLength(LIVE_TIMELINE_TAIL_ITEMS);
    expect(result[0]?.id).toBe(`m-${200 - LIVE_TIMELINE_TAIL_ITEMS}`);
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

  it("keeps the default live window small enough for long-running chats", () => {
    const items = Array.from({ length: LIVE_TIMELINE_TAIL_ITEMS + 40 }, (_, index) =>
      item(`item-${index}`, index, { kind: "assistant", text: "ok" })
    );
    const result = capTimelineEvents(items);
    expect(result).toHaveLength(LIVE_TIMELINE_TAIL_ITEMS);
    expect(result[0]?.id).toBe("item-40");
    expect(LIVE_TIMELINE_MAX_CHARS).toBeLessThanOrEqual(480_000);
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

describe("capPausedTimelineEvents", () => {
  it("keeps the latest page when older history is already loaded", () => {
    const older = Array.from({ length: HISTORY_TIMELINE_MAX_ITEMS }, (_, index) =>
      item(`old-${index}`, index)
    );
    const historical = [item("latest-user", 1000, { kind: "user" }), item("latest-assistant", 1001, { kind: "assistant", text: "done" })];
    const result = capPausedTimelineEvents([...older, ...historical], historical);
    expect(result.at(-1)?.id).toBe("latest-assistant");
    expect(result.some((entry) => entry.id === "latest-user")).toBe(true);
    expect(result[0]?.id).toBe("old-0");
  });
});

describe("capHistoryPreserveVisible", () => {
  it("does not drop the currently visible tail when prepending older pages", () => {
    const older = Array.from({ length: 40 }, (_, index) => item(`old-${index}`, index));
    const visible = [item("anchor", 100), item("latest", 101, { kind: "assistant", text: "done" })];
    const result = capHistoryPreserveVisible(older, visible);
    expect(result.at(-2)?.id).toBe("anchor");
    expect(result.at(-1)?.id).toBe("latest");
    expect(result[0]?.id).toBe("old-0");
  });
});

describe("plan and stream-error cleanup", () => {
  it("merges duplicate plan cards that share the same steps", () => {
    const result = coalesceDuplicatePlanItems([
      item("plan-a", 1, {
        kind: "tool",
        data: {
          tool: "update_plan",
          status: "in_progress",
          items: [
            { text: "Inspect reports", status: "completed" },
            { text: "Add summary", status: "pending" }
          ]
        }
      }),
      item("plan-b", 2, {
        kind: "tool",
        data: {
          tool: "update_plan",
          status: "in_progress",
          items: [
            { text: "Inspect reports", status: "pending" },
            { text: "Add summary", status: "pending" }
          ]
        }
      })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("plan-a");
    expect(planItemsCompleted(result[0]?.data)).toBe(1);
  });

  it("hides a recovered stream error that sits after a later assistant card", () => {
    const result = hideSupersededStreamErrors([
      item("assistant-1", 41, { kind: "assistant", text: "ok" }),
      item("error-1", 32, {
        kind: "error",
        text: "stream disconnected before completion: stream closed before response.completed"
      })
    ]);
    expect(result.map((entry) => entry.id)).toEqual(["assistant-1"]);
  });

  it("still shows stream errors in folded view until a later assistant exists", () => {
    const items = [
      item("user-1", 10, { kind: "user", text: "go" }),
      item("error-1", 20, {
        kind: "error",
        text: "stream disconnected before completion: stream closed before response.completed"
      })
    ];
    expect(displayTimelineEvents(items, "folded").map((entry) => entry.id)).toEqual([
      "user-1",
      "error-1"
    ]);
  });
});

function planItemsCompleted(data: unknown) {
  const record = data && typeof data === "object" ? (data as { items?: Array<{ status?: string }> }) : null;
  return record?.items?.filter((item) => item.status === "completed").length ?? 0;
}
