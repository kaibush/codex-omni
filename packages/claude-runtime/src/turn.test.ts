import { describe, expect, it, vi } from "vitest";
import type { Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { bridgeRequestSchema, type BridgeEvent } from "@codex-omni/protocol";
import { ClaudeTurn } from "./turn.js";

const request = bridgeRequestSchema.parse({
  protocolVersion: 1,
  requestId: "run",
  projectId: "project",
  sessionId: "session",
  clientType: "claude-code",
  cwd: "/tmp",
  runtimeKey: "provider",
  runtimeHome: "/tmp/claude",
  message: "start",
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  networkAccessEnabled: true
});
const result = {
  type: "result",
  subtype: "success",
  session_id: "native",
  result: "done",
  uuid: "result"
} as unknown as SDKMessage;

describe("Claude turn lifecycle", () => {
  it("always asks interactive questions in bypass mode and passes human answers back to the tool", async () => {
    let options!: Options;
    const events: BridgeEvent[] = [];
    const close = vi.fn();
    const create = vi.fn((input: { options?: Options }) => {
      options = input.options!;
      return {
        close,
        async *[Symbol.asyncIterator]() {
          const hook = options.hooks!.PreToolUse![0]!.hooks[0]!;
          const response = await hook(
            {
              hook_event_name: "PreToolUse",
              tool_name: "AskUserQuestion",
              tool_use_id: "ask",
              tool_input: { questions: [{ question: "Choice?" }] },
              session_id: "native",
              transcript_path: "/tmp/transcript",
              cwd: "/tmp"
            },
            "ask",
            { signal: new AbortController().signal }
          );
          expect(response).toMatchObject({
            hookSpecificOutput: {
              permissionDecision: "allow",
              updatedInput: { answers: { "Choice?": "Human answer" } }
            }
          });
          yield result;
        }
      } as unknown as Query;
    });
    const turn = new ClaudeTurn(
      { ...request, claude: { permissionMode: "bypassPermissions" } },
      (event) => {
        events.push(event);
        if (event.type === "approval.requested")
          turn.respond((event.payload as any).approvalId, {
            decision: "accept",
            answers: { "Choice?": "Human answer" }
          });
      },
      create
    );
    await turn.run();
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(events.some((event) => event.type === "approval.requested")).toBe(true);
    expect(events.at(-1)?.type).toBe("turn.completed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("releases pending permission callbacks on cancel and does not report completion", async () => {
    const events: BridgeEvent[] = [];
    const create = vi.fn(
      ({ options }: { options?: Options }) =>
        ({
          close: vi.fn(),
          async *[Symbol.asyncIterator]() {
            const permission = await options!.canUseTool!(
              "Bash",
              { command: "echo pending" },
              {
                signal: options!.abortController!.signal,
                toolUseID: "bash",
                requestId: "permission"
              }
            );
            expect(permission).toMatchObject({ behavior: "deny", interrupt: true });
            yield result;
          }
        }) as unknown as Query
    );
    const turn = new ClaudeTurn(
      request,
      (event) => {
        events.push(event);
        if (event.type === "approval.requested") turn.cancel();
      },
      create
    );
    await turn.run();
    expect(events.some((event) => event.type === "turn.completed")).toBe(false);
    expect(await turn.steer("too late")).toBe(false);
  });

  it("continues draining a background subagent before publishing terminal completion", async () => {
    const events: BridgeEvent[] = [];
    let stopped = false;
    const create = vi.fn(
      () =>
        ({
          close: vi.fn(),
          stopTask: vi.fn(async () => {
            stopped = true;
          }),
          async *[Symbol.asyncIterator]() {
            yield {
              type: "system",
              subtype: "task_started",
              session_id: "native",
              task_id: "background",
              tool_use_id: "agent",
              description: "Review"
            };
            yield result;
            await turn.stopTask("background");
            yield {
              type: "system",
              subtype: "task_notification",
              session_id: "native",
              task_id: "background",
              status: "stopped",
              summary: "Stopped by user"
            };
          }
        }) as unknown as Query
    );
    const turn = new ClaudeTurn(request, (event) => events.push(event), create);
    await turn.run();
    expect(stopped).toBe(true);
    expect(events.at(-2)?.payload).toMatchObject({ taskId: "background", status: "stopped" });
    expect(events.at(-1)?.type).toBe("turn.completed");
  });
});
