import { parse } from "smol-toml";
import type { CodexOptions } from "@openai/codex-sdk";
import type { BridgeRequest } from "@codex-omni/protocol";
import { workerEnvironment } from "./environment.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// Providers own routing and per-run options. Native storage, trust and global
// configuration keep their client-wide scope, just as in desktop ccgui.
const CHANNEL_KEYS = [
  "model",
  "model_provider",
  "model_reasoning_effort",
  "model_reasoning_summary",
  "model_verbosity",
  "model_context_window",
  "model_auto_compact_token_limit",
  "model_supports_reasoning_summaries",
  "disable_response_storage",
  "model_providers",
  "mcp_servers",
  "features",
  "agents",
  "web_search",
  "service_tier"
] as const;

export function parseCodexProviderConfig(configToml?: string, authJson?: string) {
  let config: Record<string, unknown>;
  let auth: Record<string, unknown>;
  try {
    config = configToml?.trim() ? parse(configToml) : {};
  } catch {
    // TOML diagnostics can include a line containing credentials.
    throw new Error("供应商 config.toml 格式无效");
  }
  try {
    const parsed = authJson?.trim() ? JSON.parse(authJson) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    auth = parsed;
  } catch {
    throw new Error("供应商 auth.json 必须是 JSON 对象");
  }
  const apiKey = string(auth.OPENAI_API_KEY);
  if (auth.tokens && !apiKey)
    throw new Error("原生登录请使用客户端原生配置；供应商 auth.json 仅接受 OPENAI_API_KEY");
  return { config, apiKey };
}

// Pass entire tables with -c instead of SDK dotted-key merging. This prevents
// an old native provider's headers/auth fields from leaking into a channel.
function tomlValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date))
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}=${tomlValue(entry)}`)
      .join(",")}}`;
  throw new Error("供应商配置包含不支持的 TOML 值");
}

export function codexLaunchOptions(request: BridgeRequest): CodexOptions {
  const env = workerEnvironment(request);
  if (request.homeMode === "native") return { env };
  const parsed = parseCodexProviderConfig(request.configToml, request.authJson);
  const config: Record<string, unknown> = Object.fromEntries(
    CHANNEL_KEYS.filter((key) => key in parsed.config).map((key) => [key, parsed.config[key]])
  );
  const providers = object(config.model_providers);
  const selected = string(config.model_provider) || "openai";
  const route = { ...object(providers[selected]) };
  if (request.baseUrl) route.base_url = request.baseUrl;
  route.name = string(route.name) || selected;
  route.base_url = string(route.base_url) || "https://api.openai.com/v1";
  route.wire_api = string(route.wire_api) || "responses";
  const apiKey =
    request.apiKey ||
    parsed.apiKey ||
    env[string(route.env_key)] ||
    env.OPENAI_API_KEY ||
    env.CODEX_API_KEY;
  if (apiKey) {
    env.CODEX_OMNI_PROVIDER_API_KEY = apiKey;
    route.env_key = "CODEX_OMNI_PROVIDER_API_KEY";
    route.requires_openai_auth = false;
    delete route.experimental_bearer_token;
    delete route.auth;
  } else if (route.requires_openai_auth === true) {
    throw new Error("供应商缺少 API Key；原生登录请使用客户端原生配置");
  }
  // A unique name also prevents a native config table from supplying missing
  // keys. The original provider definitions are kept for configured agents.
  const channel = `omni_${request.requestId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  providers[selected] = route;
  providers[channel] = route;
  for (const [index, definition] of Object.values(providers).entries()) {
    const provider = object(definition);
    const token = string(provider.experimental_bearer_token);
    if (token) {
      const key = `CODEX_OMNI_PROVIDER_TOKEN_${index}`;
      env[key] = token;
      provider.env_key = key;
      provider.requires_openai_auth = false;
      delete provider.experimental_bearer_token;
    }
    const headers = object(provider.http_headers);
    const envHeaders = { ...object(provider.env_http_headers) };
    for (const [headerIndex, [header, value]] of Object.entries(headers).entries()) {
      if (typeof value !== "string") throw new Error("供应商 HTTP Header 必须是字符串");
      const configuredKey = string(envHeaders[header]);
      if (configuredKey && env[configuredKey] !== undefined) continue;
      const key = `CODEX_OMNI_PROVIDER_HEADER_${index}_${headerIndex}`;
      env[key] = value;
      envHeaders[header] = key;
    }
    if (Object.keys(headers).length) {
      delete provider.http_headers;
      provider.env_http_headers = envHeaders;
    }
  }
  config.model_provider = channel;
  config.model_providers = providers;
  return {
    env,
    configOverrides: Object.entries(config).map(([key, value]) => `${key}=${tomlValue(value)}`)
  };
}
