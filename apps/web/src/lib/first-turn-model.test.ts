/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  FIRST_TURN_CONFIRMED_KEY,
  firstTurnPromptKind,
  loadConfirmedFirstTurns,
  rememberConfirmedFirstTurn,
  sessionHasUserMessage
} from "./first-turn-model";

afterEach(() => {
  sessionStorage.clear();
});

describe("firstTurnPromptKind", () => {
  it("prompts on the first send of a new, forked, or continued session", () => {
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: null,
        hasUserMessage: false,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBe("new");
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: "fork",
        hasUserMessage: true,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBe("fork");
    expect(
      firstTurnPromptKind({
        threadId: "",
        continuationMode: "portable-context",
        hasUserMessage: false,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBe("continue");
  });

  it("does not prompt after the thread starts, a user turn exists, or the choice was confirmed", () => {
    expect(
      firstTurnPromptKind({
        threadId: "thread-1",
        continuationMode: null,
        hasUserMessage: false,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBeNull();
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: null,
        hasUserMessage: true,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBeNull();
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: "portable-context",
        hasUserMessage: true,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBeNull();
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: "fork",
        hasUserMessage: true,
        confirmed: true,
        hasPendingTurn: false
      })
    ).toBeNull();
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: "fork",
        hasUserMessage: false,
        confirmed: false,
        hasPendingTurn: true
      })
    ).toBeNull();
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: "fork",
        hasUserMessage: true,
        confirmed: false,
        hasPendingTurn: false,
        hasStartedTurn: true
      })
    ).toBeNull();
  });

  it("ignores terminal chats and unknown continuation modes that already started", () => {
    expect(
      firstTurnPromptKind({
        sessionKind: "terminal-chat",
        threadId: null,
        continuationMode: null,
        hasUserMessage: false,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBeNull();
    expect(
      firstTurnPromptKind({
        threadId: null,
        continuationMode: "other",
        hasUserMessage: false,
        confirmed: false,
        hasPendingTurn: false
      })
    ).toBeNull();
  });
});

describe("confirmed first turns", () => {
  it("remembers the session until the browser session storage is cleared", () => {
    const confirmed = rememberConfirmedFirstTurn("session-1");
    expect(confirmed.has("session-1")).toBe(true);
    expect(loadConfirmedFirstTurns().has("session-1")).toBe(true);
    expect(sessionStorage.getItem(FIRST_TURN_CONFIRMED_KEY)).toContain("session-1");
  });

  it("ignores malformed storage", () => {
    sessionStorage.setItem(FIRST_TURN_CONFIRMED_KEY, "nope");
    expect(loadConfirmedFirstTurns().size).toBe(0);
  });
});

describe("sessionHasUserMessage", () => {
  it("checks the visible timeline and the loaded message page", () => {
    expect(sessionHasUserMessage([{ kind: "system" }], [{ role: "system" }])).toBe(false);
    expect(sessionHasUserMessage([{ kind: "user" }], [])).toBe(true);
    expect(sessionHasUserMessage([], [{ role: "user" }])).toBe(true);
  });
});
