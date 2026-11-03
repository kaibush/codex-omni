import { describe, expect, it } from "vitest";
import { nativeRewindBoundary, type NativeTurn } from "./thread-rewind.js";

function turn(id: string, user: string, answer: string): NativeTurn {
  return {
    id,
    status: "completed",
    items: [
      { id: `${id}-u`, type: "userMessage", content: [{ type: "text", text: user }] },
      { id: `${id}-a`, type: "agentMessage", text: answer }
    ]
  };
}
const message = (id: string, role: string, content: string) => ({ id, role, content });

describe("native rewind boundaries", () => {
  it("maps repeated requests and replies to their original occurrences", () => {
    const turns = [turn("t1", "continue", "done"), turn("t2", "continue", "done")];
    const messages = [
      message("u1", "user", "continue"),
      message("a1", "assistant", "done"),
      message("u2", "user", "continue"),
      message("a2", "assistant", "done")
    ];
    expect(nativeRewindBoundary(turns, messages, "u1")).toBe(0);
    expect(nativeRewindBoundary(turns, messages, "a1")).toBe(1);
    expect(nativeRewindBoundary(turns, messages, "u2")).toBe(1);
    expect(nativeRewindBoundary(turns, messages, "a2")).toBe(2);
  });

  it("does not mistake copied snapshot text for an actual native message", () => {
    const turns = [turn("t1", "<fork-history>OLD REQUEST</fork-history>\nNEW REQUEST", "done")];
    const messages = [
      message("old", "user", "OLD REQUEST"),
      message("new", "user", "NEW REQUEST"),
      message("answer", "assistant", "done")
    ];
    expect(() => nativeRewindBoundary(turns, messages, "old")).toThrow("精确定位");
    expect(() => nativeRewindBoundary(turns, messages, "new")).toThrow("旧分叉快照");
  });

  it("refuses a repeated request which never reached the native thread", () => {
    const turns = [turn("t1", "same", "done")];
    const messages = [
      message("u1", "user", "same"),
      message("a1", "assistant", "done"),
      message("unsent", "user", "same")
    ];
    expect(() => nativeRewindBoundary(turns, messages, "unsent")).toThrow("精确对齐");
  });

  it("refuses a reply that streamed across the visual rewind position", () => {
    const turns = [turn("t1", "first", "done"), turn("t2", "second", "done")];
    const messages = [
      message("u1", "user", "first"),
      { ...message("a1", "assistant", "done"), updatedAt: 5 },
      { ...message("u2", "user", "second"), createdAt: 4 },
      message("a2", "assistant", "done")
    ];
    expect(() => nativeRewindBoundary(turns, messages, "u2")).toThrow("精确对齐");
  });

  it("uses the real runtime input for automatic recovery and project instructions", () => {
    const turns = [turn("t1", "RULES\nRETRY THE ORIGINAL REQUEST", "done")];
    const messages = [
      {
        ...message("retry", "user", "自动复核"),
        dataJson: JSON.stringify({ runtimeMessage: "RULES\nRETRY THE ORIGINAL REQUEST" })
      }
    ];
    expect(nativeRewindBoundary(turns, messages, "retry")).toBe(0);
  });

  it("refuses intermediate assistant replies and active turns instead of retaining later work", () => {
    const source = turn("t1", "request", "intermediate");
    source.items.push({ id: "tool", type: "commandExecution" });
    expect(() =>
      nativeRewindBoundary([source], [message("a", "assistant", "intermediate")], "a")
    ).toThrow("同轮执行记录");
    source.status = "inProgress";
    expect(() => nativeRewindBoundary([source], [message("u", "user", "request")], "u")).toThrow(
      "先停止"
    );
  });

  it("refuses to move before an earlier input when steering shares the native turn", () => {
    const source = turn("t1", "request", "done");
    source.items.push({
      id: "steer",
      type: "userMessage",
      content: [{ type: "text", text: "steered" }]
    });
    expect(() => nativeRewindBoundary([source], [message("u", "user", "steered")], "u")).toThrow(
      "第一条用户消息"
    );
  });
});
