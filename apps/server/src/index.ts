import { mkdir, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { Store, type ProviderRow } from "@codex-omni/db";
import {
  normalizeProviderHomeMode,
  providerInputSchema,
  runCommandSchema
} from "@codex-omni/protocol";
import { assertExternalCodexHome, resolveProviderHome } from "@codex-omni/codex-runtime";
import { authenticate, createInitialAdmin, hasUsers, initAuth, login } from "./auth.js";
import { browseDirectory } from "./filesystem.js";
import {
  buildApiKeyProviderFiles,
  parseMcpServers,
  parseModelsFromConfigToml,
  removeMcpServer,
  setMcpServerEnabled,
  upsertMcpServer
} from "./config-toml.js";
import {
  cloneProviderName,
  enhancePrompt,
  filterModels,
  parseProviderImport,
  serializeProviderExport,
  testProviderConnection
} from "./provider-ops.js";
import { parsePlanTasks, summarizeRuns } from "./workspace-loop.js";
import { readAgentsMarkdown, writeAgentsMarkdown } from "./project-knowledge.js";
import { listProjectSkills, listProviderSkills } from "./skills-mcp.js";
import {
  publicOperation,
  recordOperation,
  snapshotForUndo,
  undoOperation
} from "./operation-log.js";
import { nextRunAt, startScheduledJobs } from "./scheduled-jobs.js";
import { RunManager } from "./run-manager.js";
import { TerminalManager, terminalHostLabel } from "./terminal-manager.js";
import { compactMessageForClient } from "./session-history.js";
import { searchWorkspace } from "./workspace-search.js";
import { collectHostInfo } from "./host-info.js";
import { UpdateCheckService } from "./update-check.js";
import { resolveStaticDir } from "./static-dir.js";
import { resolveDatabasePath } from "./database-path.js";
import {
  applyGitHunk,
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  discardGitFiles,
  gitCommitDetail,
  gitDiff,
  gitRemoteAction,
  gitStatus,
  listGitBranches,
  listGitLog,
  resolveGitConflict,
  restoreGitCheckpoint,
  suggestGitMessage
} from "./project-git.js";
import {
  MAX_EDITABLE_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  copyProjectEntry,
  createProjectEntry,
  deleteProjectEntry,
  listProjectDirectory,
  readProjectBinaryFile,
  readProjectTextFile,
  renameProjectEntry,
  searchProjectFiles,
  statProjectFile,
  writeProjectBinaryFile,
  writeProjectTextFile
} from "./project-file.js";
import { analyzeProjectDocument } from "./project-language.js";
const root = path.resolve(process.cwd());
const execFileAsync = promisify(execFile);
const dataPath = resolveDatabasePath(root);
await mkdir(path.dirname(dataPath), { recursive: true });
const store = new Store(dataPath);
initAuth(store.db);
const app = Fastify({ logger: true });
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
await app.register(cookie);
const configuredOrigins = (process.env.CODEX_OMNI_ORIGIN ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes("*")) {
      callback(null, true);
      return;
    }
    callback(null, configuredOrigins.includes(origin));
  },
  credentials: true
});
await app.register(websocket);
const auth = authenticate(store.db);
const runtimeRoot = path.join(path.dirname(dataPath), "runtime");
const providersRoot = path.join(runtimeRoot, "providers");
const defaultCodexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
const routeParam = (req: { params: unknown }, name: string) => {
  const value = z.record(z.string(), z.unknown()).parse(req.params ?? {})[name];
  const parsed = z.string().min(1).safeParse(value);
  if (!parsed.success) throw httpError(400, `缺少路径参数 ${name}`);
  return parsed.data;
};
const routeId = (req: { params: unknown }) => routeParam(req, "id");
const queryValue = (req: { query: unknown }, name: string) => {
  const value = z.record(z.string(), z.unknown()).parse(req.query ?? {})[name];
  return typeof value === "string" ? value : undefined;
};
const providerHome = (provider: ProviderRow) =>
  resolveProviderHome({
    providersRoot,
    providerId: provider.id,
    homeMode: provider.homeMode,
    codexHomePath: provider.codexHomePath,
    configToml: provider.configToml,
    authJson: provider.authJson
  });
const runs = new RunManager(store, runtimeRoot);
const terminals = new TerminalManager();
const updateCheck = new UpdateCheckService();
runs.reconcileStartup();
const stopScheduledJobs = startScheduledJobs(store, runs);
const getProjectRoot = async (projectId: string) => {
  const project = store.getProject(projectId);
  if (!project) throw new Error("Project not found");
  return { project, rootPath: await realpath(project.realPath) };
};
const runGit = async (
  cwd: string,
  args: string[],
  options: { allowExitCodeOne?: boolean } = {}
) => {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (reason) {
    const error = reason as Error & { code?: number; stdout?: string; stderr?: string };
    if (options.allowExitCodeOne && error.code === 1)
      return { stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    throw new Error((error.stderr || error.stdout || error.message).trim());
  }
};
const gitPathList = z.array(z.string().min(1)).min(1).max(500);
const publicProvider = (provider: ReturnType<typeof store.getProvider>) => {
  if (!provider) return null;
  let models: string[] = [];
  let messageEnvVars: Record<string, string> = {};
  try {
    models = provider.modelsJson ? JSON.parse(provider.modelsJson) : [];
  } catch {
    models = [];
  }
  if (!Array.isArray(models)) models = [];
  models = models.map((model) => String(model).trim()).filter(Boolean);
  if (!models.length) models = parseModelsFromConfigToml(provider.configToml);
  if (provider.model && !models.includes(provider.model)) models.unshift(provider.model);
  try {
    messageEnvVars = provider.envJson ? JSON.parse(provider.envJson) : {};
  } catch {
    messageEnvVars = {};
  }
  const homeMode = normalizeProviderHomeMode(provider.homeMode);
  const codexHomePath = homeMode === "external" ? provider.codexHomePath : null;
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    model: provider.model,
    models,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ? "••••••••" : null,
    configToml: provider.configToml,
    authJson: provider.authJson ? "configured" : null,
    messageEnvVars,
    isDefault: Boolean(provider.isDefault),
    homeMode,
    codexHomePath,
    codexHome:
      homeMode === "external" && codexHomePath
        ? path.resolve(codexHomePath)
        : path.join(providersRoot, provider.id)
  };
};
const persistProvider = (provider: ProviderRow, patch: Partial<ProviderRow> = {}) =>
  store.upsertProvider({
    ...provider,
    ...patch,
    name: patch.name ?? provider.name
  });
const providerFilesFromInput = async (
  input: ReturnType<typeof providerInputSchema.parse>,
  current?: ProviderRow
) => {
  const homeMode =
    input.homeMode ??
    (current
      ? normalizeProviderHomeMode(current.homeMode)
      : input.configToml?.trim() && input.authJson?.trim()
        ? "managed"
        : "api-key");
  const apiKey =
    input.apiKey === "••••••••"
      ? (current?.apiKey ?? null)
      : (input.apiKey ?? current?.apiKey ?? null);
  const authJson =
    input.authJson === "configured"
      ? (current?.authJson ?? null)
      : (input.authJson ?? current?.authJson ?? null);
  if (homeMode === "api-key") {
    const key = apiKey?.trim();
    if (!key) throw httpError(400, "API Key 为必填项");
    const files = buildApiKeyProviderFiles({
      name: input.name,
      model: input.model ?? current?.model ?? null,
      baseUrl: input.baseUrl ?? current?.baseUrl ?? null,
      apiKey: key
    });
    return {
      homeMode,
      codexHomePath: null as string | null,
      configToml: files.configToml,
      authJson: files.authJson,
      apiKey: key
    };
  }
  if (homeMode === "external") {
    try {
      const home = await assertExternalCodexHome(input.codexHomePath ?? current?.codexHomePath);
      return {
        homeMode,
        codexHomePath: home,
        configToml: input.configToml ?? current?.configToml ?? null,
        authJson,
        apiKey
      };
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        statusCode: 400
      });
    }
  }
  const configToml = input.configToml ?? current?.configToml;
  if (!configToml?.trim()) throw httpError(400, "config.toml 为必填项");
  if (!authJson?.trim()) throw httpError(400, "auth.json 为必填项");
  if (authJson !== current?.authJson) {
    try {
      JSON.parse(authJson);
    } catch {
      throw httpError(400, "auth.json 必须是有效的 JSON");
    }
  }
  return {
    homeMode,
    codexHomePath: null as string | null,
    configToml,
    authJson,
    apiKey
  };
};
const defaultSettings = {
  sandbox: "workspace-write" as const,
  approvalPolicy: "on-request" as const,
  networkAccessEnabled: true,
  showReasoning: false,
  expandToolCalls: true,
  sendWithEnter: true,
  showProviderLabels: true,
  executionMode: "execute" as const,
  uiFontSize: 14
};
const sessionCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/"
};
app.get("/api/health", async () => ({ ok: true }));
app.get("/api/auth/status", async () => ({ setupRequired: !hasUsers(store.db) }));
app.post("/api/auth/setup", async (req, reply) => {
  const body = z
    .object({
      username: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9._-]+$/, "用户名仅支持字母、数字、点、下划线和短横线"),
      password: z.string().min(8).max(200)
    })
    .parse(req.body);
  const created = await createInitialAdmin(store.db, body.username, body.password);
  if (!created) return reply.code(409).send({ error: "管理员账户已存在，请直接登录" });
  const result = await login(store.db, body.username, body.password);
  if (!result) return reply.code(500).send({ error: "创建账户后登录失败" });
  reply.setCookie("codex_web_session", result.token, sessionCookie);
  return { user: result.user, csrfToken: result.csrf };
});
app.post("/api/auth/login", async (req, reply) => {
  const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
  const result = await login(store.db, body.username, body.password);
  if (!result) return reply.code(401).send({ error: "Account or password is incorrect" });
  reply.setCookie("codex_web_session", result.token, sessionCookie);
  return { user: result.user, csrfToken: result.csrf };
});
app.get("/api/auth/session", { preHandler: auth }, async (req) => {
  const row = store.db
    .prepare("SELECT csrf_token as csrf FROM login_sessions WHERE id=?")
    .get(req.authSessionId) as { csrf: string } | undefined;
  return { user: req.user, csrfToken: row?.csrf };
});
app.post("/api/auth/logout", { preHandler: auth }, async (req, reply) => {
  store.db.prepare("DELETE FROM login_sessions WHERE id=?").run(req.authSessionId);
  reply.clearCookie("codex_web_session", { path: "/" });
  return { ok: true };
});
app.get("/api/providers", { preHandler: auth }, async () =>
  store.listProviders().map((provider) => publicProvider(provider))
);
app.get("/api/providers/:id", { preHandler: auth }, async (req) => {
  return publicProvider(store.getProvider(routeId(req)));
});
app.post("/api/providers", { preHandler: auth }, async (req) => {
  const input = providerInputSchema.parse(req.body);
  const files = await providerFilesFromInput(input);
  return publicProvider(
    store.upsertProvider({
      name: input.name,
      kind: input.kind ?? "codex",
      model: input.model ?? null,
      modelsJson: JSON.stringify(input.models ?? []),
      baseUrl: input.baseUrl ?? null,
      apiKey: files.apiKey,
      configToml: files.configToml,
      authJson: files.authJson,
      envJson: JSON.stringify(input.messageEnvVars ?? {}),
      isDefault: input.isDefault ? 1 : 0,
      homeMode: files.homeMode,
      codexHomePath: files.codexHomePath
    })
  );
});
app.put("/api/providers/:id", { preHandler: auth }, async (req) => {
  const id = routeId(req);
  const current = store.getProvider(id);
  if (!current) throw httpError(404, "Provider not found");
  const input = providerInputSchema.omit({ id: true }).parse(req.body);
  const files = await providerFilesFromInput(input, current);
  return publicProvider(
    store.upsertProvider({
      id,
      name: input.name,
      kind: input.kind ?? current.kind,
      model: input.model ?? null,
      modelsJson: JSON.stringify(input.models ?? []),
      baseUrl: input.baseUrl ?? null,
      apiKey: files.apiKey,
      configToml: files.configToml,
      authJson: files.authJson,
      envJson: JSON.stringify(input.messageEnvVars ?? {}),
      isDefault: (input.isDefault ?? Boolean(current.isDefault)) ? 1 : 0,
      homeMode: files.homeMode,
      codexHomePath: files.codexHomePath
    })
  );
});
app.delete("/api/providers/:id", { preHandler: auth }, async (req, reply) => {
  const deleted = store.deleteProvider(routeId(req));
  if (!deleted) return reply.code(404).send({ error: "Provider not found" });
  return { ok: true };
});
app.get("/api/providers/:id/export", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  const published = publicProvider(provider);
  return serializeProviderExport({
    name: provider.name,
    kind: provider.kind,
    model: provider.model,
    models: published?.models ?? [],
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    configToml: provider.configToml,
    authJson: provider.authJson,
    messageEnvVars: published?.messageEnvVars ?? {},
    homeMode: provider.homeMode,
    codexHomePath: provider.codexHomePath
  });
});
app.post("/api/providers/import", { preHandler: auth }, async (req) => {
  const input = parseProviderImport(req.body);
  const files = await providerFilesFromInput(input);
  return publicProvider(
    store.upsertProvider({
      name: input.name,
      kind: input.kind,
      model: input.model,
      modelsJson: JSON.stringify(input.models),
      baseUrl: input.baseUrl,
      apiKey: files.apiKey,
      configToml: files.configToml,
      authJson: files.authJson,
      envJson: JSON.stringify(input.messageEnvVars),
      homeMode: files.homeMode,
      codexHomePath: files.codexHomePath
    })
  );
});
app.post("/api/providers/:id/clone", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  return publicProvider(
    store.upsertProvider({
      name: cloneProviderName(provider.name),
      kind: provider.kind,
      model: provider.model,
      modelsJson: provider.modelsJson,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      configToml: provider.configToml,
      authJson: provider.authJson,
      envJson: provider.envJson,
      isDefault: 0,
      homeMode: provider.homeMode,
      codexHomePath: provider.codexHomePath
    })
  );
});
app.post("/api/providers/:id/test", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  const result = await testProviderConnection({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    configToml: provider.configToml,
    authJson: provider.authJson
  });
  // Keep the fetched catalog with the provider. The chat composer reads its
  // model list from /api/providers, so a successful fetch must not disappear
  // with the dialog that initiated it.
  if (result.models.length) {
    store.upsertProvider({
      ...provider,
      modelsJson: JSON.stringify(result.models)
    });
  }
  return result;
});
app.post("/api/providers/:id/enhance", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  const body = z
    .object({ text: z.string().min(1).max(20_000), model: z.string().optional() })
    .parse(req.body);
  return enhancePrompt({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    configToml: provider.configToml,
    authJson: provider.authJson,
    model: body.model ?? provider.model ?? null,
    text: body.text
  });
});
app.get("/api/providers/:id/models", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  const query = z.string().optional().parse(queryValue(req, "q"));
  const published = publicProvider(provider);
  const result = await testProviderConnection({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    configToml: provider.configToml,
    authJson: provider.authJson
  });
  const models = filterModels(
    result.models.length ? result.models : (published?.models ?? []),
    query
  );
  return { models, fetched: result.fetched ?? 0, error: result.ok ? undefined : result.error };
});
app.get("/api/runtime", { preHandler: auth }, async () => ({
  defaultCodexHome,
  providersRoot,
  host: await collectHostInfo(path.dirname(dataPath))
}));
app.get("/api/system/version", { preHandler: auth }, async () => updateCheck.snapshot());
app.post("/api/system/update/check", { preHandler: auth }, async () => updateCheck.check());
app.get("/api/settings", { preHandler: auth }, async () => store.getSettings(defaultSettings));
app.put("/api/settings", { preHandler: auth }, async (req) => {
  const settings = z
    .object({
      sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]),
      approvalPolicy: z.enum(["untrusted", "on-request", "never"]),
      networkAccessEnabled: z.boolean(),
      showReasoning: z.boolean(),
      expandToolCalls: z.boolean(),
      sendWithEnter: z.boolean(),
      showProviderLabels: z.boolean(),
      executionMode: z.enum(["plan", "execute"]).optional(),
      uiFontSize: z
        .union([z.literal(13), z.literal(14), z.literal(15), z.literal(16), z.literal(18)])
        .optional()
    })
    .parse(req.body);
  store.updateSettings(settings);
  return settings;
});
app.get("/api/projects", { preHandler: auth }, async () => store.listProjects());
app.get("/api/filesystem/browse", { preHandler: auth }, async (req) => {
  const pathValue = z.string().optional().parse(queryValue(req, "path"));
  return browseDirectory(pathValue);
});
app.get("/api/projects/:id/files", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const relativePath = z
    .string()
    .optional()
    .parse(queryValue(req, "path") ?? "");
  return listProjectDirectory(rootPath, relativePath ?? "");
});
app.get("/api/projects/:id/files/search", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const query = z
    .object({
      q: z.string().min(1),
      content: z.enum(["true", "false"]).optional()
    })
    .parse(req.query);
  return searchProjectFiles({
    rootPath,
    query: query.q,
    content: query.content === "true"
  });
});
app.post("/api/projects/:id/language", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z
    .object({
      path: z.string().min(1),
      content: z.string().max(400_000),
      line: z.number().int().min(1).optional(),
      column: z.number().int().min(1).optional()
    })
    .parse(req.body);
  return analyzeProjectDocument({
    rootPath,
    relativePath: body.path,
    content: body.content,
    ...(body.line ? { line: body.line } : {}),
    ...(body.column ? { column: body.column } : {})
  });
});
app.get("/api/projects/:id/files/download", { preHandler: auth }, async (req, reply) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const relativePath = z.string().min(1).parse(queryValue(req, "path"));
  const inline = queryValue(req, "inline") === "1" || queryValue(req, "inline") === "true";
  const file = await readProjectBinaryFile(rootPath, relativePath);
  reply.header("content-type", file.contentType);
  reply.header(
    "content-disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`
  );
  reply.header("x-file-path", encodeURIComponent(file.path));
  return reply.send(file.buffer);
});
app.post("/api/projects/:id/files", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z
    .object({
      path: z.string().min(1),
      type: z.enum(["file", "directory"]),
      content: z.string().optional()
    })
    .parse(req.body);
  return createProjectEntry({
    rootPath,
    relativePath: body.path,
    type: body.type,
    ...(body.content === undefined ? {} : { content: body.content })
  });
});
app.post("/api/projects/:id/files/rename", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(req.body);
  return renameProjectEntry({ rootPath, from: body.from, to: body.to });
});
app.post("/api/projects/:id/files/copy", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(req.body);
  return copyProjectEntry({ rootPath, from: body.from, to: body.to });
});
app.delete("/api/projects/:id/files", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const relativePath = z.string().min(1).parse(queryValue(req, "path"));
  return deleteProjectEntry(rootPath, relativePath);
});
app.put(
  "/api/projects/:id/files/upload",
  { preHandler: auth, bodyLimit: MAX_UPLOAD_BYTES + 64 * 1024 },
  async (req) => {
    const { rootPath } = await getProjectRoot(routeId(req));
    const query = z
      .object({
        path: z.string().min(1),
        overwrite: z.enum(["true", "false"]).optional()
      })
      .parse(req.query);
    if (!Buffer.isBuffer(req.body)) {
      throw Object.assign(new Error("请使用二进制上传"), { statusCode: 400 });
    }
    return writeProjectBinaryFile({
      rootPath,
      relativePath: query.path,
      buffer: req.body,
      overwrite: query.overwrite === "true"
    });
  }
);
app.get("/api/projects/:id/file", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const relativePath = z.string().min(1).parse(queryValue(req, "path"));
  return readProjectTextFile(rootPath, relativePath);
});
app.get("/api/projects/:id/file/meta", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const relativePath = z.string().min(1).parse(queryValue(req, "path"));
  return statProjectFile(rootPath, relativePath);
});
app.put(
  "/api/projects/:id/file",
  { preHandler: auth, bodyLimit: MAX_EDITABLE_FILE_BYTES * 6 + 64 * 1024 },
  async (req) => {
    const { rootPath } = await getProjectRoot(routeId(req));
    const body = z
      .object({
        path: z.string().min(1),
        content: z.string(),
        revision: z.string().min(1)
      })
      .parse(req.body);
    return writeProjectTextFile({
      rootPath,
      relativePath: body.path,
      content: body.content,
      expectedRevision: body.revision
    });
  }
);
app.get("/api/projects/:id/git/status", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  return gitStatus(rootPath);
});
app.get("/api/projects/:id/git/diff", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const query = z
    .object({
      path: z.string().min(1),
      staged: z.enum(["true", "false"]).default("false"),
      commit: z
        .string()
        .regex(/^[0-9a-fA-F]{4,40}$/)
        .optional()
    })
    .parse(req.query);
  return gitDiff(
    rootPath,
    query.path,
    query.staged === "true",
    query.commit ? { commit: query.commit } : {}
  );
});
app.post("/api/projects/:id/git/stage", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  const { rootPath } = await getProjectRoot(projectId);
  const { paths } = z.object({ paths: gitPathList }).parse(req.body);
  const undo = await snapshotForUndo(rootPath);
  await runGit(rootPath, ["add", "--", ...paths]);
  recordOperation(store, {
    projectId,
    kind: "git.stage",
    title: `暂存 ${paths.length} 个文件`,
    detail: { paths },
    undo
  });
  return { ok: true };
});
app.post("/api/projects/:id/git/unstage", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  const { rootPath } = await getProjectRoot(projectId);
  const { paths } = z.object({ paths: gitPathList }).parse(req.body);
  const undo = await snapshotForUndo(rootPath);
  try {
    await runGit(rootPath, ["restore", "--staged", "--", ...paths]);
  } catch {
    await runGit(rootPath, ["rm", "--cached", "-r", "--", ...paths]);
  }
  recordOperation(store, {
    projectId,
    kind: "git.unstage",
    title: `取消暂存 ${paths.length} 个文件`,
    detail: { paths },
    undo
  });
  return { ok: true };
});
app.post("/api/projects/:id/git/commit", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  const { rootPath } = await getProjectRoot(projectId);
  const { message } = z.object({ message: z.string().trim().min(1).max(5000) }).parse(req.body);
  const result = await runGit(rootPath, ["commit", "-m", message]);
  const hash = (await runGit(rootPath, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  recordOperation(store, {
    projectId,
    kind: "git.commit",
    title: `提交 ${hash}`,
    detail: { hash, message }
  });
  return { ok: true, output: result.stdout.trim(), hash };
});
app.post("/api/projects/:id/git/suggest-message", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const { kind } = z
    .object({ kind: z.enum(["commit", "summary", "release"]).default("commit") })
    .parse(req.body ?? {});
  return suggestGitMessage(rootPath, kind);
});
app.post("/api/projects/:id/git/hunk", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z
    .object({
      path: z.string().min(1),
      staged: z.boolean().optional(),
      hunkIndex: z.number().int().min(0),
      action: z.enum(["stage", "unstage", "discard"])
    })
    .parse(req.body);
  const undo = body.action === "discard" ? await snapshotForUndo(rootPath) : undefined;
  const result = await applyGitHunk({
    rootPath,
    relativePath: body.path,
    staged: body.staged === true,
    hunkIndex: body.hunkIndex,
    action: body.action
  });
  recordOperation(store, {
    projectId: routeId(req),
    kind: `git.hunk.${body.action}`,
    title: `${body.action} ${body.path} hunk ${body.hunkIndex + 1}`,
    detail: { path: body.path, hunkIndex: body.hunkIndex, action: body.action },
    undo
  });
  return result;
});
app.post("/api/projects/:id/git/discard", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  const { rootPath } = await getProjectRoot(projectId);
  const { paths } = z.object({ paths: gitPathList }).parse(req.body);
  const undo = await snapshotForUndo(rootPath);
  const result = await discardGitFiles(rootPath, paths);
  recordOperation(store, {
    projectId,
    kind: "git.discard",
    title: `丢弃 ${paths.length} 个文件的本地修改`,
    detail: { paths },
    undo
  });
  return result;
});
app.get("/api/projects/:id/git/branches", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  return { branches: await listGitBranches(rootPath) };
});
app.post("/api/projects/:id/git/branches", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z
    .object({ name: z.string().min(1).max(200), checkout: z.boolean().optional() })
    .parse(req.body);
  return createGitBranch(rootPath, body.name, body.checkout === true);
});
app.post("/api/projects/:id/git/checkout", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z.object({ name: z.string().min(1).max(200) }).parse(req.body);
  return checkoutGitBranch(rootPath, body.name);
});
app.delete("/api/projects/:id/git/branches", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const name = z.string().min(1).parse(queryValue(req, "name"));
  return deleteGitBranch(rootPath, name);
});
app.get("/api/projects/:id/git/log", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const limit = z.coerce.number().int().min(1).max(100).optional().parse(queryValue(req, "limit"));
  return { commits: await listGitLog(rootPath, limit ?? 40) };
});
app.get("/api/projects/:id/git/commit/:hash", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  return gitCommitDetail(rootPath, routeParam(req, "hash"));
});
app.post("/api/projects/:id/git/remote", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z.object({ action: z.enum(["fetch", "pull", "push"]) }).parse(req.body);
  return gitRemoteAction(rootPath, body.action);
});
app.post("/api/projects/:id/git/conflict", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z
    .object({
      path: z.string().min(1),
      strategy: z.enum(["ours", "theirs", "mark"])
    })
    .parse(req.body);
  return resolveGitConflict(rootPath, body.path, body.strategy);
});
app.post("/api/projects", { preHandler: auth }, async (req) => {
  const body = z
    .object({
      name: z.string().min(1),
      path: z.string().min(1),
      providerId: z.string().nullable().optional()
    })
    .parse(req.body);
  const resolved = await realpath(body.path);
  if (!(await stat(resolved)).isDirectory()) throw new Error("Project path is not a directory");
  return store.createProject({
    name: body.name,
    displayPath: body.path,
    realPath: resolved,
    ...(body.providerId !== undefined ? { providerId: body.providerId } : {})
  });
});
app.put("/api/projects/:id", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const current = store.getProject(id);
  if (!current) return reply.code(404).send({ error: "Project not found" });
  const input = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      pinned: z.boolean().optional(),
      opened: z.boolean().optional()
    })
    .refine((value) => Object.keys(value).length > 0, "No changes provided")
    .parse(req.body ?? {});
  return store.updateProject(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? Date.now() : null } : {}),
    ...(input.opened ? { lastOpenedAt: Date.now() } : {})
  });
});
app.delete("/api/projects/:id", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const project = store.getProject(id);
  if (!project) return reply.code(404).send({ error: "Project not found" });
  for (const session of store.listSessions(id)) runs.cancel(session.id);
  terminals.closeProject(id);
  store.deleteProject(id);
  return { ok: true };
});
app.get("/api/search", { preHandler: auth }, async (req) => {
  const query = z
    .object({
      q: z.string().trim().min(1).max(200),
      projectId: z.string().min(1).optional(),
      scope: z.enum(["all", "project", "session", "message", "file", "git"]).optional(),
      status: z.enum(["idle", "running", "failed", "cancelled", "interrupted"]).optional()
    })
    .parse(req.query ?? {});
  let rootPath: string | undefined;
  if (query.projectId) {
    try {
      rootPath = (await getProjectRoot(query.projectId)).rootPath;
    } catch {
      rootPath = undefined;
    }
  }
  return searchWorkspace({
    store,
    query: query.q,
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(rootPath ? { rootPath } : {}),
    ...(query.scope ? { scope: query.scope } : {}),
    ...(query.status ? { status: query.status } : {})
  });
});
app.get("/api/projects/:id/sessions", { preHandler: auth }, async (req) => {
  const query = z
    .object({
      q: z.string().max(200).optional(),
      archived: z.enum(["true", "false"]).optional(),
      status: z.enum(["idle", "running", "failed", "cancelled", "interrupted"]).optional()
    })
    .parse(req.query ?? {});
  return store.listSessions(routeId(req), {
    ...(query.q ? { query: query.q } : {}),
    includeArchived: query.archived === "true",
    ...(query.status ? { status: query.status } : {})
  });
});
app.post("/api/projects/:id/sessions", { preHandler: auth }, async (req) => {
  const body = z
    .object({ title: z.string().optional(), providerId: z.string().nullable().optional() })
    .parse(req.body ?? {});
  return store.createSession({
    projectId: routeId(req),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.providerId !== undefined ? { providerId: body.providerId } : {})
  });
});
app.get("/api/sessions/:id", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const session = store.getSession(id);
  if (!session) return reply.code(404).send({ error: "Session not found" });
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      beforeCreatedAt: z.coerce.number().int().optional(),
      beforeId: z.string().min(1).optional()
    })
    .superRefine((value, context) => {
      if ((value.beforeCreatedAt == null) !== (value.beforeId == null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "beforeCreatedAt and beforeId must be provided together"
        });
      }
    })
    .parse(req.query ?? {});
  const page = store.listMessagePage(id, {
    limit: query.limit,
    ...(query.beforeCreatedAt != null && query.beforeId
      ? { before: { createdAt: query.beforeCreatedAt, id: query.beforeId } }
      : {})
  });
  const latestRun = store.getLatestRunMessage(id);
  return {
    session,
    ...page,
    messages: page.messages.map(compactMessageForClient),
    latestRun: latestRun ? compactMessageForClient(latestRun) : null
  };
});
app.put("/api/sessions/:id", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const current = store.getSession(id);
  if (!current) return reply.code(404).send({ error: "Session not found" });
  const input = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
      color: z.string().trim().max(32).nullable().optional(),
      icon: z.string().trim().max(32).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(24)).max(8).optional()
    })
    .refine((value) => Object.keys(value).length > 0, "No changes provided")
    .parse(req.body ?? {});
  return store.updateSession(id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? Date.now() : null } : {}),
    ...(input.archived !== undefined ? { archivedAt: input.archived ? Date.now() : null } : {}),
    ...(input.color !== undefined ? { color: input.color || null } : {}),
    ...(input.icon !== undefined ? { icon: input.icon || null } : {}),
    ...(input.tags !== undefined ? { tagsJson: JSON.stringify(input.tags) } : {})
  });
});
app.get("/api/sessions/:id/export", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const session = store.getSession(id);
  if (!session) return reply.code(404).send({ error: "Session not found" });
  const project = store.getProject(session.projectId);
  const query = z
    .object({
      format: z.enum(["markdown", "json"]).default("markdown"),
      reasoning: z.enum(["true", "false"]).default("true"),
      tools: z.enum(["true", "false"]).default("true")
    })
    .parse(req.query ?? {});
  const messages = store.listMessages(id).filter((message) => {
    if (message.role === "reasoning" && query.reasoning !== "true") return false;
    if (["tool", "file", "approval", "run"].includes(message.role) && query.tools !== "true")
      return false;
    return true;
  });
  const safeName = session.title.replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 80) || "session";
  if (query.format === "json") {
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.json`
    );
    return JSON.stringify({ project, session, messages }, null, 2);
  }
  const roleLabels: Record<string, string> = {
    user: "用户",
    assistant: "Codex",
    reasoning: "推理",
    tool: "工具",
    file: "文件变更",
    approval: "审批",
    error: "错误",
    run: "运行状态",
    system: "系统"
  };
  const markdown = [
    `# ${session.title}`,
    "",
    project ? `- 工程：${project.name}` : "",
    `- Session ID：\`${session.id}\``,
    session.threadId ? `- Codex Thread ID：\`${session.threadId}\`` : "",
    "",
    ...messages.flatMap((message) => [
      `## ${roleLabels[message.role] ?? message.role}`,
      "",
      message.content || "_(无文本内容)_",
      ""
    ])
  ]
    .filter((line) => line !== "")
    .join("\n\n");
  reply.header("Content-Type", "text/markdown; charset=utf-8");
  reply.header(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.md`
  );
  return markdown;
});
app.delete("/api/sessions/:id", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const session = store.getSession(id);
  if (!session) return reply.code(404).send({ error: "Session not found" });
  runs.cancel(id);
  store.deleteSession(id);
  return { ok: true };
});
app.post("/api/sessions/:id/continue", { preHandler: auth }, async (req) => {
  const source = store.getSession(routeId(req));
  if (!source) throw new Error("Source session not found");
  const body = z
    .object({
      providerId: z.string().nullable().optional(),
      title: z.string().optional(),
      model: z.string().optional()
    })
    .parse(req.body ?? {});
  const providerId = body.providerId ?? source.providerId ?? null;
  const target = store.createSession({
    projectId: source.projectId,
    title: body.title?.trim() || source.title,
    ...(providerId ? { providerId } : {}),
    parentSessionId: source.id,
    continuationMode: "portable-context"
  });
  const context = store
    .listRecentConversationMessages(source.id, 20)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  store.addMessage({
    sessionId: target.id,
    role: "system",
    content: `Continued from session ${source.id}. Portable context:\n\n${context}`,
    providerId,
    eventType: "provider.continuation"
  });
  return {
    ...target,
    bootstrapPrompt: `Continue this coding conversation using the portable history below. Do not repeat it; respond to the next user request in context.\n\n${context}`
  };
});
app.post("/api/sessions/:id/fork", { preHandler: auth }, async (req, reply) => {
  const source = store.getSession(routeId(req));
  if (!source) return reply.code(404).send({ error: "Session not found" });
  const body = z.object({ messageId: z.string().min(1).optional() }).parse(req.body ?? {});
  const forked = store.forkSession(source.id, body.messageId);
  if (!forked) return reply.code(404).send({ error: "Session not found" });
  return forked;
});
app.post("/api/sessions/:id/clear-runs", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const session = store.getSession(id);
  if (!session) return reply.code(404).send({ error: "Session not found" });
  if (session.status === "running") {
    return reply.code(409).send({ error: "Cannot clear run records while the session is running" });
  }
  return store.clearSessionRunRecords(id);
});
app.get("/api/approvals", { preHandler: auth }, async (req) => {
  const query = z
    .object({
      projectId: z.string().min(1).optional(),
      sessionId: z.string().min(1).optional(),
      status: z.enum(["pending", "accepted", "declined", "cancelled", "expired"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional()
    })
    .parse(req.query ?? {});
  return store.listApprovals({
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.sessionId ? { sessionId: query.sessionId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.limit ? { limit: query.limit } : {})
  });
});
app.get("/api/approvals/stats", { preHandler: auth }, async (req) => {
  const query = z
    .object({
      projectId: z.string().min(1).optional(),
      sessionId: z.string().min(1).optional()
    })
    .parse(req.query ?? {});
  return store.approvalStats({
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.sessionId ? { sessionId: query.sessionId } : {})
  });
});
app.get("/api/runs/active", { preHandler: auth }, async () => runs.listActiveRuns());
app.get("/api/stats", { preHandler: auth }, async (req) => {
  const query = z
    .object({
      projectId: z.string().optional(),
      sessionId: z.string().optional()
    })
    .parse(req.query);
  const items = store.listRuns({
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.sessionId ? { sessionId: query.sessionId } : {}),
    limit: 100
  });
  return summarizeRuns(items);
});
app.get("/api/templates", { preHandler: auth }, async () => store.listPromptTemplates());
app.post("/api/templates", { preHandler: auth }, async (req) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(80),
      command: z.string().trim().max(40).optional(),
      content: z.string().trim().min(1).max(20_000)
    })
    .parse(req.body);
  return store.upsertPromptTemplate({
    name: body.name,
    command: body.command
      ? body.command.startsWith("/")
        ? body.command
        : `/${body.command}`
      : null,
    content: body.content
  });
});
app.put("/api/templates/:id", { preHandler: auth }, async (req) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(80),
      command: z.string().trim().max(40).optional(),
      content: z.string().trim().min(1).max(20_000)
    })
    .parse(req.body);
  return store.upsertPromptTemplate({
    id: routeId(req),
    name: body.name,
    command: body.command
      ? body.command.startsWith("/")
        ? body.command
        : `/${body.command}`
      : null,
    content: body.content
  });
});
app.delete("/api/templates/:id", { preHandler: auth }, async (req, reply) => {
  if (!store.deletePromptTemplate(routeId(req)))
    return reply.code(404).send({ error: "Template not found" });
  return { ok: true };
});
app.get("/api/projects/:id/tasks", { preHandler: auth }, async (req) => {
  await getProjectRoot(routeId(req));
  return store.listTasks(routeId(req)).map((task) => ({
    ...task,
    relatedFiles: task.relatedFilesJson ? JSON.parse(task.relatedFilesJson) : []
  }));
});
app.post("/api/projects/:id/tasks", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  await getProjectRoot(projectId);
  const body = z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional(),
      status: z.enum(["todo", "doing", "done", "blocked"]).optional(),
      sessionId: z.string().optional(),
      relatedFiles: z.array(z.string()).optional(),
      relatedCommit: z.string().optional()
    })
    .parse(req.body);
  return store.upsertTask({
    projectId,
    title: body.title,
    description: body.description ?? null,
    status: body.status ?? "todo",
    sessionId: body.sessionId ?? null,
    relatedFilesJson: JSON.stringify(body.relatedFiles ?? []),
    relatedCommit: body.relatedCommit ?? null
  });
});
app.post("/api/projects/:id/tasks/from-plan", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  await getProjectRoot(projectId);
  const body = z
    .object({
      text: z.string().min(1),
      sessionId: z.string().optional()
    })
    .parse(req.body);
  const titles = parsePlanTasks(body.text);
  if (!titles.length) throw Object.assign(new Error("没有从计划中解析到任务"), { statusCode: 400 });
  return titles.map((title) =>
    store.upsertTask({
      projectId,
      title,
      sessionId: body.sessionId ?? null,
      status: "todo"
    })
  );
});
app.put("/api/tasks/:id", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const existing = store.getTask(id);
  if (!existing) return reply.code(404).send({ error: "Task not found" });
  const body = z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional(),
      status: z.enum(["todo", "doing", "done", "blocked"]).optional(),
      sessionId: z.string().nullable().optional(),
      relatedFiles: z.array(z.string()).optional(),
      relatedCommit: z.string().nullable().optional()
    })
    .parse(req.body);
  return store.upsertTask({
    id,
    projectId: existing.projectId,
    title: body.title,
    description: body.description ?? existing.description,
    status: body.status ?? existing.status,
    sessionId: body.sessionId === undefined ? existing.sessionId : body.sessionId,
    relatedFilesJson: JSON.stringify(
      body.relatedFiles ?? JSON.parse(existing.relatedFilesJson ?? "[]")
    ),
    relatedCommit: body.relatedCommit === undefined ? existing.relatedCommit : body.relatedCommit
  });
});
app.delete("/api/tasks/:id", { preHandler: auth }, async (req, reply) => {
  if (!store.deleteTask(routeId(req))) return reply.code(404).send({ error: "Task not found" });
  return { ok: true };
});
app.get("/api/sessions/:id/checkpoints", { preHandler: auth }, async (req, reply) => {
  const session = store.getSession(routeId(req));
  if (!session) return reply.code(404).send({ error: "Session not found" });
  return store.listCheckpoints(session.id).map((item) => ({
    id: item.id,
    sessionId: item.sessionId,
    projectId: item.projectId,
    runId: item.runId,
    title: item.title,
    gitHead: item.gitHead,
    gitBranch: item.gitBranch,
    files: item.filesJson ? JSON.parse(item.filesJson) : [],
    createdAt: item.createdAt
  }));
});
app.post("/api/checkpoints/:id/restore", { preHandler: auth }, async (req, reply) => {
  const checkpoint = store.getCheckpoint(routeId(req));
  if (!checkpoint) return reply.code(404).send({ error: "Checkpoint not found" });
  const { rootPath } = await getProjectRoot(checkpoint.projectId);
  const result = await restoreGitCheckpoint(rootPath, {
    isRepository: Boolean(checkpoint.gitHead),
    head: checkpoint.gitHead,
    branch: checkpoint.gitBranch,
    status: checkpoint.gitStatus ?? "",
    patch: checkpoint.patch ?? "",
    files: checkpoint.filesJson ? JSON.parse(checkpoint.filesJson) : []
  });
  recordOperation(store, {
    projectId: checkpoint.projectId,
    sessionId: checkpoint.sessionId,
    kind: "checkpoint.restore",
    title: `恢复检查点 ${checkpoint.title}`,
    detail: { checkpointId: checkpoint.id }
  });
  return result;
});
app.get("/api/projects/:id/notes", { preHandler: auth }, async (req) => {
  await getProjectRoot(routeId(req));
  return store.listProjectNotes(routeId(req)).map((note) => ({
    ...note,
    enabled: Boolean(note.enabled)
  }));
});
app.post("/api/projects/:id/notes", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  await getProjectRoot(projectId);
  const body = z
    .object({
      kind: z.enum(["rule", "command", "env", "note"]).optional(),
      title: z.string().trim().min(1).max(80),
      content: z.string().trim().min(1).max(20_000),
      enabled: z.boolean().optional()
    })
    .parse(req.body);
  const note = store.upsertProjectNote({ projectId, ...body });
  return { ...note, enabled: Boolean(note.enabled) };
});
app.put("/api/notes/:id", { preHandler: auth }, async (req, reply) => {
  const existing = store.getProjectNote(routeId(req));
  if (!existing) return reply.code(404).send({ error: "Note not found" });
  const body = z
    .object({
      kind: z.enum(["rule", "command", "env", "note"]).optional(),
      title: z.string().trim().min(1).max(80),
      content: z.string().trim().min(1).max(20_000),
      enabled: z.boolean().optional()
    })
    .parse(req.body);
  const note = store.upsertProjectNote({
    id: existing.id,
    projectId: existing.projectId,
    kind: body.kind ?? existing.kind,
    title: body.title,
    content: body.content,
    enabled: body.enabled
  });
  return { ...note, enabled: Boolean(note.enabled) };
});
app.delete("/api/notes/:id", { preHandler: auth }, async (req, reply) => {
  if (!store.deleteProjectNote(routeId(req)))
    return reply.code(404).send({ error: "Note not found" });
  return { ok: true };
});
app.get("/api/sessions/:id/stars", { preHandler: auth }, async (req, reply) => {
  const session = store.getSession(routeId(req));
  if (!session) return reply.code(404).send({ error: "Session not found" });
  return { ids: store.listSessionStars(session.id) };
});
app.put("/api/messages/:id/star", { preHandler: auth }, async (req, reply) => {
  const { starred } = z.object({ starred: z.boolean() }).parse(req.body ?? {});
  const result = store.setMessageStarred(routeId(req), starred);
  if (!result) return reply.code(404).send({ error: "Message not found" });
  return result;
});
app.get("/api/projects/:id/agents-md", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  return readAgentsMarkdown(rootPath);
});
app.put("/api/projects/:id/agents-md", { preHandler: auth }, async (req) => {
  const { rootPath } = await getProjectRoot(routeId(req));
  const body = z
    .object({ content: z.string().max(200_000), revision: z.string().optional() })
    .parse(req.body);
  return writeAgentsMarkdown(rootPath, body.content, body.revision);
});
app.get("/api/projects/:id/skills", { preHandler: auth }, async (req) => {
  const { project, rootPath } = await getProjectRoot(routeId(req));
  const provider = project.providerId ? store.getProvider(project.providerId) : undefined;
  const home = provider ? await providerHome(provider) : defaultCodexHome;
  const [projectSkills, providerSkills] = await Promise.all([
    listProjectSkills(rootPath),
    listProviderSkills(home)
  ]);
  return { project: projectSkills, provider: providerSkills };
});
app.get("/api/providers/:id/mcp", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  return { servers: parseMcpServers(provider.configToml) };
});
app.post("/api/providers/:id/mcp", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  const body = z
    .object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(/^[A-Za-z0-9_-]+$/),
      enabled: z.boolean().optional(),
      command: z.string().trim().max(200).optional(),
      args: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
      url: z.string().trim().max(500).optional(),
      env: z.record(z.string(), z.string()).optional()
    })
    .parse(req.body);
  const configToml = upsertMcpServer(provider.configToml ?? "", {
    name: body.name,
    enabled: body.enabled !== false,
    command: body.command?.trim() || null,
    args: body.args ?? [],
    url: body.url?.trim() || null,
    env: body.env ?? {},
    extra: {}
  });
  persistProvider(provider, { configToml });
  return { servers: parseMcpServers(configToml) };
});
app.post("/api/providers/:id/mcp/:name/toggle", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  const name = routeParam(req, "name");
  const body = z.object({ enabled: z.boolean() }).parse(req.body);
  const configToml = setMcpServerEnabled(provider.configToml ?? "", name, body.enabled);
  persistProvider(provider, { configToml });
  return { servers: parseMcpServers(configToml) };
});
app.delete("/api/providers/:id/mcp/:name", { preHandler: auth }, async (req, reply) => {
  const provider = store.getProvider(routeId(req));
  if (!provider) return reply.code(404).send({ error: "Provider not found" });
  const name = routeParam(req, "name");
  const configToml = removeMcpServer(provider.configToml ?? "", name);
  persistProvider(provider, { configToml });
  return { servers: parseMcpServers(configToml) };
});
app.get("/api/projects/:id/operations", { preHandler: auth }, async (req) => {
  await getProjectRoot(routeId(req));
  return store.listOperationEvents(routeId(req)).map(publicOperation);
});
app.post("/api/operations/:id/undo", { preHandler: auth }, async (req, reply) => {
  const event = store.getOperationEvent(routeId(req));
  if (!event) return reply.code(404).send({ error: "Operation not found" });
  const { rootPath } = await getProjectRoot(event.projectId);
  const result = await undoOperation(store, rootPath, event.id);
  recordOperation(store, {
    projectId: event.projectId,
    sessionId: event.sessionId,
    kind: "operation.undo",
    title: `撤销：${event.title}`,
    detail: { operationId: event.id }
  });
  return result;
});
app.get("/api/projects/:id/schedules", { preHandler: auth }, async (req) => {
  await getProjectRoot(routeId(req));
  return store.listScheduledJobs(routeId(req)).map((job) => ({
    ...job,
    enabled: Boolean(job.enabled)
  }));
});
app.post("/api/projects/:id/schedules", { preHandler: auth }, async (req) => {
  const projectId = routeId(req);
  await getProjectRoot(projectId);
  const body = z
    .object({
      title: z.string().trim().min(1).max(80),
      prompt: z.string().trim().min(1).max(20_000),
      cadence: z.enum(["interval", "daily"]),
      intervalMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60)
        .optional(),
      dailyAt: z
        .string()
        .regex(/^\d{1,2}:\d{2}$/)
        .optional(),
      sessionId: z.string().min(1).optional(),
      enabled: z.boolean().optional()
    })
    .parse(req.body);
  const job = store.upsertScheduledJob({
    projectId,
    sessionId: body.sessionId ?? null,
    title: body.title,
    prompt: body.prompt,
    cadence: body.cadence,
    intervalMinutes: body.intervalMinutes ?? null,
    dailyAt: body.dailyAt ?? null,
    enabled: body.enabled,
    nextRunAt: nextRunAt({
      cadence: body.cadence,
      intervalMinutes: body.intervalMinutes,
      dailyAt: body.dailyAt
    })
  });
  return { ...job, enabled: Boolean(job.enabled) };
});
app.put("/api/schedules/:id", { preHandler: auth }, async (req, reply) => {
  const existing = store.getScheduledJob(routeId(req));
  if (!existing) return reply.code(404).send({ error: "Schedule not found" });
  const body = z
    .object({
      title: z.string().trim().min(1).max(80),
      prompt: z.string().trim().min(1).max(20_000),
      cadence: z.enum(["interval", "daily"]),
      intervalMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60)
        .optional(),
      dailyAt: z
        .string()
        .regex(/^\d{1,2}:\d{2}$/)
        .optional(),
      sessionId: z.string().min(1).nullable().optional(),
      enabled: z.boolean().optional()
    })
    .parse(req.body);
  const job = store.upsertScheduledJob({
    id: existing.id,
    projectId: existing.projectId,
    sessionId: body.sessionId === undefined ? existing.sessionId : body.sessionId,
    title: body.title,
    prompt: body.prompt,
    cadence: body.cadence,
    intervalMinutes: body.intervalMinutes ?? null,
    dailyAt: body.dailyAt ?? null,
    enabled: body.enabled,
    nextRunAt: nextRunAt({
      cadence: body.cadence,
      intervalMinutes: body.intervalMinutes,
      dailyAt: body.dailyAt
    })
  });
  return { ...job, enabled: Boolean(job.enabled) };
});
app.delete("/api/schedules/:id", { preHandler: auth }, async (req, reply) => {
  if (!store.deleteScheduledJob(routeId(req)))
    return reply.code(404).send({ error: "Schedule not found" });
  return { ok: true };
});
app.post("/api/runs/:sessionId/cancel", { preHandler: auth }, async (req, reply) => {
  const sessionId = routeParam(req, "sessionId");
  if (!store.getSession(sessionId)) return reply.code(404).send({ error: "Session not found" });
  return { ok: runs.cancel(sessionId) };
});
app.get("/api/projects/:id/terminals", { preHandler: auth }, async (req, reply) => {
  const projectId = routeId(req);
  if (!store.getProject(projectId)) return reply.code(404).send({ error: "Project not found" });
  return { host: terminalHostLabel(), items: terminals.list(projectId) };
});
app.post("/api/projects/:id/terminals", { preHandler: auth }, async (req, reply) => {
  const projectId = routeId(req);
  const { project, rootPath } = await getProjectRoot(projectId);
  const input = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      cols: z.number().int().min(20).max(400).optional(),
      rows: z.number().int().min(5).max(200).optional()
    })
    .parse(req.body ?? {});
  try {
    return terminals.create({
      projectId,
      projectName: project.name,
      cwd: rootPath,
      ...(input.name ? { name: input.name } : {}),
      ...(input.cols ? { cols: input.cols } : {}),
      ...(input.rows ? { rows: input.rows } : {})
    });
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.patch("/api/terminals/:id", { preHandler: auth }, async (req, reply) => {
  const id = routeId(req);
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const terminal = terminals.rename(id, name);
  return terminal ?? reply.code(404).send({ error: "Terminal not found" });
});
app.delete("/api/terminals/:id", { preHandler: auth }, async (req, reply) => {
  const deleted = terminals.close(routeId(req));
  if (!deleted) return reply.code(404).send({ error: "Terminal not found" });
  return { ok: true };
});
app.get("/api/ws", { websocket: true, preValidation: auth }, (socket) => {
  const sendError = (error: unknown, clientId?: string, sessionId?: string) => {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "server.error",
        ...(sessionId ? { sessionId } : {}),
        payload: {
          message: error instanceof Error ? error.message : String(error),
          ...(clientId ? { clientId } : {})
        }
      })
    );
  };
  socket.on("message", (data: unknown) => {
    try {
      const command = runCommandSchema.parse(JSON.parse(String(data)));
      void runs
        .handle(command, socket)
        .catch((error) =>
          sendError(
            error,
            command.type === "turn.enqueue" ? command.clientId : undefined,
            command.sessionId
          )
        );
    } catch (error) {
      sendError(error);
    }
  });
  socket.on("close", () => runs.unsubscribeSocket(socket));
});
const terminalCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("terminal.subscribe"),
    terminalId: z.string().min(1),
    lastSeq: z.number().int().min(0).optional()
  }),
  z.object({
    type: z.literal("terminal.input"),
    terminalId: z.string().min(1),
    data: z.string().max(256 * 1024)
  }),
  z.object({
    type: z.literal("terminal.resize"),
    terminalId: z.string().min(1),
    cols: z.number().int().min(20).max(400),
    rows: z.number().int().min(5).max(200)
  })
]);
app.get("/api/terminal/ws", { websocket: true, preValidation: auth }, (socket) => {
  const sendError = (error: unknown) => {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "terminal.error",
        payload: { message: error instanceof Error ? error.message : String(error) }
      })
    );
  };
  socket.on("message", (data: unknown) => {
    try {
      const command = terminalCommandSchema.parse(JSON.parse(String(data)));
      if (command.type === "terminal.subscribe") {
        terminals.subscribe(command.terminalId, socket, command.lastSeq);
      } else if (command.type === "terminal.input") {
        if (!terminals.input(command.terminalId, command.data))
          throw new Error("Terminal is no longer running");
      } else if (!terminals.resize(command.terminalId, command.cols, command.rows)) {
        throw new Error("Terminal is no longer running");
      }
    } catch (error) {
      sendError(error);
    }
  });
  socket.on("close", () => terminals.unsubscribeSocket(socket));
});
app.addHook("onClose", async () => {
  stopScheduledJobs();
  await updateCheck.stop();
  runs.shutdown();
  terminals.shutdown();
  store.db.close();
});
const staticDir = resolveStaticDir();
if (staticDir) {
  await app.register(fastifyStatic, {
    root: staticDir,
    index: ["index.html"],
    wildcard: false
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    reply.code(404).send({ error: "Not found" });
  });
}

const host = process.env.CODEX_OMNI_HOST ?? "0.0.0.0";
const port = Number(process.env.CODEX_OMNI_PORT ?? 8790);
await app.listen({ host, port });
updateCheck.start();
app.log.info(
  {
    url: `http://${host}:${port}`,
    dataPath,
    staticDir: staticDir || null
  },
  "codex-omni started"
);
