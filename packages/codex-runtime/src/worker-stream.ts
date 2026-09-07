import { firstUsefulFailureMessage, type BridgeEvent } from "@codex-omni/protocol";
import type { ThreadEvent } from "@openai/codex-sdk";

export const INCOMPLETE_TURN_MESSAGE = "Codex 流在 turn.completed 前结束，任务未完成";

export type MappedStreamState = {
  completed: boolean;
  failed: boolean;
  lastFailureMessage: string;
};

function eventMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  const message = record.reason ?? record.message;
  return typeof message === "string" ? message.trim() : "";
}

export function createMappedStreamState(): MappedStreamState {
  return { completed: false, failed: false, lastFailureMessage: "" };
}

export function observeMappedEvent(
  state: MappedStreamState,
  mapped: { type: string; payload?: unknown }
) {
  const payload = (mapped.payload ?? {}) as Record<string, unknown>;
  const message = firstUsefulFailureMessage(
    payload.reason,
    payload.message,
    payload.error,
    eventMessage(payload)
  );
  if (mapped.type === "turn.completed") state.completed = true;
  else if (mapped.type === "run.failed") {
    state.completed = false;
    state.failed = true;
    if (message) state.lastFailureMessage = message;
  } else if (mapped.type === "run.reconnecting" && message) {
    state.lastFailureMessage = message;
  } else if (mapped.type === "tool.output" && payload.tool === "runtime_error" && message) {
    state.lastFailureMessage = message;
  }
}

export function incompleteStreamError(state: MappedStreamState): Error | null {
  if (state.completed || state.failed) return null;
  return new Error(INCOMPLETE_TURN_MESSAGE);
}

export function workerExitError(input: {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  sawTerminalEvent: boolean;
  failed?: boolean;
  failureMessage?: string;
}): Error | null {
  if (input.code === 0 && !input.signal && !input.failed) {
    if (!input.sawTerminalEvent) return new Error(INCOMPLETE_TURN_MESSAGE);
    return null;
  }
  return new Error(
    firstUsefulFailureMessage(input.failureMessage, input.stderr) ||
      (input.signal
        ? `Bridge worker exited with signal ${input.signal}`
        : `Bridge worker exited with ${input.code}`)
  );
}

export function isTerminalBridgeEvent(type: string) {
  return type === "turn.completed" || type === "run.failed";
}

export async function consumeCodexEventStream(input: {
  events: AsyncIterable<ThreadEvent>;
  state?: MappedStreamState;
  map: (event: ThreadEvent) => BridgeEvent[];
  onSdkEvent?: (event: ThreadEvent) => Promise<void> | void;
  onMappedEvent: (mapped: BridgeEvent, sdkEvent: ThreadEvent) => void | Promise<void>;
}): Promise<MappedStreamState> {
  // Keep the caller's state current even if the SDK throws while draining stdout.
  const state = input.state ?? createMappedStreamState();
  for await (const event of input.events) {
    if (state.completed && event.type !== "turn.failed" && event.type !== "error") continue;
    await input.onSdkEvent?.(event);
    for (const mapped of input.map(event)) {
      observeMappedEvent(state, mapped);
      await input.onMappedEvent(mapped, event);
    }
    // A fatal event is terminal. Closing the SDK iterator also reaps its process.
    if (state.failed) break;
  }
  return state;
}
