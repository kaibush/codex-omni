import type { ProviderRow } from "@codex-omni/db";
import { parseClaudeMcpServers, parseClaudeSettings } from "@codex-omni/claude-runtime";
import type { ProviderInput } from "@codex-omni/protocol";

export async function claudeProviderFiles(input: ProviderInput, current?: ProviderRow) {
  const homeMode = input.homeMode ?? current?.homeMode ?? "api-key";
  if (homeMode === "native")
    return {
      homeMode,
      apiKey: null,
      baseUrl: null,
      model: input.model ?? current?.model ?? null,
      contextWindow: null,
      autoCompactTokenLimit: null,
      settingsJson: null,
      mcpServersJson: null,
      configToml: null,
      authJson: null
    };
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
  return {
    homeMode,
    apiKey: homeMode === "api-key" ? apiKey : null,
    baseUrl,
    model: input.model === undefined ? (current?.model ?? null) : input.model,
    contextWindow: null,
    autoCompactTokenLimit: null,
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
