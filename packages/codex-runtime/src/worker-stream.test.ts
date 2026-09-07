import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@openai/codex-sdk";
import { createNormalizer } from "./normalizer.js";
import {
  consumeCodexEventStream,
  createMappedStreamState,
  INCOMPLETE_TURN_MESSAGE,
  incompleteStreamError,
  workerExitError
} from "./worker-stream.js";

const request = {
  protocolVersion: 1 as const,
  requestId: "r",
  projectId: "p",
  sessionId: "s",
  cwd: "/tmp",
  runtimeKey: "k",
  codexHome: "/tmp/home",
  message: "hi",
  sandbox: "workspace-write" as const,
  approvalPolicy: "never" as const,
  networkAccessEnabled: true
};

async function* events(...items: ThreadEvent[]) {
  for (const item of items) yield item;
}

describe("worker stream terminal state", () => {
  it("treats unexpected EOF without turn.completed as an incomplete turn", async () => {
    const normalizer = createNormalizer(request);
    const mapped: string[] = [];
    const state = await consumeCodexEventStream({
      events: events({
        type: "item.completed",
        item: { id: "a", type: "agent_message", text: "partial" }
      }),
      map: (event) => normalizer.map(event),
      onMappedEvent: (event) => {
        mapped.push(event.type);
      }
    });
    expect(mapped).toContain("assistant.completed");
    expect(incompleteStreamError(state)?.message).toBe(INCOMPLETE_TURN_MESSAGE);
    expect(
      workerExitError({ code: 0, signal: null, stderr: "", sawTerminalEvent: false })?.message
    ).toBe(INCOMPLETE_TURN_MESSAGE);
  });

  it("accepts a completed stream and a failed stream as terminal", async () => {
    const completed = await consumeCodexEventStream({
      events: events({
        type: "turn.completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0
        }
      }),
      map: (event) => createNormalizer(request).map(event),
      onMappedEvent: () => undefined
    });
    expect(incompleteStreamError(completed)).toBeNull();
    expect(completed.completed).toBe(true);

    const failed = await consumeCodexEventStream({
      events: events({
        type: "turn.failed",
        error: { message: "upstream closed" }
      }),
      map: (event) => createNormalizer(request).map(event),
      onMappedEvent: () => undefined
    });
    expect(failed.failed).toBe(true);
    expect(incompleteStreamError(failed)).toBeNull();
    expect(
      workerExitError({ code: 0, signal: null, stderr: "", sawTerminalEvent: true })
    ).toBeNull();
  });

  it("retains the useful error if the iterator throws after a reconnect notice", async () => {
    const state = createMappedStreamState();
    const normalizer = createNormalizer(request);
    async function* brokenStream(): AsyncGenerator<ThreadEvent> {
      yield { type: "error", message: "Reconnecting... 1/5 (stream disconnected)" };
      throw new Error("Codex Exec exited with code 1: Reading prompt from stdin...");
    }
    await expect(
      consumeCodexEventStream({
        events: brokenStream(),
        state,
        map: (event) => normalizer.map(event),
        onMappedEvent: () => undefined
      })
    ).rejects.toThrow("Codex Exec exited");
    expect(state.lastFailureMessage).toBe("stream disconnected");
    expect(
      normalizer.failure(new Error("Bridge worker exited with 1"), state.lastFailureMessage).payload
    ).toMatchObject({ message: "stream disconnected" });
  });

  it("does not let a later completion overwrite a fatal event", async () => {
    const normalizer = createNormalizer(request);
    const mapped: string[] = [];
    const state = await consumeCodexEventStream({
      events: events(
        { type: "turn.failed", error: { message: "failed" } },
        { type: "turn.started" }
      ),
      map: (event) => normalizer.map(event),
      onMappedEvent: (event) => {
        mapped.push(event.type);
      }
    });
    expect(state.failed).toBe(true);
    expect(mapped).toEqual(["run.failed"]);
    expect(
      workerExitError({
        code: 0,
        signal: null,
        stderr: "",
        sawTerminalEvent: true,
        failed: true,
        failureMessage: "failed"
      })?.message
    ).toBe("failed");
  });
});
