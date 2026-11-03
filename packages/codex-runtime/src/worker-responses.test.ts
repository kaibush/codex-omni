import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BridgeEvent, BridgeRequest } from "@codex-omni/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeWorkerAdapter } from "./index.js";

let dir: string | undefined;
let server: Server | undefined;
let worker: BridgeWorkerAdapter | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

afterEach(async () => {
  clearTimeout(timer);
  worker?.shutdown();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  dir = undefined;
  server = undefined;
  worker = undefined;
  timer = undefined;
});

// This is the production Worker -> installed SDK -> bundled CLI -> Responses
// path, not a mocked SDK. The only upstream is an ephemeral loopback SSE fixture.
describe.skipIf(process.platform === "win32")(
  "worker with real CLI and Responses transport",
  () => {
    async function fixture(
      truncated = false,
      emptyFirstReply = false,
      toolBeforeEmptyReply = false
    ) {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      server = createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += String(chunk);
        requests.push({ url: req.url ?? "", body: body ? JSON.parse(body) : {} });
        if (req.url !== "/v1/responses") {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const item = {
          id: "msg-fixture",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "fixture completed", annotations: [] }]
        };
        const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        const emptyReply = emptyFirstReply && requests.length === (toolBeforeEmptyReply ? 2 : 1);
        const toolReply = toolBeforeEmptyReply && requests.length === 1;
        emit({
          type: "response.created",
          response: { id: "resp-fixture", status: "in_progress", output: [] }
        });
        if (toolReply) {
          const progress = {
            ...item,
            phase: "commentary",
            content: [{ type: "output_text", text: "现在检查图片。", annotations: [] }]
          };
          const tool = {
            id: "tool-fixture",
            type: "function_call",
            call_id: "call-fixture",
            name: "view_image",
            arguments: JSON.stringify({ path: path.join(dir!, "project", "image.png") }),
            status: "completed"
          };
          emit({ type: "response.output_item.added", output_index: 0, item: progress });
          emit({ type: "response.output_item.done", output_index: 0, item: progress });
          emit({ type: "response.output_item.added", output_index: 1, item: tool });
          emit({ type: "response.output_item.done", output_index: 1, item: tool });
          emit({
            type: "response.completed",
            response: {
              id: "resp-fixture",
              status: "completed",
              output: [progress, tool],
              usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 }
            }
          });
          res.end();
          return;
        }
        if (!emptyReply) {
          emit({
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, status: "in_progress", content: [] }
          });
          emit({
            type: "response.output_text.delta",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: "fixture completed"
          });
          emit({ type: "response.output_item.done", output_index: 0, item });
        }
        if (!truncated)
          emit({
            type: "response.completed",
            response: {
              id: "resp-fixture",
              status: "completed",
              output: emptyReply ? [] : [item],
              usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 }
            }
          });
        res.end();
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture server address missing");
      const baseUrl = `http://127.0.0.1:${address.port}/v1`;
      dir = await mkdtemp(path.join(os.tmpdir(), "omni-cli-responses-"));
      const project = path.join(dir, "project");
      await mkdir(project);
      await writeFile(
        path.join(project, "image.png"),
        Buffer.from(
          "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082",
          "hex"
        )
      );
      const configToml = `model = "omni-fixture"\nmodel_provider = "custom"\n[model_providers.custom]\nname = "Fixture"\nbase_url = "${baseUrl}"\nwire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0\n`;
      const codexHome = path.join(dir, "client-codex");
      await mkdir(codexHome);
      worker = new BridgeWorkerAdapter();
      timer = setTimeout(() => worker?.cancel("session"), 10_000);
      const request: BridgeRequest = {
        protocolVersion: 1,
        requestId: "first",
        projectId: "project",
        sessionId: "session",
        cwd: project,
        runtimeKey: "fixture",
        runtimeHome: codexHome,
        configToml,
        baseUrl,
        apiKey: "fixture-key",
        model: "omni-fixture",
        message: "Inspect the attached image.",
        contextWindow: 32000,
        autoCompactTokenLimit: 28000,
        attachments: [{ name: "image.png", path: "image.png", kind: "image" }],
        sandbox: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false
      };
      return { request, requests };
    }

    it("distinguishes an empty upstream completion from a final answer on the resumed thread", async () => {
      const { request } = await fixture(false, true);
      const first: BridgeEvent[] = [];
      await worker!.run(request, (event) => first.push(event));
      expect(first.some((event) => event.type === "assistant.completed")).toBe(false);
      expect(first.at(-1)).toMatchObject({
        type: "turn.completed",
        payload: { hasFinalResponse: false }
      });
      const threadId = (
        first.find((event) => event.type === "thread.started")?.payload as { threadId: string }
      ).threadId;
      const next: BridgeEvent[] = [];
      await worker!.run({ ...request, requestId: "resume", threadId }, (event) => next.push(event));
      expect(next.at(-1)).toMatchObject({
        type: "turn.completed",
        payload: { hasFinalResponse: true }
      });
    });

    it("does not treat commentary before an image tool as a final answer", async () => {
      const { request, requests } = await fixture(false, true, true);
      const events: BridgeEvent[] = [];
      await worker!.run(request, (event) => events.push(event));
      expect(requests).toHaveLength(2);
      expect(events.find((event) => event.type === "assistant.completed")?.payload).toMatchObject({
        text: "现在检查图片。"
      });
      expect(
        events.some(
          (event) =>
            event.type === "tool.output" &&
            (event.payload as Record<string, unknown>).tool === "view_image"
        )
      ).toBe(true);
      expect(events.find((event) => event.type === "turn.completed")?.payload).toMatchObject({
        hasFinalResponse: false
      });
      const threadId = (
        events.find((event) => event.type === "thread.started")?.payload as { threadId: string }
      ).threadId;
      const resumed: BridgeEvent[] = [];
      await worker!.run({ ...request, requestId: "resume", threadId }, (event) =>
        resumed.push(event)
      );
      expect(resumed.find((event) => event.type === "turn.completed")?.payload).toMatchObject({
        hasFinalResponse: true
      });
      expect(requests).toHaveLength(3);
    }, 15_000);

    it("completes image turns and resends the image on a resumed turn", async () => {
      const { request, requests } = await fixture();
      const first: BridgeEvent[] = [];
      await worker!.run(request, (event) => first.push(event));
      expect(first.at(-1)?.type).toBe("turn.completed");
      expect(first.find((event) => event.type === "assistant.completed")?.payload).toMatchObject({
        text: "fixture completed"
      });
      const threadId = (
        first.find((event) => event.type === "thread.started")?.payload as { threadId: string }
      ).threadId;
      expect(threadId).toBeTruthy();
      const retried: BridgeEvent[] = [];
      await worker!.run({ ...request, requestId: "retry", threadId }, (event) =>
        retried.push(event)
      );
      expect(retried.at(-1)?.type).toBe("turn.completed");
      expect(requests).toHaveLength(2);
      const imageCount = (body: unknown) =>
        JSON.stringify(body).match(/data:image\/\w+;base64,/g)?.length ?? 0;
      expect(imageCount(requests[0]?.body)).toBe(1);
      expect(imageCount(requests[1]?.body)).toBeGreaterThan(imageCount(requests[0]?.body));
    }, 15_000);

    it("reports a truncated Responses stream as failed, never completed", async () => {
      const { request, requests } = await fixture(true);
      const events: BridgeEvent[] = [];
      await expect(worker!.run(request, (event) => events.push(event))).rejects.toThrow();
      expect(events.some((event) => event.type === "turn.completed")).toBe(false);
      expect(events.some((event) => event.type === "run.failed")).toBe(true);
      expect(requests).toHaveLength(1);
    }, 15_000);

    it("isolates reused CLI item ids while steering within one run", async () => {
      const { request, requests } = await fixture();
      const events: BridgeEvent[] = [];
      await worker!.run(request, (event) => {
        events.push(event);
        if (event.type === "run.started") {
          expect(worker!.steer(request.sessionId, "Also inspect the second city.")).toBe(true);
        }
      });
      expect(requests, JSON.stringify(events)).toHaveLength(2);
      const replies = events.filter((event) => event.type === "assistant.completed");
      expect(replies).toHaveLength(2);
      const firstId = (replies[0]?.payload as { itemId: string }).itemId;
      expect(replies[1]?.payload).toMatchObject({
        itemId: `s1:${firstId}`,
        text: "fixture completed"
      });
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("turn.completed");
      expect(
        events.every((event, index) => index === 0 || event.seq > events[index - 1]!.seq)
      ).toBe(true);
      expect(JSON.stringify(requests[1]?.body)).toContain("Also inspect the second city.");
    }, 15_000);
  }
);
