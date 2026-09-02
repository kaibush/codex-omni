import { describe, expect, it } from "vitest";
import {
  authStatusSchema,
  eventSchema,
  filesystemBrowseSchema,
  firstUsefulFailureMessage,
  isGenericCodexExecError,
  normalizeProviderHomeMode,
  parseReconnectNotice,
  providerInputSchema,
  runCommandSchema,
  sanitizeCodexExecError,
  sessionSchema
} from "./index.js";

describe("protocol", () => {
  it("recognizes Codex automatic reconnect notices", () => {
    expect(
      parseReconnectNotice(
        "Reconnecting... 4/5 (stream disconnected before completion: stream closed before response.completed)"
      )
    ).toEqual({
      message:
        "Reconnecting... 4/5 (stream disconnected before completion: stream closed before response.completed)",
      attempt: 4,
      maxAttempts: 5,
      reason: "stream disconnected before completion: stream closed before response.completed"
    });
    expect(parseReconnectNotice("request failed permanently")).toBeNull();
  });
  it("strips Codex exec stdin banners and keeps the real error", () => {
    const banner = "Codex Exec exited with code 1: Reading prompt from stdin...\n";
    expect(isGenericCodexExecError(banner)).toBe(true);
    expect(isGenericCodexExecError("Reading prompt from stdin...")).toBe(true);
    expect(
      isGenericCodexExecError(
        "Codex Exec exited with code 1: Reading prompt from stdin...\nNo prompt provided via stdin."
      )
    ).toBe(false);
    expect(
      sanitizeCodexExecError(
        banner,
        "stream disconnected before completion: stream closed before response.completed"
      )
    ).toBe("stream disconnected before completion: stream closed before response.completed");
    expect(
      sanitizeCodexExecError(
        "Codex Exec exited with code 1: Reading prompt from stdin...\nNo prompt provided via stdin."
      )
    ).toBe("No prompt provided via stdin.");
    expect(sanitizeCodexExecError(banner)).toBe("Codex 进程异常退出（code 1），未返回具体错误信息");
    expect(sanitizeCodexExecError("request failed permanently")).toBe("request failed permanently");
    expect(
      firstUsefulFailureMessage(
        "Reading prompt from stdin...",
        "Codex Exec exited with code 1: Reading prompt from stdin...",
        "401 Unauthorized: invalid API key"
      )
    ).toBe("401 Unauthorized: invalid API key");
    expect(isGenericCodexExecError("Bridge worker exited with 1")).toBe(true);
    expect(
      sanitizeCodexExecError("Bridge worker exited with 1", "401 Unauthorized: invalid API key")
    ).toBe("401 Unauthorized: invalid API key");
    expect(sanitizeCodexExecError("Bridge worker exited with 1")).toBe(
      "Codex 进程异常退出，未返回具体错误信息"
    );
    expect(
      sanitizeCodexExecError("Reading prompt from stdin...", "model grok-4.6 does not exist")
    ).toBe("model grok-4.6 does not exist");
  });
  it("accepts a non-terminal reconnect event", () => {
    expect(
      eventSchema.parse({
        protocolVersion: 1,
        requestId: "request-1",
        projectId: "project-1",
        sessionId: "session-1",
        seq: 2,
        type: "run.reconnecting",
        payload: { status: "running", attempt: 2, maxAttempts: 5 }
      }).type
    ).toBe("run.reconnecting");
  });
  it("accepts provider switch retry", () => {
    const command = runCommandSchema.parse({
      type: "run.retry",
      projectId: "p",
      sessionId: "s",
      message: "retry",
      providerId: "other"
    });
    expect(command.type).toBe("run.retry");
    if (command.type === "run.retry") expect(command.providerId).toBe("other");
  });
  it("accepts a session subscribe command after reconnect", () => {
    expect(runCommandSchema.parse({ type: "session.subscribe", sessionId: "session-1" })).toEqual({
      type: "session.subscribe",
      sessionId: "session-1"
    });
  });
  it("accepts an idempotent queued turn and replay cursor", () => {
    expect(
      runCommandSchema.parse({
        type: "turn.enqueue",
        clientId: "client-1",
        projectId: "project-1",
        sessionId: "session-1",
        message: "next"
      })
    ).toMatchObject({ type: "turn.enqueue", clientId: "client-1" });
    expect(
      runCommandSchema.parse({
        type: "session.subscribe",
        sessionId: "session-1",
        lastRequestId: "run-1",
        lastSeq: 42
      })
    ).toMatchObject({ lastRequestId: "run-1", lastSeq: 42 });
  });
  it("accepts a queued turn move command", () => {
    expect(
      runCommandSchema.parse({
        type: "queue.move",
        sessionId: "session-1",
        queueId: "queue-2",
        direction: "up"
      })
    ).toMatchObject({ type: "queue.move", direction: "up" });
  });
  it("accepts a session-scoped approval response", () => {
    expect(
      runCommandSchema.parse({
        type: "approval.respond",
        sessionId: "session-1",
        requestId: "approval-1",
        decision: "acceptForSession"
      })
    ).toMatchObject({ type: "approval.respond", sessionId: "session-1" });
  });
  it("accepts terminal session states and continuation metadata", () => {
    expect(
      sessionSchema.parse({
        id: "session-1",
        projectId: "project-1",
        threadId: null,
        title: "History",
        status: "interrupted",
        providerId: null,
        parentSessionId: "session-0",
        continuationMode: "portable-context",
        lastMessageAt: 1,
        createdAt: 1,
        updatedAt: 2
      })
    ).toMatchObject({ status: "interrupted", parentSessionId: "session-0" });
  });
  it("accepts auth bootstrap and filesystem browse payloads", () => {
    expect(authStatusSchema.parse({ setupRequired: true })).toEqual({ setupRequired: true });
    expect(
      filesystemBrowseSchema.parse({
        path: "/root",
        parent: "/",
        roots: [{ name: "/", path: "/" }],
        breadcrumbs: [
          { name: "/", path: "/" },
          { name: "root", path: "/root" }
        ],
        entries: [{ name: "project", path: "/root/project", readable: true, symlink: false }]
      }).entries
    ).toHaveLength(1);
  });
  it("normalizes provider home modes and accepts api-key input", () => {
    expect(normalizeProviderHomeMode(null)).toBe("managed");
    expect(normalizeProviderHomeMode("external")).toBe("external");
    expect(
      providerInputSchema.parse({
        name: "Work",
        homeMode: "api-key",
        apiKey: "sk-test",
        model: "gpt-5"
      }).homeMode
    ).toBe("api-key");
  });
});
