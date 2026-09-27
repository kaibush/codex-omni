import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Store } from "@codex-omni/db";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

let dir: string | undefined;
let child: ChildProcess | undefined;
let modelServer: Server | undefined;

async function stopServer() {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      child!.once("close", () => resolve());
      child!.kill("SIGTERM");
    });
  }
  child = undefined;
}

afterEach(async () => {
  await stopServer();
  if (modelServer) await new Promise<void>((resolve) => modelServer!.close(() => resolve()));
  modelServer = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("provider runtime settings HTTP contract", () => {
  it("round-trips create/update/clone/import, persists limits, and rejects invalid values", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "omni-provider-api-"));
    const database = path.join(dir, "test.db");
    // Keep the background release check offline; this fixture exercises only
    // our real local HTTP server, authentication and SQLite persistence.
    const offline = path.join(dir, "offline.mjs");
    await writeFile(
      offline,
      "const realFetch = globalThis.fetch; globalThis.fetch = (url, options) => new URL(String(url)).hostname === '127.0.0.1' ? realFetch(url, options) : Promise.resolve(new Response('{}', { status: 404 }));\n"
    );
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(offline).href,
        "--import",
        pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
        fileURLToPath(new URL("./index.ts", import.meta.url))
      ],
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEX_OMNI_HOST: "127.0.0.1",
          CODEX_OMNI_PORT: "0",
          CODEX_OMNI_DATABASE: database,
          CODEX_OMNI_FAKE_RUNTIME: "1",
          CODEX_OMNI_INSTANCE: "provider-api-test",
          CODEX_HOME: path.join(dir, "home")
        }
      }
    );
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(
        () => reject(new Error(`Fixture server startup timeout: ${output}`)),
        10_000
      );
      child!.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child!.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`Fixture server exited: ${output}`));
      });
      child!.stderr!.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-12000);
      });
      child!.stdout!.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-12000);
        const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:[1-9]\d*)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]!);
        }
      });
    });
    let cookie = "";
    let csrf = "";
    const call = async (url: string, method = "GET", value?: unknown) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          ...(value !== undefined ? { "content-type": "application/json" } : {}),
          cookie,
          "x-csrf-token": csrf
        },
        ...(value !== undefined ? { body: JSON.stringify(value) } : {})
      });
      return { response, body: (await response.json()) as Record<string, unknown> };
    };
    const setup = await call("/api/auth/setup", "POST", {
      username: "fixture",
      password: "fixture-password-123"
    });
    expect(setup.response.status).toBe(200);
    cookie = setup.response.headers.get("set-cookie")!.split(";")[0]!;
    csrf = String(setup.body.csrfToken);
    const limits = { contextWindow: 32000, autoCompactTokenLimit: 28000 };
    const created = await call("/api/providers", "POST", {
      name: "Small model",
      homeMode: "api-key",
      model: "fixture-small",
      apiKey: "fixture-key",
      baseUrl: "http://127.0.0.1:1/v1",
      ...limits
    });
    expect(created.response.status).toBe(200);
    expect(created.body).toMatchObject(limits);
    expect(created.body.configToml).toContain('wire_api = "responses"');
    expect(created.body.configToml).not.toContain("256000");
    const id = String(created.body.id);
    const updated = await call(`/api/providers/${id}`, "PUT", { name: "Renamed" });
    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject(limits);
    const exported = await call(`/api/providers/${id}/export`);
    expect(exported.body).toMatchObject(limits);
    const cloned = await call(`/api/providers/${id}/clone`, "POST", {});
    expect(cloned.response.status).toBe(200);
    expect(cloned.body).toMatchObject(limits);
    const imported = await call("/api/providers/import", "POST", exported.body);
    expect(imported.response.status).toBe(200);
    expect(imported.body).toMatchObject(limits);
    const managed = await call("/api/providers", "POST", {
      name: "Managed auth",
      homeMode: "managed",
      configToml: '[model_providers.custom]\nbase_url = "http://127.0.0.1:1/v1"\n',
      authJson: JSON.stringify({ OPENAI_API_KEY: "old-key" }),
      apiKey: "old-key"
    });
    expect(managed.response.status).toBe(200);
    expect(managed.body.apiKey).toBeNull();
    const managedId = String(managed.body.id);
    const managedUpdated = await call(`/api/providers/${managedId}`, "PUT", {
      name: "Managed auth",
      homeMode: "managed",
      configToml: managed.body.configToml,
      authJson: JSON.stringify({ OPENAI_API_KEY: "new-key" }),
      apiKey: null
    });
    expect(managedUpdated.response.status).toBe(200);
    const managedExport = await call(`/api/providers/${managedId}/export`);
    expect(managedExport.body.apiKey).toBeNull();
    expect(managedExport.body.authJson).toContain("new-key");
    expect(
      (await call("/api/providers", "POST", { ...exported.body, contextWindow: 0 })).response.status
    ).toBe(400);
    expect(
      (await call(`/api/providers/${id}`, "PUT", { name: "Invalid", contextWindow: 24000 }))
        .response.status
    ).toBe(400);
    expect(
      (
        await call("/api/providers/import", "POST", {
          ...exported.body,
          autoCompactTokenLimit: 64000
        })
      ).response.status
    ).toBe(400);
    const cleared = await call(`/api/providers/${id}`, "PUT", {
      name: "Defaults",
      contextWindow: null,
      autoCompactTokenLimit: null
    });
    expect(cleared.body).toMatchObject({ contextWindow: null, autoCompactTokenLimit: null });

    const modelRequests: Array<{ url: string; apiKey: string | undefined; body: any }> = [];
    modelServer = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      modelRequests.push({
        url: request.url ?? "",
        apiKey: request.headers["x-api-key"] as string | undefined,
        body: body ? JSON.parse(body) : null
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          request.url === "/v1/messages"
            ? { content: [{ type: "text", text: "Clearer coding request" }] }
            : { data: [{ id: "claude-sonnet-fixture" }, { id: "claude-opus-fixture" }] }
        )
      );
    });
    await new Promise<void>((resolve) => modelServer!.listen(0, "127.0.0.1", resolve));
    const modelPort = (modelServer.address() as { port: number }).port;
    const claudeConfig = {
      name: "Claude fixture",
      kind: "claude-code",
      homeMode: "api-key",
      model: "sonnet",
      apiKey: "claude-fixture-key",
      baseUrl: `http://127.0.0.1:${modelPort}`,
      settingsJson: '{"env":{"CUSTOM":"value"}}',
      mcpServersJson: '{"local":{"command":"node","args":["server.js"]}}',
      isDefault: true
    };
    const claude = await call("/api/providers", "POST", claudeConfig);
    expect(claude.response.status, JSON.stringify(claude.body)).toBe(200);
    expect(claude.body).toMatchObject({
      kind: "claude-code",
      model: "sonnet",
      configToml: null,
      authJson: null,
      isDefault: true
    });
    const claudeId = String(claude.body.id);
    const connection = await call(`/api/providers/${claudeId}/test`, "POST", {});
    expect(connection.body).toMatchObject({
      ok: true,
      models: ["claude-sonnet-fixture", "claude-opus-fixture"]
    });
    const catalog = await call(`/api/providers/${claudeId}/models`);
    expect(catalog.body.models).toContain("claude-sonnet-fixture");
    expect(modelRequests.every((request) => request.apiKey === "claude-fixture-key")).toBe(true);
    const enhanced = await call(`/api/providers/${claudeId}/enhance`, "POST", {
      text: "fix this",
      model: "sonnet"
    });
    expect(enhanced.response.status).toBe(200);
    expect(modelRequests.at(-1)?.body).toMatchObject({
      model: "claude-sonnet-fixture",
      messages: [{ role: "user", content: "fix this" }]
    });
    const renamed = await call(`/api/providers/${claudeId}`, "PUT", { name: "Claude renamed" });
    expect(renamed.body).toMatchObject({
      settingsJson: claudeConfig.settingsJson,
      mcpServersJson: claudeConfig.mcpServersJson
    });
    expect(
      (await call(`/api/providers/${claudeId}`, "PUT", { name: "Invalid", kind: "codex" })).response
        .status
    ).toBe(400);
    const claudeExport = await call(`/api/providers/${claudeId}/export`);
    expect(claudeExport.body).toMatchObject({
      kind: "claude-code",
      apiKey: "claude-fixture-key",
      settingsJson: claudeConfig.settingsJson
    });
    for (const copy of [
      await call(`/api/providers/${claudeId}/clone`, "POST", {}),
      await call("/api/providers/import", "POST", claudeExport.body)
    ]) {
      expect(copy.response.status, JSON.stringify(copy.body)).toBe(200);
      expect(copy.body).toMatchObject({
        kind: "claude-code",
        settingsJson: claudeConfig.settingsJson,
        mcpServersJson: claudeConfig.mcpServersJson
      });
    }
    const mcp = await call(`/api/providers/${claudeId}/mcp`, "POST", {
      name: "remote",
      url: "https://mcp.example.test/api"
    });
    expect(mcp.response.status).toBe(200);
    expect(mcp.body.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "remote", type: "http", enabled: true })
      ])
    );
    const disabled = await call(`/api/providers/${claudeId}/mcp/remote/toggle`, "POST", {
      enabled: false
    });
    expect(disabled.body.servers).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "remote", enabled: false })])
    );
    expect((await call(`/api/providers/${claudeId}/mcp/remote`, "DELETE")).response.status).toBe(
      200
    );
    expect(
      (await call("/api/providers", "POST", { ...claudeConfig, settingsJson: "[]" })).response
        .status
    ).toBe(400);

    const project = await call("/api/projects", "POST", {
      name: "Multi-client",
      path: dir,
      providerId: id
    });
    const projectId = String(project.body.id);
    const session = await call(`/api/projects/${projectId}/sessions`, "POST", { providerId: id });
    const sessionId = String(session.body.id);
    expect(session.body.clientType).toBe("codex");
    expect(
      (
        await call(`/api/projects/${projectId}/sessions`, "POST", {
          providerId: id,
          clientType: "claude-code"
        })
      ).response.status
    ).toBe(400);
    const rejectedSwitch = await call(`/api/sessions/${sessionId}/provider`, "PUT", {
      providerId: claudeId
    });
    expect(rejectedSwitch.response.status).toBe(400);
    for (const invalid of [
      { providerId: claudeId },
      { clientType: "claude-code" },
      { providerId: claudeId, clientType: "claude-code" }
    ]) {
      expect(
        (await call(`/api/sessions/${sessionId}/continue`, "POST", invalid)).response.status
      ).toBe(400);
    }
    expect((await call(`/api/projects/${projectId}/sessions`)).body).toHaveLength(1);
    const inPlace = await call(`/api/sessions/${sessionId}/provider`, "PUT", {
      providerId: cloned.body.id
    });
    expect(inPlace.response.status).toBe(200);
    expect(inPlace.body).toMatchObject({
      id: sessionId,
      clientType: "codex",
      providerId: cloned.body.id
    });
    const continuation = await call(`/api/sessions/${sessionId}/continue`, "POST", {
      providerId: id,
      clientType: "codex"
    });
    expect(continuation.body).toMatchObject({
      clientType: "codex",
      parentSessionId: sessionId,
      continuationMode: "portable-context"
    });
    expect(continuation.body.id).not.toBe(sessionId);
    const claudeSession = await call(`/api/projects/${projectId}/sessions`, "POST", {
      providerId: claudeId,
      clientType: "claude-code"
    });
    const claudeSessionId = String(claudeSession.body.id);
    expect(claudeSession.body.clientType).toBe("claude-code");
    expect(
      (await call(`/api/sessions/${claudeSessionId}/provider`, "PUT", { providerId: id })).response
        .status
    ).toBe(400);
    expect(
      (await call(`/api/sessions/${claudeSessionId}/continue`, "POST", { providerId: id })).response
        .status
    ).toBe(400);
    expect(
      (await call(`/api/sessions/${claudeSessionId}/continue`, "POST", {})).body
    ).toMatchObject({
      clientType: "claude-code",
      providerId: claudeId,
      parentSessionId: claudeSessionId
    });
    expect(
      (
        await call(`/api/projects/${projectId}/agents-md`, "PUT", {
          content: "# Claude rules",
          clientType: "claude-code"
        })
      ).response.status
    ).toBe(200);
    expect(
      (await call(`/api/projects/${projectId}/agents-md?clientType=claude-code`)).body.content
    ).toBe("# Claude rules");
    expect((await call(`/api/projects/${projectId}/agents-md`)).body.content).not.toBe(
      "# Claude rules"
    );
    const threadId = randomUUID();
    const nativeHomes = [id, String(cloned.body.id)].map((providerId) =>
      path.join(dir!, "runtime", "providers", providerId)
    );
    const nativeFiles: string[] = [];
    for (const home of nativeHomes) {
      const file = path.join(home, "sessions", `rollout-fixture-${threadId}.jsonl`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "native-session-fixture");
      nativeFiles.push(file);
    }
    const seed = new Store(database);
    try {
      // Selected provider B, but A still owns the latest native history.
      seed.updateSession(sessionId, { threadId, runtimeHome: nativeHomes[0]! });
      for (const providerId of [id, String(cloned.body.id)])
        seed.saveSessionRuntimeBinding({ sessionId, providerId, clientType: "codex", threadId });
    } finally {
      seed.db.close();
    }
    const purged = await call("/api/sessions/bulk-delete", "POST", {
      ids: [sessionId],
      purgeSource: true
    });
    expect(purged.response.status).toBe(200);
    expect(purged.body.purgedFiles).toBe(2);
    for (const file of nativeFiles)
      await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    await stopServer();
    const store = new Store(database);
    try {
      expect(store.getProvider(id)).toMatchObject({
        contextWindow: null,
        autoCompactTokenLimit: null
      });
      expect(store.getProvider(String(cloned.body.id))).toMatchObject(limits);
      expect(store.getProvider(String(imported.body.id))).toMatchObject(limits);
      expect(JSON.parse(store.getProvider(claudeId)!.modelsJson!)).toContain(
        "claude-sonnet-fixture"
      );
    } finally {
      store.db.close();
    }
  }, 20_000);
});
