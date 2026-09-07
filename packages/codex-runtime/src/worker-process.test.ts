import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import type { BridgeEvent, BridgeRequest } from "@codex-omni/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeWorkerAdapter } from "./index.js";
import { createNormalizer } from "./normalizer.js";
import {
  consumeCodexEventStream,
  createMappedStreamState,
  incompleteStreamError,
  INCOMPLETE_TURN_MESSAGE
} from "./worker-stream.js";

let dir: string;
let workers: BridgeWorkerAdapter[] = [];
const completion: ThreadEvent = {
  type: "turn.completed",
  usage: {
    input_tokens: 10,
    cached_input_tokens: 2,
    cache_write_input_tokens: 0,
    output_tokens: 3,
    reasoning_output_tokens: 1
  }
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omni-worker-test-"));
});
afterEach(async () => {
  for (const worker of workers) worker.shutdown();
  workers = [];
  await rm(dir, { recursive: true, force: true });
});

function request(message = "test"): BridgeRequest {
  return {
    protocolVersion: 1,
    requestId: "r",
    projectId: "p",
    sessionId: "s",
    cwd: dir,
    codexHome: dir,
    runtimeKey: "k",
    message,
    sandbox: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false
  };
}

// Exercise the installed SDK's real subprocess, JSONL parser and cleanup. Only
// the CLI's stdout is a fixture; no provider credentials or network are used.
describe.skipIf(process.platform === "win32")("SDK subprocess stream contract", () => {
  async function sdkStream(items: ThreadEvent[], exitCode = 0, threadId?: string) {
    const executable = path.join(dir, "codex-fixture.cjs");
    const capture = path.join(dir, "input.json");
    await writeFile(
      executable,
      `#!${process.execPath}
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  fs.writeFileSync(process.env.FIXTURE_CAPTURE, JSON.stringify({ args: process.argv.slice(2), input }));
  process.stdout.write(JSON.parse(process.env.FIXTURE_EVENTS).map(e => JSON.stringify(e)).join("\\n"));
  if (process.env.FIXTURE_EXIT !== "0") process.stderr.write("Reading prompt from stdin...\\n");
  process.exitCode = Number(process.env.FIXTURE_EXIT);
});
`,
      { mode: 0o700 }
    );
    const codex = new Codex({
      codexPathOverride: executable,
      env: {
        FIXTURE_CAPTURE: capture,
        FIXTURE_EVENTS: JSON.stringify(items),
        FIXTURE_EXIT: String(exitCode)
      }
    });
    const thread = threadId ? codex.resumeThread(threadId) : codex.startThread();
    const { events } = await thread.runStreamed([
      { type: "text", text: "inspect image" },
      { type: "local_image", path: path.join(dir, "image.png") }
    ]);
    const normalizer = createNormalizer(request());
    const state = createMappedStreamState();
    const mapped: BridgeEvent[] = [];
    const consume = () =>
      consumeCodexEventStream({
        events,
        state,
        map: (event) => normalizer.map(event),
        onMappedEvent: (event) => {
          mapped.push(event);
        }
      });
    return { consume, state, mapped, capture };
  }

  it.each([
    { name: "empty stream", items: [] },
    {
      name: "after tool output",
      items: [
        {
          type: "item.completed",
          item: {
            id: "tool",
            type: "command_execution",
            command: "fixture",
            aggregated_output: "done",
            exit_code: 0,
            status: "completed"
          }
        }
      ]
    }
  ] as Array<{ name: string; items: ThreadEvent[] }>)("rejects EOF $name", async ({ items }) => {
    const stream = await sdkStream(items);
    await stream.consume();
    expect(incompleteStreamError(stream.state)?.message).toBe(INCOMPLETE_TURN_MESSAGE);
  });

  it("reads the final non-newline event and keeps images when resuming", async () => {
    const stream = await sdkStream([completion], 0, "previous-thread");
    await stream.consume();
    expect(stream.state.completed).toBe(true);
    expect(stream.mapped.at(-1)?.payload).toMatchObject({ usage: completion.usage });
    const captured = JSON.parse(await readFile(stream.capture, "utf8"));
    expect(captured.args).toContain("resume");
    expect(captured.args).toContain("previous-thread");
    expect(captured.args).toContain(path.join(dir, "image.png"));
    expect(captured.input).toBe("inspect image");
  });

  it("retains the upstream reason across a real non-zero subprocess exit", async () => {
    const stream = await sdkStream(
      [{ type: "error", message: "Reconnecting... 1/5 (stream disconnected)" }],
      1
    );
    await expect(stream.consume()).rejects.toThrow("Codex Exec exited with code 1");
    expect(stream.state.lastFailureMessage).toBe("stream disconnected");
    expect(stream.state.completed).toBe(false);
  });

  it("rejects process failure even after a completion event", async () => {
    const stream = await sdkStream([completion], 1);
    await expect(stream.consume()).rejects.toThrow("Codex Exec exited with code 1");
  });
});

describe("bridge subprocess transport", () => {
  async function adapter() {
    const entry = path.join(dir, "worker.cjs");
    await writeFile(
      entry,
      `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.once("line", line => {
  const request = JSON.parse(line);
  rl.close();
  process.stdin.destroy();
  const emit = (type, payload, ids = {}) => process.stdout.write(JSON.stringify({
    protocolVersion: 1, requestId: request.requestId, projectId: request.projectId,
    sessionId: request.sessionId, seq: 1, type, payload, ...ids
  }));
  if (request.message === "empty") return;
  if (request.message === "failed") { emit("run.failed", { message: "upstream failure" }); return; }
  if (request.message === "wrong-session") {
    emit("turn.completed", {}, { sessionId: "other" }); return;
  }
  emit("turn.completed", { padding: "x".repeat(256 * 1024) });
  if (request.message === "exit-error") { process.stderr.write("worker crashed"); process.exitCode = 1; }
});
`
    );
    const worker = new BridgeWorkerAdapter(pathToFileURL(entry));
    workers.push(worker);
    return worker;
  }

  it("waits for all stdout before accepting a clean completion", async () => {
    const worker = await adapter();
    const events: BridgeEvent[] = [];
    await worker.run(request(), (event) => events.push(event));
    expect(events.map((event) => event.type)).toEqual(["turn.completed"]);
    expect(worker.isActive("s")).toBe(false);
    expect(worker.runtimeInfo("s")).toBeNull();
  });

  it.each([
    ["empty", INCOMPLETE_TURN_MESSAGE],
    ["failed", "upstream failure"],
    ["wrong-session", "does not belong to this run"],
    ["exit-error", "worker crashed"]
  ])("rejects %s", async (scenario, error) => {
    const worker = await adapter();
    try {
      await expect(worker.run(request(scenario), () => undefined)).rejects.toThrow(error);
    } finally {
      worker.shutdown();
    }
  });
});
