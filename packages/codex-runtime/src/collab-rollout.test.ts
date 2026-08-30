import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCollabRolloutTailer,
  extractRolloutToolEvents,
  findRolloutFile,
  parseCollabRolloutLine
} from "./collab-rollout.js";

describe("parseCollabRolloutLine", () => {
  it("maps spawn_agent function calls", () => {
    const pending = new Map<string, string>();
    const started = parseCollabRolloutLine(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "call-spawn-1",
          arguments: JSON.stringify({
            message: "Query the current date",
            fork_context: false
          })
        }
      }),
      pending
    );
    expect(started).toMatchObject({
      itemId: "call-spawn-1",
      tool: "spawn_agent",
      phase: "started",
      prompt: "Query the current date",
      status: "in_progress"
    });
    const completed = parseCollabRolloutLine(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: "agent-1", nickname: "Ramanujan" })
        }
      }),
      pending
    );
    expect(completed).toMatchObject({
      itemId: "call-spawn-1",
      tool: "spawn_agent",
      phase: "completed",
      nickname: "Ramanujan",
      receiverThreadIds: ["agent-1"]
    });
  });

  it("recovers view_image, write_stdin, and request_user_input", () => {
    const pending = new Map<string, string>();
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "view_image",
            call_id: "call-image-1",
            arguments: JSON.stringify({ path: "/tmp/shot.png" })
          }
        }),
        pending
      )
    ).toMatchObject({
      itemId: "call-image-1",
      tool: "view_image",
      phase: "started",
      input: { path: "/tmp/shot.png" }
    });
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "write_stdin",
            call_id: "call-stdin-1",
            arguments: JSON.stringify({
              session_id: "pty-1",
              chars: "ls\n",
              yield_time_ms: 250
            })
          }
        }),
        pending
      )
    ).toMatchObject({
      itemId: "call-stdin-1",
      tool: "write_stdin",
      phase: "started",
      input: {
        session_id: "pty-1",
        sessionId: "pty-1",
        chars: "ls\n",
        text: "ls\n",
        yield_time_ms: 250
      }
    });
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "request_user_input",
            call_id: "call-ask-1",
            arguments: JSON.stringify({
              questions: [{ header: "Scope", id: "scope", question: "Which accounts?" }]
            })
          }
        }),
        pending
      )
    ).toMatchObject({
      itemId: "call-ask-1",
      tool: "request_user_input",
      phase: "started",
      input: {
        questions: [{ header: "Scope", id: "scope", question: "Which accounts?" }]
      }
    });
  });

  it("recovers context_compacted event_msg as a completed tool", () => {
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "event_msg",
          payload: { type: "context_compacted" }
        }),
        new Map(),
        2048
      )
    ).toMatchObject({
      itemId: "context-compacted-2048",
      tool: "context_compacted",
      phase: "completed",
      status: "completed"
    });
  });

  it("ignores PTY wait function calls", () => {
    const pending = new Map<string, string>();
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "wait",
            call_id: "call-pty-wait",
            arguments: JSON.stringify({ cell_id: "none", yield_time_ms: 1 })
          }
        }),
        pending
      )
    ).toBeNull();
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-pty-wait",
            output: "ok"
          }
        }),
        pending
      )
    ).toBeNull();
  });

  it("ignores update_plan and other non-collab tools", () => {
    const pending = new Map<string, string>();
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call", name: "update_plan", call_id: "call-plan" }
        }),
        pending
      )
    ).toBeNull();
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", call_id: "call-plan", output: "Plan updated" }
        }),
        pending
      )
    ).toBeNull();
  });
});

describe("createCollabRolloutTailer", () => {
  it("reads only new collab lines from the rollout file", () => {
    const home = path.join(os.tmpdir(), `codex-omni-rollout-${Date.now()}`);
    const dir = path.join(home, "sessions", "2026", "08", "30");
    mkdirSync(dir, { recursive: true });
    const threadId = "01a0511e-520f-7ab2-b4c3-d00831a8d045";
    const file = path.join(dir, `rollout-2026-08-30T05-22-16-${threadId}.jsonl`);
    writeFileSync(
      file,
      `${JSON.stringify({
        type: "response_item",
        payload: { type: "function_call", name: "update_plan", call_id: "old" }
      })}\n`
    );
    expect(findRolloutFile(home, threadId)).toBe(file);
    const tailer = createCollabRolloutTailer(home);
    tailer.setThreadId(threadId);
    expect(tailer.flush()).toEqual([]);
    writeFileSync(
      file,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "wait_agent",
          call_id: "call-wait-1",
          arguments: JSON.stringify({ targets: [threadId] })
        }
      })}\n`,
      { flag: "a" }
    );
    expect(tailer.flush()).toMatchObject([
      {
        itemId: "call-wait-1",
        tool: "wait_agent",
        phase: "started",
        receiverThreadIds: [threadId]
      }
    ]);
  });

  it("reads existing collab lines when a new thread is pinned from the start", () => {
    const home = path.join(os.tmpdir(), `codex-omni-rollout-new-${Date.now()}`);
    const dir = path.join(home, "sessions", "2026", "08", "30");
    mkdirSync(dir, { recursive: true });
    const threadId = "01a05155-b1b8-7d10-ad12-a238b00d7095";
    const file = path.join(dir, `rollout-2026-08-30T06-22-45-${threadId}.jsonl`);
    writeFileSync(
      file,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "call-spawn-new",
          arguments: JSON.stringify({ message: "Query the current date" })
        }
      })}\n`
    );
    const tailer = createCollabRolloutTailer(home);
    tailer.setThreadId(threadId, { fromEnd: false });
    expect(tailer.flush()).toMatchObject([
      {
        itemId: "call-spawn-new",
        tool: "spawn_agent",
        phase: "started",
        prompt: "Query the current date"
      }
    ]);
  });

  it("tracks latestTokenUsage from token_count and ignores it as a tool event", () => {
    const home = path.join(os.tmpdir(), `codex-omni-rollout-tokens-${Date.now()}`);
    const dir = path.join(home, "sessions", "2026", "08", "30");
    mkdirSync(dir, { recursive: true });
    const threadId = "01a0511e-520f-7ab2-b4c3-d00831a8d046";
    const file = path.join(dir, `rollout-2026-08-30T05-22-16-${threadId}.jsonl`);
    writeFileSync(file, "");
    const tailer = createCollabRolloutTailer(home);
    tailer.setThreadId(threadId);
    expect(tailer.flush()).toEqual([]);
    expect(tailer.latestTokenUsage()).toBeNull();
    writeFileSync(
      file,
      `${JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 11087,
              cached_input_tokens: 128,
              cache_write_input_tokens: 0,
              output_tokens: 65,
              reasoning_output_tokens: 39,
              total_tokens: 11152
            },
            model_context_window: 258400
          }
        }
      })}\n${JSON.stringify({
        type: "event_msg",
        payload: { type: "context_compacted" }
      })}\n`,
      { flag: "a" }
    );
    const events = tailer.flush();
    expect(events).toMatchObject([
      {
        tool: "context_compacted",
        phase: "completed",
        status: "completed"
      }
    ]);
    expect(events.some((event) => event.tool === "token_count")).toBe(false);
    expect(tailer.latestTokenUsage()).toEqual({
      input_tokens: 11087,
      cached_input_tokens: 128,
      cache_write_input_tokens: 0,
      output_tokens: 65,
      reasoning_output_tokens: 39,
      total_tokens: 11152,
      model_context_window: 258400
    });
  });
});

describe("extractRolloutToolEvents", () => {
  it("merges spawn start and completion including nickname", () => {
    const home = path.join(os.tmpdir(), `codex-omni-extract-${Date.now()}`);
    const dir = path.join(home, "sessions", "2026", "08", "30");
    mkdirSync(dir, { recursive: true });
    const threadId = "01a05155-b1b8-7d10-ad12-a238b00d7095";
    const file = path.join(dir, `rollout-2026-08-30T06-22-45-${threadId}.jsonl`);
    writeFileSync(
      file,
      `${JSON.stringify({
        timestamp: "2026-08-30T06:22:45.680Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "call-spawn-live",
          arguments: JSON.stringify({ message: "Query the current date", fork_context: false })
        }
      })}\n${JSON.stringify({
        timestamp: "2026-08-30T06:22:45.787Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-live",
          output: JSON.stringify({ agent_id: "agent-pascal", nickname: "Pascal" })
        }
      })}\n`
    );
    expect(extractRolloutToolEvents(file)).toMatchObject([
      {
        itemId: "call-spawn-live",
        tool: "spawn_agent",
        phase: "completed",
        nickname: "Pascal",
        prompt: "Query the current date",
        receiverThreadIds: ["agent-pascal"],
        timestamp: Date.parse("2026-08-30T06:22:45.680Z")
      }
    ]);
  });
});
