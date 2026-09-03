import { describe, expect, it } from "vitest";
import {
  isDeferredLiveTimelineEvent,
  isStreamProgressEvent,
  liveFollowActionFromScroll,
  shouldPauseLiveFollowFromKey,
  shouldPauseLiveFollowFromPointer,
  shouldPauseLiveFollowFromWheel
} from "./live-follow";

describe("live timeline event filters", () => {
  it("defers realtime rows while the user is reading history", () => {
    expect(isDeferredLiveTimelineEvent("assistant.delta")).toBe(true);
    expect(isDeferredLiveTimelineEvent("tool.output")).toBe(true);
    expect(isDeferredLiveTimelineEvent("run.failed")).toBe(true);
    expect(isDeferredLiveTimelineEvent("user.message")).toBe(true);
    expect(isDeferredLiveTimelineEvent("turn.completed")).toBe(false);
  });

  it("treats stream tokens as in-flight progress without counting terminal run events", () => {
    expect(isStreamProgressEvent("reasoning.delta")).toBe(true);
    expect(isStreamProgressEvent("approval.requested")).toBe(true);
    expect(isStreamProgressEvent("run.failed")).toBe(false);
  });
});

describe("live follow gestures", () => {
  it("pauses only on intentional upward movement", () => {
    expect(shouldPauseLiveFollowFromWheel(-12)).toBe(true);
    expect(shouldPauseLiveFollowFromWheel(12)).toBe(false);
    expect(shouldPauseLiveFollowFromKey("ArrowUp")).toBe(true);
    expect(shouldPauseLiveFollowFromKey("PageUp")).toBe(true);
    expect(shouldPauseLiveFollowFromKey("Home")).toBe(true);
    expect(shouldPauseLiveFollowFromKey("ArrowDown")).toBe(false);
    expect(
      shouldPauseLiveFollowFromPointer({
        clientY: 40,
        startClientY: 20,
        scrollTop: 400,
        startScrollTop: 400
      })
    ).toBe(true);
    expect(
      shouldPauseLiveFollowFromPointer({
        clientY: 20,
        startClientY: 20,
        scrollTop: 380,
        startScrollTop: 400
      })
    ).toBe(true);
    expect(
      shouldPauseLiveFollowFromPointer({
        clientY: 18,
        startClientY: 20,
        scrollTop: 400,
        startScrollTop: 400
      })
    ).toBe(false);
  });

  it("does not treat layout-generated scroll as leaving the live tail", () => {
    expect(
      liveFollowActionFromScroll({
        atBottom: false,
        following: true,
        previousTop: 800,
        nextTop: 120,
        pointerActive: false
      })
    ).toBe("keep");
  });

  it("pauses on pointer-driven upward scroll and resumes after scrolling back down", () => {
    expect(
      liveFollowActionFromScroll({
        atBottom: false,
        following: true,
        previousTop: 800,
        nextTop: 120,
        pointerActive: true
      })
    ).toBe("pause");
    expect(
      liveFollowActionFromScroll({
        atBottom: true,
        following: false,
        previousTop: 40,
        nextTop: 80,
        pointerActive: false
      })
    ).toBe("resume");
  });
});
