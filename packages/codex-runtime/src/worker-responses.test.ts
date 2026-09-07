import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BridgeEvent, BridgeRequest } from "@codex-omni/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeWorkerAdapter } from "./index.js";
import { resolveProviderHome } from "./provider-home.js";

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
  if (dir) await rm(dir, { recursive: true, force: true });
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
    async function fixture(truncated = false) {
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
        emit({
          type: "response.created",
          response: { id: "resp-fixture", status: "in_progress", output: [] }
        });
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
        if (!truncated)
          emit({
            type: "response.completed",
            response: {
              id: "resp-fixture",
              status: "completed",
              output: [item],
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
      const codexHome = await resolveProviderHome({
        providersRoot: dir,
        providerId: "home",
        configToml,
        authJson: '{"OPENAI_API_KEY":"fixture-key"}'
      });
      worker = new BridgeWorkerAdapter();
      timer = setTimeout(() => worker?.cancel("session"), 10_000);
      const request: BridgeRequest = {
        protocolVersion: 1,
        requestId: "first",
        projectId: "project",
        sessionId: "session",
        cwd: project,
        runtimeKey: "fixture",
        codexHome,
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
  }
);
