const STREAM_PROGRESS_EVENT_TYPES = new Set([
  "reasoning.delta",
  "assistant.delta",
  "assistant.completed",
  "tool.started",
  "tool.output",
  "file.change",
  "approval.requested"
]);

const DEFERRED_LIVE_EVENT_TYPES = new Set([
  ...STREAM_PROGRESS_EVENT_TYPES,
  "run.failed",
  "user.message"
]);

export function isStreamProgressEvent(type: string) {
  return STREAM_PROGRESS_EVENT_TYPES.has(type);
}

export function isDeferredLiveTimelineEvent(type: string) {
  return DEFERRED_LIVE_EVENT_TYPES.has(type);
}

export function shouldPauseLiveFollowFromWheel(deltaY: number) {
  return deltaY < 0;
}

export function shouldPauseLiveFollowFromKey(key: string) {
  return key === "ArrowUp" || key === "PageUp" || key === "Home";
}

export function shouldPauseLiveFollowFromPointer(input: {
  clientY: number;
  startClientY: number;
  scrollTop: number;
  startScrollTop: number;
}) {
  return input.clientY > input.startClientY + 6 || input.scrollTop < input.startScrollTop - 2;
}

export function liveFollowActionFromScroll(input: {
  atBottom: boolean;
  following: boolean;
  previousTop: number;
  nextTop: number;
  pointerActive: boolean;
}): "pause" | "resume" | "keep" {
  if (input.atBottom && !input.following && input.nextTop >= input.previousTop) return "resume";
  if (!input.atBottom && input.pointerActive && input.nextTop < input.previousTop - 1)
    return "pause";
  return "keep";
}
