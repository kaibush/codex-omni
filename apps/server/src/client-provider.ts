import type { ProviderRow } from "@codex-omni/db";
import path from "node:path";
import os from "node:os";
import { resolveProviderHome } from "@codex-omni/codex-runtime";
import {
  parseClaudeMcpServers,
  parseClaudeSettings,
  resolveClaudeHome
} from "@codex-omni/claude-runtime";
import type { ProviderInput } from "@codex-omni/protocol";

// Resolve existing native state without rewriting the provider's configuration.
export function providerRuntimeHome(provider: ProviderRow, providersRoot: string) {
  if (provider.homeMode === "external") {
    const home =
      provider.kind === "claude-code"
        ? provider.claudeHomePath ||
          process.env.CLAUDE_CONFIG_DIR ||
          path.join(os.homedir(), ".claude")
        : provider.codexHomePath;
    if (!home) throw new Error("无法定位供应商的原生会话目录");
    return path.resolve(home);
  }
  return provider.kind === "claude-code"
    ? path.resolve(providersRoot, provider.id, "claude")
    : path.resolve(providersRoot, provider.id);
}

export function resolveClientHome(provider: ProviderRow, providersRoot: string) {
  return provider.kind === "claude-code"
    ? resolveClaudeHome({
        providersRoot,
        providerId: provider.id,
        homeMode: provider.homeMode,
        claudeHomePath: provider.claudeHomePath ?? null
      })
    : resolveProviderHome({
        providersRoot,
        providerId: provider.id,
        homeMode: provider.homeMode,
        codexHomePath: provider.codexHomePath,
        configToml: provider.configToml,
        authJson: provider.authJson
      });
}

export async function claudeProviderFiles(input: ProviderInput, current?: ProviderRow) {
  const homeMode = input.homeMode ?? current?.homeMode ?? "api-key";
  const apiKey =
    input.apiKey === "••••••••" || input.apiKey === undefined
      ? (current?.apiKey ?? null)
      : input.apiKey?.trim() || null;
  const settingsJson =
    input.settingsJson === undefined ? (current?.settingsJson ?? null) : input.settingsJson;
  const mcpServersJson =
    input.mcpServersJson === undefined ? (current?.mcpServersJson ?? null) : input.mcpServersJson;
  const settings = parseClaudeSettings(settingsJson) as { env?: Record<string, string> };
  parseClaudeMcpServers(mcpServersJson);
  const env = {
    ...settings.env,
    ...(input.messageEnvVars ?? JSON.parse(current?.envJson ?? "{}"))
  };
  if (homeMode === "api-key" && !apiKey && !env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY)
    throw new Error("请填写 Claude API Key 或 ANTHROPIC_AUTH_TOKEN");
  const baseUrl =
    input.baseUrl === undefined ? (current?.baseUrl ?? null) : input.baseUrl?.trim() || null;
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) throw new Error("Base URL 必须是 HTTP(S) 地址");
  const claudeHomePath =
    homeMode === "external"
      ? await resolveClaudeHome({
          providersRoot: "",
          providerId: "",
          homeMode,
          claudeHomePath: input.claudeHomePath ?? current?.claudeHomePath ?? null
        })
      : null;
  return {
    homeMode: homeMode as "managed" | "api-key" | "external",
    apiKey: homeMode === "api-key" ? apiKey : null,
    baseUrl,
    model: input.model === undefined ? (current?.model ?? null) : input.model,
    contextWindow: null,
    autoCompactTokenLimit: null,
    codexHomePath: null,
    claudeHomePath,
    settingsJson,
    mcpServersJson,
    configToml: null,
    authJson: null
  };
}

export function claudeMcpList(provider: ProviderRow) {
  const servers = parseClaudeMcpServers(provider.mcpServersJson);
  const settings = parseClaudeSettings(provider.settingsJson) as { disabledMcpServers?: string[] };
  return Object.entries(servers).map(([name, server]) => ({
    name,
    enabled: !settings.disabledMcpServers?.includes(name),
    command: "command" in server ? server.command : null,
    args: "args" in server ? (server.args ?? []) : [],
    url: "url" in server ? server.url : null,
    env: "env" in server ? (server.env ?? {}) : {},
    type: server.type ?? "stdio"
  }));
}

export function updateClaudeMcp(
  provider: ProviderRow,
  name: string,
  input: {
    command?: string | null | undefined;
    args?: string[] | undefined;
    url?: string | null | undefined;
    env?: Record<string, string> | undefined;
    enabled?: boolean | undefined;
  } | null
) {
  const servers = parseClaudeMcpServers(provider.mcpServersJson);
  const settings = parseClaudeSettings(provider.settingsJson) as { disabledMcpServers?: string[] };
  if (input === null) delete servers[name];
  else if (input.url || input.command)
    servers[name] = input.url
      ? { type: "http", url: input.url }
      : { command: input.command!, args: input.args ?? [], env: input.env ?? {} };
  else if (!servers[name])
    throw Object.assign(new Error("请填写命令或 MCP URL"), { statusCode: 400 });
  const disabled = new Set(settings.disabledMcpServers ?? []);
  if (input?.enabled === false) disabled.add(name);
  else disabled.delete(name);
  return {
    mcpServersJson: JSON.stringify(parseClaudeMcpServers(JSON.stringify(servers))),
    settingsJson: JSON.stringify({ ...settings, disabledMcpServers: [...disabled] })
  };
}
