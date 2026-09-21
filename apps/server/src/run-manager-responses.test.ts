import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "@codex-omni/db";
import { afterEach, describe, expect, it } from "vitest";
import { RunManager } from "./run-manager.js";

let dir: string | undefined;
let server: Server | undefined;
let store: Store | undefined;
let manager: RunManager | undefined;

afterEach(async () => {
  manager?.shutdown();
  store?.db.close();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  manager = undefined;
  store = undefined;
  server = undefined;
  dir = undefined;
});

type Reply = { text: string } | { command: string };

// Only the upstream is scripted. The server state machine, SQLite, Bridge
// subprocess, installed SDK, CLI resume and actual tool execution are real.
describe.skipIf(process.platform === "win32")("RunManager with real Responses transport", () => {
  async function fixture(reply: (index: number) => Reply) {
    dir = await mkdtemp(path.join(os.tmpdir(), "omni-run-responses-"));
    const projectPath = path.join(dir, "project");
    await mkdir(projectPath);
    await writeFile(path.join(projectPath, "check.txt"), "WORKFLOW_FIXTURE_READ_OK\n");
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      if (req.url !== "/v1/responses") {
        res.writeHead(404).end();
        return;
      }
      requests.push({ url: req.url, body: body ? JSON.parse(body) : {} });
      const index = requests.length - 1;
      const response = reply(index);
      const item =
        "command" in response
          ? {
              type: "function_call",
              id: `fc-${index}`,
              call_id: `call-${index}`,
              name: "exec_command",
              arguments: JSON.stringify({
                cmd: response.command,
                workdir: projectPath,
                max_output_tokens: 200
              })
            }
          : {
              type: "message",
              id: `msg-${index}`,
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: response.text, annotations: [] }]
            };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      emit({
        type: "response.created",
        response: { id: `resp-${index}`, status: "in_progress", output: [] }
      });
      emit({
        type: "response.output_item.added",
        output_index: 0,
        item:
          "command" in response
            ? { ...item, arguments: "" }
            : { ...item, status: "in_progress", content: [] }
      });
      if ("command" in response) {
        emit({
          type: "response.function_call_arguments.delta",
          item_id: item.id,
          output_index: 0,
          delta: item.arguments
        });
      } else {
        emit({
          type: "response.output_text.delta",
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: response.text
        });
      }
      emit({ type: "response.output_item.done", output_index: 0, item });
      emit({
        type: "response.completed",
        response: {
          id: `resp-${index}`,
          status: "completed",
          output: [item],
          usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 }
        }
      });
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture address missing");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    store = new Store(":memory:");
    const provider = store.upsertProvider({
      name: "Fixture",
      model: "omni-fixture",
      baseUrl,
      apiKey: "fixture-key",
      configToml: `model = "omni-fixture"\nmodel_provider = "custom"\n[model_providers.custom]\nname = "Fixture"\nbase_url = "${baseUrl}"\nwire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0\n`,
      authJson: '{"OPENAI_API_KEY":"fixture-key"}',
      contextWindow: 32000,
      autoCompactTokenLimit: 28000
    });
    const project = store.createProject({
      name: "Fixture",
      displayPath: projectPath,
      realPath: projectPath,
      providerId: provider.id
    });
    const session = store.createSession({ projectId: project.id, providerId: provider.id });
    const sent: Array<{ type: string; requestId?: string; payload?: unknown }> = [];
    const socket = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(JSON.parse(data)) };
    manager = new RunManager(store, path.join(dir, "runtime"), 15_000);
    const run = (message: string, sessionId = session.id) =>
      manager!.handle(
        {
          type: "turn.start",
          projectId: project.id,
          sessionId,
          message,
          sandbox: "danger-full-access",
          approvalPolicy: "never",
          networkAccessEnabled: true
        },
        socket
      );
    return { requests, session, run, sent };
  }

  it("resumes a plan-only turn, preserves its context, and really executes a read tool", async () => {
    const { requests, session, run, sent } = await fixture((index) =>
      index === 0
        ? { text: "先看你贴的构建报错图，再对照私库的 workflow 和最近合入的代码。" }
        : index === 1
          ? { command: "cat check.txt" }
          : { text: "已完成检查，读取了构建记录。" }
    );
    await run("私库构建的时候报错了，请读取 check.txt 检查，不要修改文件。");
    expect(requests).toHaveLength(3);
    const resumed = JSON.stringify(requests[1]?.body.input);
    expect(resumed).toContain("私库构建的时候报错了");
    expect(resumed).toContain("原始用户请求");
    expect(resumed).toContain("先看你贴的构建报错图");
    expect(JSON.stringify(requests[2]?.body.input)).toContain("WORKFLOW_FIXTURE_READ_OK");
    expect(store!.listRuns({ sessionId: session.id }).map((run) => run.status)).toEqual([
      "completed",
      "interrupted"
    ]);
    expect(sent.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    expect(
      store!
        .listMessages(session.id)
        .some(
          (message) =>
            message.role === "tool" && message.content.includes("WORKFLOW_FIXTURE_READ_OK")
        )
    ).toBe(true);
  }, 25_000);

  it("stops after exactly one unsuccessful recovery without publishing success", async () => {
    const { requests, session, run, sent } = await fixture(() => ({
      text: "我先读截图和构建配置，定位失败点并修掉。"
    }));
    await run("继续");
    expect(requests).toHaveLength(2);
    expect(store!.getSession(session.id)?.status).toBe("interrupted");
    expect(sent.some((event) => event.type === "turn.completed")).toBe(false);
    expect(store!.listRuns({ sessionId: session.id }).map((run) => run.status)).toEqual([
      "interrupted",
      "interrupted"
    ]);
    const latest = store!.getLatestRun(session.id)!;
    const events = store!
      .listRunEvents(latest.id, -1, 100)
      .map((event) => JSON.parse(event.eventJson));
    expect(events.at(-1)).toMatchObject({
      type: "run.interrupted",
      payload: { completionGuard: { upstreamTerminal: "turn.completed", recoveryAttempt: 1 } }
    });
  }, 25_000);

  it("sends fork history to the actual Responses request without leaking past the branch point", async () => {
    const { requests, session, run } = await fixture(() => ({ text: "已完成检查。" }));
    store!.updateSession(session.id, { threadId: "parent-thread-not-to-resume" });
    const point = store!.addMessage({
      sessionId: session.id,
      role: "user",
      content: "私库构建的时候报错了：check.txt",
      providerId: session.providerId,
      eventType: "user.message",
      createdAt: 1
    });
    store!.addMessage({
      sessionId: session.id,
      role: "user",
      content: "LATER_MESSAGE_NOT_IN_FORK",
      providerId: session.providerId,
      eventType: "user.message",
      createdAt: 2
    });
    const fork = store!.forkSession(session.id, point.id)!;
    await run("继续", fork.id);
    expect(requests).toHaveLength(1);
    const input = JSON.stringify(requests[0]?.body.input);
    expect(input).toContain("fork-history");
    expect(input).toContain("私库构建的时候报错了：check.txt");
    expect(input).not.toContain("LATER_MESSAGE_NOT_IN_FORK");
    expect(store!.getSession(fork.id)?.threadId).toBeTruthy();
    expect(store!.getSession(fork.id)?.threadId).not.toBe("parent-thread-not-to-resume");
    expect(store!.getSession(session.id)?.threadId).toBe("parent-thread-not-to-resume");
  }, 25_000);
});
