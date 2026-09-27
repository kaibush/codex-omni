import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, BridgeRequest } from "@codex-omni/protocol";
import { ClaudeWorkerAdapter } from "./index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    vi.unstubAllEnvs();
  }
});

function respondStream(
  response: ServerResponse,
  model: string,
  content: Array<Record<string, unknown>>
) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type: string, data: Record<string, unknown>) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 1 }
    }
  });
  content.forEach((block, index) => {
    send("content_block_start", {
      index,
      content_block:
        block.type === "text"
          ? { type: "text", text: "" }
          : block.type === "thinking"
            ? { type: "thinking", thinking: "", signature: "" }
            : { ...block, input: {} }
    });
    send("content_block_delta", {
      index,
      delta:
        block.type === "text"
          ? { type: "text_delta", text: block.text }
          : block.type === "thinking"
            ? { type: "thinking_delta", thinking: block.thinking }
            : { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
    });
    send("content_block_stop", { index });
  });
  send("message_delta", {
    delta: {
      stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null
    },
    usage: { output_tokens: 10 }
  });
  send("message_stop", {});
  response.end();
}

describe("Claude worker with the real Agent SDK and local Messages API", () => {
  it("runs bypass permission mode without an inherited sandbox marker", async () => {
    vi.stubEnv("IS_SANDBOX", undefined);
    const directory = await mkdtemp(path.join(os.tmpdir(), "omni-claude-bypass-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      if (request.url?.includes("count_tokens")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"input_tokens":20}');
        return;
      }
      if (!request.url?.startsWith("/v1/messages")) {
        response.writeHead(404);
        response.end("{}");
        return;
      }
      requests.push(body);
      const parsed = JSON.parse(body) as { model: string };
      respondStream(response, parsed.model, [{ type: "text", text: "BYPASS_READY" }]);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address() as { port: number };
    const adapter = new ClaudeWorkerAdapter();
    cleanups.push(async () => adapter.shutdown());
    const events: BridgeEvent[] = [];
    await adapter.run(
      {
        protocolVersion: 1,
        clientType: "claude-code",
        requestId: "bypass",
        projectId: "project",
        sessionId: "session",
        cwd: directory,
        runtimeKey: "provider",
        runtimeHome: directory,
        homeMode: "api-key",
        apiKey: "fixture-key",
        baseUrl: `http://127.0.0.1:${address.port}`,
        model: "sonnet",
        message: "BYPASS_STARTUP_MARKER",
        sandbox: "danger-full-access",
        approvalPolicy: "never",
        networkAccessEnabled: true,
        claude: { permissionMode: "bypassPermissions" },
        messageEnvVars: {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          DISABLE_TELEMETRY: "1",
          DISABLE_ERROR_REPORTING: "1"
        }
      },
      (event) => events.push(event)
    );
    expect(requests.some((body) => body.includes("BYPASS_STARTUP_MARKER"))).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "assistant.completed" &&
          (event.payload as { text?: string }).text === "BYPASS_READY"
      )
    ).toBe(true);
    expect(events.at(-1)?.type, JSON.stringify(events)).toBe("turn.completed");
  }, 60_000);

  it("streams, answers a native question, and restores the same SDK thread on the next turn", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "omni-claude-sdk-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const requests: any[] = [];
    let asked = false;
    const server = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += String(chunk);
      if (request.url?.includes("count_tokens")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"input_tokens":20}');
        return;
      }
      if (!request.url?.startsWith("/v1/messages")) {
        response.writeHead(404);
        response.end("{}");
        return;
      }
      const body = JSON.parse(text);
      requests.push(body);
      const last = JSON.stringify(
        body.messages.findLast((message: { role: string }) => message.role === "user")
      );
      if (
        !asked &&
        last.includes("FIRST_TURN_MARKER") &&
        body.tools?.some((tool: { name: string }) => tool.name === "AskUserQuestion")
      ) {
        asked = true;
        respondStream(response, body.model, [
          {
            type: "tool_use",
            id: "tool_question",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Which language?",
                  header: "Language",
                  multiSelect: false,
                  options: [
                    { label: "TypeScript", description: "Typed code" },
                    { label: "JavaScript", description: "Plain code" }
                  ]
                }
              ]
            }
          }
        ]);
      } else
        respondStream(response, body.model, [
          { type: "thinking", thinking: "Check the response before answering." },
          {
            type: "text",
            text: last.includes("SECOND_TURN_MARKER")
              ? "SECOND_REPLY"
              : last.includes("STEER_TURN_MARKER")
                ? "STEER_REPLY"
                : "FIRST_REPLY"
          }
        ]);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address() as { port: number };
    const adapter = new ClaudeWorkerAdapter();
    cleanups.push(async () => adapter.shutdown());
    const base: BridgeRequest = {
      protocolVersion: 1,
      clientType: "claude-code",
      requestId: "first",
      projectId: "project",
      sessionId: "session",
      cwd: directory,
      runtimeKey: "provider",
      runtimeHome: directory,
      homeMode: "api-key",
      apiKey: "fixture-key",
      baseUrl: `http://127.0.0.1:${address.port}`,
      model: "sonnet",
      message: "FIRST_TURN_MARKER",
      conversationContext: "PORTABLE_HISTORY_MARKER",
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      networkAccessEnabled: true,
      messageEnvVars: {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1"
      }
    };
    const events: BridgeEvent[] = [];
    let steerAcknowledgement: Promise<boolean> | undefined;
    await adapter.run(base, (event) => {
      events.push(event);
      if (event.type === "approval.requested")
        adapter.respond(base.sessionId, (event.payload as any).approvalId, "accept", {
          answers: { "Which language?": "TypeScript" }
        });
      if (
        event.type === "assistant.completed" &&
        (event.payload as any).text === "FIRST_REPLY" &&
        !steerAcknowledgement
      ) {
        steerAcknowledgement = adapter.sendAcknowledgedCommand(base.sessionId, {
          type: "turn.steer",
          message: "STEER_TURN_MARKER"
        });
      }
    });
    expect(
      events.some(
        (event) =>
          event.type === "approval.requested" && (event.payload as any).tool === "AskUserQuestion"
      ),
      JSON.stringify(events)
    ).toBe(true);
    expect(events.at(-1)?.type).toBe("turn.completed");
    expect(await steerAcknowledgement).toBe(true);
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === "assistant.completed" && (event.payload as any).text === "STEER_REPLY"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "assistant.completed" && (event.payload as any).text === "FIRST_REPLY"
      )
    ).toBe(true);
    const replies = events.filter((event) => event.type.startsWith("assistant."));
    const completedIds = replies
      .filter((event) => event.type === "assistant.completed")
      .map((event) => (event.payload as any).itemId);
    expect(completedIds).toHaveLength(2);
    expect(new Set(replies.map((event) => (event.payload as any).itemId))).toEqual(
      new Set(completedIds)
    );
    expect(
      events.filter((event) => event.type === "reasoning.delta").at(-1)?.payload
    ).toMatchObject({ phase: "completed" });
    const nativeId = (events.find((event) => event.type === "thread.started")?.payload as any)
      ?.threadId;
    expect(nativeId).toBeTruthy();
    const after: BridgeEvent[] = [];
    await adapter.run(
      {
        ...base,
        requestId: "second",
        threadId: nativeId,
        message: "SECOND_TURN_MARKER",
        conversationContext: ""
      },
      (event) => after.push(event)
    );
    expect(after.at(-1)?.type).toBe("turn.completed");
    const lastRequest = requests.findLast((body) =>
      JSON.stringify(body.messages).includes("SECOND_TURN_MARKER")
    );
    expect(JSON.stringify(lastRequest?.messages)).toContain("FIRST_TURN_MARKER");
    expect(JSON.stringify(lastRequest?.messages)).toContain("TypeScript");
    expect(JSON.stringify(lastRequest?.messages)).toContain("PORTABLE_HISTORY_MARKER");
    expect(
      after.some(
        (event) =>
          event.type === "assistant.completed" && (event.payload as any).text === "SECOND_REPLY"
      )
    ).toBe(true);

    const commandEvents: BridgeEvent[] = [];
    const requestCount = requests.length;
    await adapter.run(
      {
        ...base,
        requestId: "command",
        threadId: nativeId,
        message: "/context",
        conversationContext: "HISTORY_BEFORE_COMMAND"
      },
      (event) => commandEvents.push(event)
    );
    expect(commandEvents.at(-1)?.type, JSON.stringify(commandEvents)).toBe("turn.completed");
    expect(
      commandEvents.some(
        (event) =>
          event.type === "assistant.completed" &&
          String((event.payload as any).text).includes("Context Usage")
      ),
      JSON.stringify(commandEvents)
    ).toBe(true);
    expect(requests).toHaveLength(requestCount);
    await adapter.run(
      {
        ...base,
        requestId: "after-command",
        threadId: nativeId,
        message: "SECOND_TURN_MARKER after command",
        conversationContext: ""
      },
      () => {}
    );
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("HISTORY_BEFORE_COMMAND");
  }, 45_000);

  it("presents the saved plan before approval and then executes in the same SDK turn", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "omni-claude-plan-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const plans = path.join(directory, "plans");
    await mkdir(plans);
    const planFile = path.join(plans, "review.md");
    const plan =
      "# Implementation plan\n\n1. Write proof.txt after approval.\n2. Verify its contents.";
    await writeFile(planFile, plan);
    let step = 0;
    const server = createServer(async (request, response) => {
      let bodyText = "";
      for await (const chunk of request) bodyText += String(chunk);
      if (request.url?.includes("count_tokens")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"input_tokens":20}');
        return;
      }
      if (!request.url?.startsWith("/v1/messages")) {
        response.writeHead(404);
        response.end("{}");
        return;
      }
      const body = JSON.parse(bodyText);
      if (!body.tools?.some((tool: { name: string }) => tool.name === "ExitPlanMode")) {
        respondStream(response, body.model, [{ type: "text", text: "auxiliary" }]);
        return;
      }
      const content =
        step++ === 0
          ? [{ type: "tool_use", id: "read_plan", name: "Read", input: { file_path: planFile } }]
          : step === 2
            ? [{ type: "tool_use", id: "approve_plan", name: "ExitPlanMode", input: {} }]
            : step === 3
              ? [
                  {
                    type: "tool_use",
                    id: "write_proof",
                    name: "Write",
                    input: { file_path: path.join(directory, "proof.txt"), content: "approved" }
                  }
                ]
              : [{ type: "text", text: "PLAN_EXECUTED" }];
      respondStream(response, body.model, content);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const adapter = new ClaudeWorkerAdapter();
    cleanups.push(async () => adapter.shutdown());
    const events: BridgeEvent[] = [];
    const port = (server.address() as { port: number }).port;
    await adapter.run(
      {
        protocolVersion: 1,
        requestId: "plan",
        clientType: "claude-code",
        projectId: "project",
        sessionId: "session",
        cwd: directory,
        runtimeKey: "provider",
        runtimeHome: directory,
        homeMode: "api-key",
        settingsJson: JSON.stringify({ plansDirectory: plans }),
        apiKey: "fixture",
        baseUrl: `http://127.0.0.1:${port}`,
        model: "sonnet",
        mode: "plan",
        claude: { maxTurns: 8 },
        message: "Review the existing plan, get approval, and execute it.",
        sandbox: "read-only",
        approvalPolicy: "on-request",
        networkAccessEnabled: true,
        messageEnvVars: {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          DISABLE_TELEMETRY: "1",
          DISABLE_ERROR_REPORTING: "1"
        }
      },
      (event) => {
        events.push(event);
        if (event.type === "approval.requested")
          adapter.respond("session", (event.payload as any).approvalId, "accept");
      }
    );
    const approval = events.find(
      (event) => event.type === "approval.requested" && (event.payload as any).kind === "plan"
    );
    expect(approval?.payload, JSON.stringify(events)).toMatchObject({ plan, planPath: planFile });
    expect(events.at(-1)?.type).toBe("turn.completed");
    expect(await readFile(path.join(directory, "proof.txt"), "utf8")).toBe("approved");
  }, 45_000);

  it("tracks a real SDK background subagent and keeps its reply out of the main assistant", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "omni-claude-agent-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    let launched = false;
    let childCalled = false;
    const server = createServer(async (request, response) => {
      let bodyText = "";
      for await (const chunk of request) bodyText += String(chunk);
      if (request.url?.includes("count_tokens")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"input_tokens":20}');
        return;
      }
      if (!request.url?.startsWith("/v1/messages")) {
        response.writeHead(404);
        response.end("{}");
        return;
      }
      const body = JSON.parse(bodyText);
      const last = JSON.stringify(
        body.messages.findLast((message: { role: string }) => message.role === "user")
      );
      if (last.includes("SUBAGENT_WORK_MARKER")) {
        childCalled = true;
        respondStream(response, body.model, [{ type: "text", text: "SUBAGENT_ONLY_REPLY" }]);
      } else if (!launched && body.tools?.some((tool: { name: string }) => tool.name === "Agent")) {
        launched = true;
        respondStream(response, body.model, [
          {
            type: "tool_use",
            id: "launch_agent",
            name: "Agent",
            input: {
              description: "Inspect fixture",
              prompt: "SUBAGENT_WORK_MARKER: report the fixture status",
              subagent_type: "Explore",
              run_in_background: true
            }
          }
        ]);
      } else respondStream(response, body.model, [{ type: "text", text: "MAIN_FINISHED" }]);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const adapter = new ClaudeWorkerAdapter();
    cleanups.push(async () => adapter.shutdown());
    const events: BridgeEvent[] = [];
    const port = (server.address() as { port: number }).port;
    await adapter.run(
      {
        protocolVersion: 1,
        requestId: "agents",
        clientType: "claude-code",
        projectId: "project",
        sessionId: "session",
        cwd: directory,
        runtimeKey: "provider",
        runtimeHome: directory,
        homeMode: "api-key",
        apiKey: "fixture",
        baseUrl: `http://127.0.0.1:${port}`,
        model: "sonnet",
        claude: { maxTurns: 8 },
        message: "Use an agent to inspect this fixture",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        networkAccessEnabled: true,
        messageEnvVars: {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          DISABLE_TELEMETRY: "1",
          DISABLE_ERROR_REPORTING: "1"
        }
      },
      (event) => {
        events.push(event);
        if (event.type === "approval.requested")
          adapter.respond("session", (event.payload as any).approvalId, "accept");
      }
    );
    expect(childCalled, JSON.stringify(events)).toBe(true);
    expect(events.at(-1)?.type).toBe("turn.completed");
    expect(
      events.some(
        (event) => (event.payload as any).taskId && (event.payload as any).status === "completed"
      ),
      JSON.stringify(events)
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "assistant.completed" &&
          (event.payload as any).text === "SUBAGENT_ONLY_REPLY"
      )
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "tool.output" &&
          (event.payload as any).tool === "subagent_message" &&
          String((event.payload as any).output).includes("SUBAGENT_ONLY_REPLY")
      )
    ).toBe(true);
  }, 45_000);
});
