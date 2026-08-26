import { describe, expect, it } from "vitest";
import { compactTimelineEvents, mergeSessionTimeline } from "./timeline";
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
});
