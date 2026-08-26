import { describe, expect, it } from "vitest";
import { shouldContinueWithProvider, timelineHasConversation } from "./provider-continuation";

describe("shouldContinueWithProvider", () => {
  it("does not prompt for a new empty session", () => {
    expect(
      shouldContinueWithProvider({
        sessionProviderId: "provider-a",
        selectedProviderId: "provider-b",
        hasConversation: false
      })
    ).toBe(false);
  });

  it("prompts only after the session already has conversation content", () => {
    expect(
      shouldContinueWithProvider({
        sessionProviderId: "provider-a",
        selectedProviderId: "provider-b",
        hasConversation: true
      })
    ).toBe(true);
  });
});

describe("timelineHasConversation", () => {
  it("ignores system and tool events", () => {
    expect(timelineHasConversation([{ kind: "system" }, { kind: "tool" }])).toBe(false);
    expect(timelineHasConversation([{ kind: "user" }])).toBe(true);
  });
});
