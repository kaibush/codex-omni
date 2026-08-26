import { describe, expect, it } from "vitest";
import { applyTextPatch, compactStreamEvent, textPatch, truncateToolText } from "./stream-patch.js";

describe("stream patches", () => {
  it("emits only the new suffix when text grows", () => {
    expect(textPatch("hel", "hello")).toEqual({ delta: "lo" });
    expect(textPatch("hello", "hi")).toEqual({ text: "hi" });
    expect(applyTextPatch("hel", { delta: "lo" })).toBe("hello");
    expect(applyTextPatch("hel", { text: "hi" })).toBe("hi");
  });

  it("drops accumulated text from compact delta events", () => {
    expect(
      compactStreamEvent({
        type: "assistant.delta",
        payload: { itemId: "a", delta: "lo", text: "hello" }
      }).payload
    ).toEqual({ itemId: "a", delta: "lo" });
  });

  it("truncates oversized tool output", () => {
    const result = truncateToolText("abcdefghij", 4);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith("abcd")).toBe(true);
    expect(result.text).toContain("truncated 6");
  });
});
