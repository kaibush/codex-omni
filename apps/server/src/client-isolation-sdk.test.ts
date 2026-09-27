import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "@codex-omni/db";
import { findRolloutFile } from "@codex-omni/codex-runtime";
import { clientRuntimeHome } from "./client-home.js";
import { buildApiKeyProviderFiles } from "./config-toml.js";
import { RunManager } from "./run-manager.js";
import { switchSessionProvider } from "./session-runtime.js";

let directory = "";
let server: Server | undefined;
let store: Store | undefined;
let manager: RunManager | undefined;
afterEach(async () => {
  manager?.shutdown();
  manager = undefined;
  store?.db.close();
  store = undefined;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  if (directory)
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  directory = "";
  vi.unstubAllEnvs();
});

// Real RunManager -> Worker -> official SDK -> bundled CLI. Only the two
// upstreams are simulated; all homes, native transcripts and databases are real.
describe.skipIf(process.platform === "win32")("shared client HOME through both SDKs", () => {
  it.each(["codex", "claude-code"] as const)(
    "resumes %s without copying and isolates concurrent providers",
    async (clientType) => {
      vi.stubEnv("CODEX_OMNI_CODEX_HOME", "");
      vi.stubEnv("CODEX_OMNI_CLAUDE_HOME", "");
      directory = await mkdtemp(path.join(os.tmpdir(), "omni-native-sdk-"));
      const projectPath = path.join(directory, "project");
      await mkdir(projectPath);
      const requests: Array<{
        provider: string;
        credential: string;
        marker: string;
        body: Record<string, unknown>;
      }> = [];
      let concurrent = false;
      let arrivals = 0;
      let releaseConcurrent!: () => void;
      const concurrentGate = new Promise<void>((resolve) => {
        releaseConcurrent = resolve;
      });
      server = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += String(chunk);
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname.endsWith("/count_tokens")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"input_tokens":30}');
          return;
        }
        if (!url.pathname.endsWith(clientType === "codex" ? "/responses" : "/messages")) {
          res.writeHead(404);
          res.end("{}");
          return;
        }
        const body = JSON.parse(raw) as Record<string, unknown>;
        const provider = url.pathname.split("/")[1]!;
        requests.push({
          provider,
          body,
          marker: String(req.headers["x-provider-marker"] ?? ""),
          credential: String(req.headers.authorization ?? req.headers["x-api-key"] ?? "")
        });
        const sequence = requests.length;
        if (concurrent) {
          arrivals++;
          await concurrentGate;
        }
        const answer = `NATIVE_REPLY_${sequence}`;
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (clientType === "codex") {
          const item = {
            id: `msg-${sequence}`,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: answer, annotations: [] }]
          };
          const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
          emit({
            type: "response.created",
            response: { id: `resp-${sequence}`, status: "in_progress", output: [] }
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
            delta: answer
          });
          emit({ type: "response.output_item.done", output_index: 0, item });
          emit({
            type: "response.completed",
            response: {
              id: `resp-${sequence}`,
              status: "completed",
              output: [item],
              usage: { input_tokens: 30, output_tokens: 5, total_tokens: 35 }
            }
          });
        } else {
          const emit = (type: string, data: Record<string, unknown>) =>
            res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
          emit("message_start", {
            message: {
              id: `msg-${sequence}`,
              type: "message",
              role: "assistant",
              model: body.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 30, output_tokens: 1 }
            }
          });
          emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
          emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: answer } });
          emit("content_block_stop", { index: 0 });
          emit("message_delta", {
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 5 }
          });
          emit("message_stop", {});
        }
        res.end();
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture address missing");
      store = new Store(":memory:");
      const model = clientType === "codex" ? "omni-fixture" : "sonnet";
      const providers = ["a", "b"].map((name) => {
        const baseUrl = `http://127.0.0.1:${address.port}/${name}${clientType === "codex" ? "/v1" : ""}`;
        const apiKey = `fixture-key-${name}`;
        const nativeConfig =
          clientType === "codex"
            ? buildApiKeyProviderFiles({ name, baseUrl, model, apiKey })
            : null;
        if (nativeConfig && name === "a")
          nativeConfig.configToml = nativeConfig.configToml.replace(
            "requires_openai_auth = true\n",
            ""
          );
        // Managed configurations inject their own provider identifier and auth.
        if (nativeConfig && name === "b")
          nativeConfig.configToml = nativeConfig.configToml
            .replace('model_provider = "custom"', 'model_provider = "provider_b"')
            .replace("[model_providers.custom]", "[model_providers.provider_b]");
        return store!.upsertProvider({
          name,
          kind: clientType,
          homeMode: nativeConfig && name === "b" ? "managed" : "api-key",
          model,
          apiKey,
          baseUrl,
          ...nativeConfig,
          envJson: JSON.stringify({
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            DISABLE_TELEMETRY: "1",
            DISABLE_ERROR_REPORTING: "1"
          })
        });
      });
      const project = store.createProject({
        name: "Native fixture",
        displayPath: projectPath,
        realPath: projectPath,
        providerId: providers[0]!.id
      });
      const session = store.createSession({
        projectId: project.id,
        clientType,
        providerId: providers[0]!.id
      });
      const runtimeRoot = path.join(directory, "runtime");
      const clientHome = clientRuntimeHome(clientType, runtimeRoot);
      await mkdir(clientHome, { recursive: true });
      const nativeBase = `http://127.0.0.1:${address.port}/native${clientType === "codex" ? "/v1" : ""}`;
      const nativeFiles =
        clientType === "codex"
          ? {
              "config.toml": `model = "omni-fixture"\nmodel_provider = "custom"\n[model_providers.custom]\nname = "Native"\nbase_url = "${nativeBase}"\nwire_api = "responses"\nrequires_openai_auth = true\nhttp_headers = { "X-Provider-Marker" = "native" }\n`,
              "auth.json": '{"OPENAI_API_KEY":"fixture-key-native"}'
            }
          : {
              "settings.json": JSON.stringify({
                env: {
                  ANTHROPIC_BASE_URL: nativeBase,
                  ANTHROPIC_API_KEY: "fixture-key-native",
                  ANTHROPIC_DEFAULT_SONNET_MODEL: "native-model"
                }
              })
            };
      for (const [name, content] of Object.entries(nativeFiles))
        await writeFile(path.join(clientHome, name), content!);
      const transcriptFile = async (id: string) => {
        if (clientType === "codex") return findRolloutFile(clientHome, id);
        for (const entry of await readdir(path.join(clientHome, "projects"))) {
          const file = path.join(clientHome, "projects", entry, `${id}.jsonl`);
          if (await stat(file).catch(() => null)) return file;
        }
        throw new Error("Native transcript missing");
      };
      let originalFile = "";
      let originalInode = 0;

      manager = new RunManager(store, runtimeRoot, 25_000);
      const socket = { readyState: 1, OPEN: 1, send(_value: string) {} };
      let nativeId: string | null = null;
      for (const [index, provider] of [providers[0]!, providers[1]!, providers[0]!].entries()) {
        if (index) switchSessionProvider(store, session.id, provider.id);
        await manager.handle(
          {
            type: "turn.start",
            projectId: project.id,
            sessionId: session.id,
            providerId: provider.id,
            message: `NATIVE_PROMPT_${index + 1}`,
            approvalPolicy: "never",
            sandbox: "read-only",
            networkAccessEnabled: false
          },
          socket
        );
        const run = store.getLatestRun(session.id);
        expect(run, JSON.stringify(run)).toMatchObject({ status: "completed" });
        const current = store.getSession(session.id)!;
        if (!nativeId) nativeId = current.threadId;
        expect(nativeId).toBeTruthy();
        expect(current).toMatchObject({ clientType, threadId: nativeId, providerId: provider.id });
        const file = await transcriptFile(nativeId!);
        const inode = (await stat(file)).ino;
        if (!originalFile) {
          originalFile = file;
          originalInode = inode;
        }
        expect(file).toBe(originalFile);
        expect(inode).toBe(originalInode);
      }
      expect(requests).toHaveLength(3);
      expect(requests.map((request) => request.provider)).toEqual(["a", "b", "a"]);
      for (const [index, request] of requests.entries()) {
        expect(request.marker).toBe("");
        expect(request.credential).toBe(
          `${clientType === "codex" ? "Bearer " : ""}fixture-key-${request.provider}`
        );
        const history = (
          clientType === "codex" ? request.body.input : request.body.messages
        ) as Array<{ role?: string; content?: unknown }>;
        for (let previous = 1; previous <= index; previous++) {
          expect(
            history.some(
              (message) =>
                message.role === "assistant" &&
                JSON.stringify(message.content).includes(`NATIVE_REPLY_${previous}`)
            )
          ).toBe(true);
          expect(
            history.some(
              (message) =>
                message.role === "user" &&
                JSON.stringify(message.content).includes(`NATIVE_PROMPT_${previous}`)
            )
          ).toBe(true);
        }
        expect(JSON.stringify(history)).not.toContain("provider-history");
      }

      const second = store.createSession({
        projectId: project.id,
        clientType,
        providerId: providers[1]!.id
      });
      concurrent = true;
      const both = Promise.all([
        manager.handle(
          {
            type: "turn.start",
            projectId: project.id,
            sessionId: session.id,
            message: "CONCURRENT_MAIN",
            approvalPolicy: "never",
            sandbox: "read-only"
          },
          socket
        ),
        manager.handle(
          {
            type: "turn.start",
            projectId: project.id,
            sessionId: second.id,
            message: "CONCURRENT_SECOND",
            approvalPolicy: "never",
            sandbox: "read-only"
          },
          socket
        )
      ]);
      try {
        await expect.poll(() => arrivals, { timeout: 20_000 }).toBe(2);
        expect(() => switchSessionProvider(store!, session.id, providers[1]!.id)).toThrow(
          "任务结束"
        );
      } finally {
        releaseConcurrent();
        await both;
        concurrent = false;
      }
      for (const current of [session, second])
        expect(store.getLatestRun(current.id)?.status).toBe("completed");
      expect(store.getSession(session.id)?.threadId).toBe(nativeId);
      expect(store.getSession(second.id)?.threadId).not.toBe(nativeId);
      const parallelRequests = requests.slice(3);
      expect(parallelRequests.map((entry) => entry.provider).sort()).toEqual(["a", "b"]);
      for (const entry of parallelRequests) {
        expect(entry.credential).toBe(
          `${clientType === "codex" ? "Bearer " : ""}fixture-key-${entry.provider}`
        );
        expect(entry.marker).toBe("");
        const history = JSON.stringify(
          clientType === "codex" ? entry.body.input : entry.body.messages
        );
        if (entry.provider === "a") {
          expect(history).toContain("NATIVE_PROMPT_1");
          expect(history).not.toContain("CONCURRENT_SECOND");
        } else {
          expect(history).not.toContain("NATIVE_PROMPT_1");
          expect(history).not.toContain("CONCURRENT_MAIN");
        }
      }
      // Returning to native configuration uses the same history and original
      // client files, without leaving the last channel's credentials behind.
      const native = store.upsertProvider({
        name: "Native",
        kind: clientType,
        homeMode: "native",
        model,
        envJson: providers[0]!.envJson
      });
      switchSessionProvider(store, session.id, native.id);
      await manager.handle(
        {
          type: "turn.start",
          projectId: project.id,
          sessionId: session.id,
          message: "NATIVE_AGAIN",
          approvalPolicy: "never",
          sandbox: "read-only"
        },
        socket
      );
      expect(store.getLatestRun(session.id)?.status).toBe("completed");
      expect(requests.at(-1)).toMatchObject({
        provider: "native",
        credential: `${clientType === "codex" ? "Bearer " : ""}fixture-key-native`
      });
      expect(store.getSession(session.id)?.threadId).toBe(nativeId);
      expect(await transcriptFile(nativeId!)).toBe(originalFile);
      expect((await stat(originalFile)).ino).toBe(originalInode);
      for (const [name, content] of Object.entries(nativeFiles))
        expect(await readFile(path.join(clientHome, name), "utf8")).toBe(content);
      expect(await readdir(runtimeRoot)).toEqual(["clients"]);
      expect(store.listSessions(project.id)).toHaveLength(2);
    },
    90_000
  );
});
