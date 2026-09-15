import { describe, expect, it } from "vitest";
import {
  defaultOutlineOpen,
  findTimelineItemByMessageId,
  isCompactOutlineViewport,
  mergeSessionOutline,
  outlineTitleFromUserText
} from "./timeline-outline";
import type { TimelineItem } from "@/types";

describe("session outline helpers", () => {
  it("uses the first non-empty line as the question title", () => {
    expect(outlineTitleFromUserText("\n  把这段约束写到 AGENTS.md\n细节")).toBe(
      "把这段约束写到 AGENTS.md"
    );
    expect(outlineTitleFromUserText("")).toBe("消息");
  });

  it("keeps the outline closed on compact viewports", () => {
    expect(isCompactOutlineViewport(390)).toBe(true);
    expect(isCompactOutlineViewport(768)).toBe(false);
    expect(defaultOutlineOpen({ width: 390, height: 844, saved: "open" })).toBe(false);
    expect(defaultOutlineOpen({ width: 1600, height: 900, saved: "open" })).toBe(true);
    expect(defaultOutlineOpen({ width: 1600, height: 900, saved: "closed" })).toBe(false);
    expect(defaultOutlineOpen({ width: 1600, height: 900, saved: null })).toBe(true);
    expect(defaultOutlineOpen({ width: 1280, height: 800, saved: null })).toBe(false);
  });

  it("merges live user messages into the full outline", () => {
    const items = mergeSessionOutline(
      [{ id: "u1", title: "旧问题", createdAt: 1 }],
      [
        { id: "u1", kind: "user", messageId: "u1", text: "旧问题", createdAt: 1 },
        { id: "assistant-1", kind: "assistant", text: "回复", createdAt: 2 },
        { id: "u2", kind: "user", messageId: "u2", text: "新问题", createdAt: 3 }
      ] as TimelineItem[]
    );
    expect(items.map((item) => item.id)).toEqual(["u1", "u2"]);
    expect(items[1]?.title).toBe("新问题");
  });

  it("finds a timeline item by message id", () => {
    const events = [
      { id: "user-1", messageId: "msg-1", kind: "user", text: "hi" },
      { id: "assistant-req-item", kind: "assistant", text: "ok" }
    ] as TimelineItem[];
    expect(findTimelineItemByMessageId(events, "msg-1")?.id).toBe("user-1");
    expect(findTimelineItemByMessageId(events, "item")?.id).toBe("assistant-req-item");
    expect(findTimelineItemByMessageId(events, "missing")).toBeUndefined();
  });
});
