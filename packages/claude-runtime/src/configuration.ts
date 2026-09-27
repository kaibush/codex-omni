import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeRequest } from "@codex-omni/protocol";
import { z } from "zod";

export function parseClaudeSettings(value?: string | null): NonNullable<Options["settings"]> {
  const parsed: unknown = value?.trim() ? JSON.parse(value) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Claude settings 必须是 JSON 对象");
  return z
    .object({
      env: z.record(z.string(), z.string()).optional(),
      disabledMcpServers: z.array(z.string()).optional(),
      plansDirectory: z.string().optional()
    })
    .passthrough()
    .parse(parsed) as Exclude<NonNullable<Options["settings"]>, string>;
}

const envSchema = z.record(z.string(), z.string());
const serverSchema = z.union([
  z.object({
    type: z.literal("stdio").optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: envSchema.optional()
  }),
  z.object({
    type: z.enum(["http", "sse"]),
    url: z.url().refine((value) => /^https?:\/\//.test(value), "MCP URL 必须使用 HTTP(S)"),
    headers: envSchema.optional()
  })
]);

export function parseClaudeMcpServers(value?: string | null): Record<string, McpServerConfig> {
  const parsed = value?.trim() ? JSON.parse(value) : {};
  return z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), serverSchema).parse(parsed) as Record<
    string,
    McpServerConfig
  >;
}

const ROUTING_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"
];

function requestEnvironment(request: BridgeRequest) {
  const settings = parseClaudeSettings(request.settingsJson) as { env?: Record<string, string> };
  const env: Record<string, string> = {
    ...(request.homeMode !== "native"
      ? Object.fromEntries(ROUTING_KEYS.map((key) => [key, ""]))
      : {}),
    ...settings.env,
    ...request.messageEnvVars
  };
  delete env.HOME;
  delete env.CODEX_HOME;
  delete env.CLAUDECODE;
  if (request.apiKey) {
    env.ANTHROPIC_API_KEY = request.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = "";
    env.CLAUDE_CODE_OAUTH_TOKEN = "";
  }
  if (request.baseUrl)
    env.ANTHROPIC_BASE_URL = request.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  env.CLAUDE_CONFIG_DIR = request.runtimeHome;
  return env;
}

export function claudeEnvironment(
  request: BridgeRequest,
  inherited: NodeJS.ProcessEnv = process.env
) {
  const env: NodeJS.ProcessEnv = { ...inherited };
  for (const key of Object.keys(env)) {
    if (
      key === "CLAUDECODE" ||
      key === "CLAUDE_CODE_ENTRYPOINT" ||
      key.startsWith("CODEX_") ||
      key.startsWith("ANTHROPIC_") ||
      key.startsWith("CLAUDE_CODE_OAUTH") ||
      key.startsWith("CLAUDE_CODE_USE_") ||
      ROUTING_KEYS.includes(key)
    )
      delete env[key];
  }
  Object.assign(env, requestEnvironment(request));
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "codex-omni/0.1.0";
  return env;
}

/** The SDK accepts a settings filename. Keep credentials out of CLI argv and
 * never overwrite the shared native settings.json when selecting a provider.
 */
export function stageClaudeSettings(settings: Options["settings"]) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-omni-claude-"));
  const cleanup = () => {
    process.removeListener("exit", cleanup);
    rmSync(directory, { recursive: true, force: true });
  };
  const file = path.join(directory, "settings.json");
  try {
    writeFileSync(file, JSON.stringify(settings ?? {}), { mode: 0o600 });
  } catch (error) {
    cleanup();
    throw error;
  }
  process.once("exit", cleanup);
  return { file, cleanup };
}

export function claudeQueryOptions(request: BridgeRequest): Options {
  const claude = request.claude ?? {};
  const permissionMode = request.mode === "plan" ? "plan" : (claude.permissionMode ?? "default");
  const settings = parseClaudeSettings(request.settingsJson);
  const disabled = (settings as { disabledMcpServers?: string[] }).disabledMcpServers ?? [];
  const mcpServers = Object.fromEntries(
    Object.entries(parseClaudeMcpServers(request.mcpServersJson)).filter(
      ([name]) => !disabled.includes(name)
    )
  );
  return {
    cwd: request.cwd,
    env: claudeEnvironment(request),
    ...(request.threadId ? { resume: request.threadId } : {}),
    ...(request.model ? { model: request.model } : {}),
    permissionMode,
    ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    tools: { type: "preset", preset: "claude_code" },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      ...(claude.systemPrompt ? { append: claude.systemPrompt } : {})
    },
    settingSources: ["user", "project", "local"],
    settings: {
      ...(settings as object),
      ...(request.homeMode !== "native"
        ? {
            apiKeyHelper: "",
            model: request.model || "default"
          }
        : {}),
      env: requestEnvironment(request)
    },
    mcpServers,
    includePartialMessages: true,
    persistSession: true,
    enableFileCheckpointing: true,
    ...(claude.effort ? { effort: claude.effort } : {}),
    ...(claude.thinking ? { thinking: { type: claude.thinking } } : {}),
    ...(claude.maxTurns ? { maxTurns: claude.maxTurns } : {}),
    ...(claude.maxBudgetUsd ? { maxBudgetUsd: claude.maxBudgetUsd } : {}),
    ...(claude.allowedTools ? { allowedTools: claude.allowedTools } : {}),
    ...(claude.disallowedTools ? { disallowedTools: claude.disallowedTools } : {}),
    ...(claude.agents ? { agents: JSON.parse(JSON.stringify(claude.agents)) } : {}),
    ...(claude.agent ? { agent: claude.agent } : {})
  };
}
