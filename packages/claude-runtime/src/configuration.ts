import { mkdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeRequest } from "@codex-omni/protocol";
import { z } from "zod";

export async function resolveClaudeHome(input: {
  providersRoot: string;
  providerId: string;
  homeMode?: string | null;
  claudeHomePath?: string | null;
}) {
  if (input.homeMode === "external") {
    const selected =
      input.claudeHomePath?.trim() ||
      process.env.CLAUDE_CONFIG_DIR ||
      path.join(os.homedir(), ".claude");
    const home = await realpath(selected);
    if (!(await stat(home)).isDirectory()) throw new Error("Claude Code 配置路径必须是目录");
    return home;
  }
  const home = path.join(input.providersRoot, input.providerId, "claude");
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

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

export function claudeEnvironment(
  request: BridgeRequest,
  inherited: NodeJS.ProcessEnv = process.env
) {
  const env: NodeJS.ProcessEnv = { ...inherited };
  // Managed providers own their credentials and model mapping. Never inherit a
  // different provider's login, proxy URL, model aliases, or cloud backend.
  for (const key of Object.keys(env)) {
    if (
      key === "CLAUDECODE" ||
      key === "CLAUDE_CODE_ENTRYPOINT" ||
      key.startsWith("CODEX_") ||
      (request.homeMode !== "external" &&
        (key.startsWith("ANTHROPIC_") ||
          key.startsWith("CLAUDE_CODE_OAUTH") ||
          key.startsWith("CLAUDE_CODE_USE_")))
    ) {
      delete env[key];
    }
  }
  const settings = parseClaudeSettings(request.settingsJson) as { env?: Record<string, string> };
  Object.assign(env, settings.env ?? {}, request.messageEnvVars ?? {});
  if (request.apiKey) {
    env.ANTHROPIC_API_KEY = request.apiKey;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  if (request.baseUrl)
    env.ANTHROPIC_BASE_URL = request.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  env.CLAUDE_CONFIG_DIR = request.runtimeHome ?? request.codexHome;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "codex-omni/0.1.0";
  // This worker is an independent SDK host even when the server was started
  // from an interactive coding session.
  delete env.CLAUDECODE;
  return env;
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
      env: {
        ...(settings as { env?: Record<string, string> }).env,
        ...request.messageEnvVars,
        ...(request.apiKey
          ? {
              ANTHROPIC_API_KEY: request.apiKey,
              ANTHROPIC_AUTH_TOKEN: "",
              CLAUDE_CODE_OAUTH_TOKEN: ""
            }
          : {}),
        ...(request.baseUrl
          ? { ANTHROPIC_BASE_URL: request.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") }
          : {}),
        // CLI settings env is applied after the inherited process env. Keep
        // both layers on the native home recorded by the server.
        CLAUDE_CONFIG_DIR: request.runtimeHome ?? request.codexHome
      }
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
