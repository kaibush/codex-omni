import {
  clientTypeSchema,
  modelRuntimeSettingsSchema,
  type ClientType,
  normalizeProviderHomeMode,
  type ProviderHomeMode
} from "@codex-omni/protocol";
import { parseModelsFromConfigToml, parseProviderConnection } from "./config-toml.js";

export function parseProviderRuntimeSettings(value: unknown) {
  const parsed = modelRuntimeSettingsSchema.safeParse(value);
  if (!parsed.success)
    throw Object.assign(new Error(parsed.error.issues[0]?.message ?? "模型运行参数无效"), {
      statusCode: 400
    });
  return parsed.data;
}

export type ProviderExport = {
  name: string;
  kind: ClientType;
  model: string | null;
  contextWindow: number | null;
  autoCompactTokenLimit: number | null;
  models: string[];
  baseUrl: string | null;
  apiKey: string | null;
  configToml: string | null;
  authJson: string | null;
  messageEnvVars: Record<string, string>;
  homeMode: ProviderHomeMode;
  codexHomePath: string | null;
  claudeHomePath?: string | null;
  settingsJson?: string | null;
  mcpServersJson?: string | null;
};

export function serializeProviderExport(input: {
  name: string;
  kind?: string | null;
  model?: string | null;
  contextWindow?: number | null;
  autoCompactTokenLimit?: number | null;
  models?: string[];
  baseUrl?: string | null;
  apiKey?: string | null;
  configToml?: string | null;
  authJson?: string | null;
  messageEnvVars?: Record<string, string>;
  homeMode?: string | null;
  codexHomePath?: string | null;
  claudeHomePath?: string | null;
  settingsJson?: string | null;
  mcpServersJson?: string | null;
}): ProviderExport {
  const homeMode = normalizeProviderHomeMode(input.homeMode);
  return {
    name: input.name,
    kind: clientTypeSchema.parse(input.kind || "codex"),
    ...(input.kind === "claude-code"
      ? {
          claudeHomePath: input.claudeHomePath ?? null,
          settingsJson: input.settingsJson ?? null,
          mcpServersJson: input.mcpServersJson ?? null
        }
      : {}),
    model: input.model ?? null,
    contextWindow: input.contextWindow ?? null,
    autoCompactTokenLimit: input.autoCompactTokenLimit ?? null,
    models: input.models ?? [],
    baseUrl: input.baseUrl ?? null,
    apiKey: input.apiKey ?? null,
    configToml: input.configToml ?? null,
    authJson: input.authJson ?? null,
    messageEnvVars: input.messageEnvVars ?? {},
    homeMode,
    codexHomePath: homeMode === "external" ? (input.codexHomePath ?? null) : null
  };
}

export function parseProviderImport(value: unknown): ProviderExport {
  if (typeof value !== "object" || !value)
    throw Object.assign(new Error("导入内容必须是 JSON 对象"), { statusCode: 400 });
  const record = value as Record<string, unknown>;
  const kind = clientTypeSchema.parse(record.kind || "codex");
  const runtimeSettings = parseProviderRuntimeSettings(record);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) throw Object.assign(new Error("导入配置缺少供应商名称"), { statusCode: 400 });
  const homeMode = normalizeProviderHomeMode(
    typeof record.homeMode === "string" ? record.homeMode : undefined
  );
  const configToml = typeof record.configToml === "string" ? record.configToml : "";
  const authJson = typeof record.authJson === "string" ? record.authJson : "";
  const apiKey = typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey : null;
  const codexHomePath =
    typeof record.codexHomePath === "string" && record.codexHomePath.trim()
      ? record.codexHomePath.trim()
      : null;
  if (kind === "claude-code") {
    // Claude native settings and external login are validated by its adapter.
  } else if (homeMode === "api-key") {
    if (!apiKey && !authJson.trim())
      throw Object.assign(new Error("导入配置缺少 API Key"), { statusCode: 400 });
  } else if (homeMode === "external") {
    if (!codexHomePath)
      throw Object.assign(new Error("导入配置缺少 CODEX_HOME 路径"), { statusCode: 400 });
  } else {
    if (!configToml.trim())
      throw Object.assign(new Error("导入配置缺少 config.toml"), { statusCode: 400 });
    if (!authJson.trim())
      throw Object.assign(new Error("导入配置缺少 auth.json"), { statusCode: 400 });
  }
  if (authJson.trim()) JSON.parse(authJson);
  const models = Array.isArray(record.models)
    ? record.models.map((item) => String(item).trim()).filter(Boolean)
    : parseModelsFromConfigToml(configToml);
  const messageEnvVars =
    record.messageEnvVars && typeof record.messageEnvVars === "object"
      ? Object.fromEntries(
          Object.entries(record.messageEnvVars as Record<string, unknown>).flatMap(([key, item]) =>
            typeof item === "string" ? [[key, item]] : []
          )
        )
      : {};
  return {
    name,
    kind,
    ...(kind === "claude-code"
      ? {
          claudeHomePath: typeof record.claudeHomePath === "string" ? record.claudeHomePath : null,
          settingsJson: typeof record.settingsJson === "string" ? record.settingsJson : null,
          mcpServersJson: typeof record.mcpServersJson === "string" ? record.mcpServersJson : null
        }
      : {}),
    model: typeof record.model === "string" && record.model.trim() ? record.model : null,
    contextWindow: runtimeSettings.contextWindow ?? null,
    autoCompactTokenLimit: runtimeSettings.autoCompactTokenLimit ?? null,
    models,
    baseUrl: typeof record.baseUrl === "string" && record.baseUrl.trim() ? record.baseUrl : null,
    apiKey,
    configToml,
    authJson,
    messageEnvVars,
    homeMode,
    codexHomePath: homeMode === "external" ? codexHomePath : null
  };
}

export function cloneProviderName(name: string) {
  return name.endsWith(" 副本") ? `${name} 2` : `${name} 副本`;
}

export function providerHttpConnection(input: {
  kind?: string;
  settingsJson?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  configToml?: string | null;
  authJson?: string | null;
  messageEnvVars?: Record<string, string>;
}) {
  if (input.kind !== "claude-code") {
    const connection = parseProviderConnection(input);
    return {
      ...connection,
      headers: {
        accept: "application/json",
        ...(connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {})
      } as Record<string, string>
    };
  }
  const settings = input.settingsJson
    ? (JSON.parse(input.settingsJson) as { env?: Record<string, string> })
    : {};
  const env = { ...settings.env, ...input.messageEnvVars };
  const raw = (input.baseUrl || env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(
    /\/+$/,
    ""
  );
  const baseUrl = /\/v1(?:\/|$)/.test(raw) ? raw : `${raw}/v1`;
  const apiKey = input.apiKey || env.ANTHROPIC_API_KEY || null;
  return {
    baseUrl,
    apiKey,
    headers: {
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey
        ? { "x-api-key": apiKey }
        : env.ANTHROPIC_AUTH_TOKEN
          ? { authorization: `Bearer ${env.ANTHROPIC_AUTH_TOKEN}` }
          : {})
    } as Record<string, string>
  };
}

export async function testProviderConnection(input: {
  kind?: string;
  settingsJson?: string | null;
  messageEnvVars?: Record<string, string>;
  homeMode?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  configToml?: string | null;
  authJson?: string | null;
}) {
  const started = Date.now();
  const models = parseModelsFromConfigToml(input.configToml);
  try {
    if (input.authJson) JSON.parse(input.authJson);
  } catch {
    return {
      ok: false,
      durationMs: Date.now() - started,
      models,
      error: "auth.json 不是有效 JSON"
    };
  }
  const { baseUrl, apiKey, headers } = providerHttpConnection(input);
  if (!baseUrl) {
    return {
      ok: models.length > 0,
      durationMs: Date.now() - started,
      models,
      reachable: false,
      error: models.length
        ? "未配置 Base URL，已从 config.toml 读取模型"
        : "未配置 Base URL，无法探测接口"
    };
  }
  try {
    if (input.kind === "claude-code" && !apiKey && !headers.authorization)
      return {
        ok: false,
        durationMs: Date.now() - started,
        models,
        reachable: false,
        error:
          "此供应商使用本地 Claude 登录；可直接发起 SDK 对话。HTTP 模型探测需要 API Key 或 Auth Token。"
      };
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });
    const durationMs = Date.now() - started;
    if (!response.ok) {
      return {
        ok: false,
        durationMs,
        models,
        reachable: true,
        status: response.status,
        error: `模型接口返回 HTTP ${response.status}`
      };
    }
    const payload = (await response.json().catch(() => null)) as
      { data?: Array<{ id?: string }> } | string[] | null;
    const remote = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data.map((item) => String(item.id ?? "")).filter(Boolean)
        : [];
    const merged = [...new Set([...models, ...remote])];
    return {
      ok: true,
      durationMs,
      models: merged,
      reachable: true,
      fetched: remote.length
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      models,
      reachable: false,
      error: error instanceof Error ? error.message : "连接失败"
    };
  }
}

export function filterModels(models: string[], query = "") {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter((item) => item.toLowerCase().includes(needle));
}

export const PROMPT_ENHANCE_INSTRUCTION = `You are a prompt editor for a coding agent.
Rewrite the user's request so it is clearer, more specific, and easier to execute.
Keep the original language. Preserve @file mentions, slash commands, paths, and fenced code exactly.
Do not answer the request. Return only the rewritten prompt, with no preamble or quotes.
Do not invent requirements the user did not imply.`;

export const PROMPT_ENHANCE_TIMEOUT_MS = 60_000;

function completionText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    output_text?: unknown;
  };
  const choice = record.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? record.output_text;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item)
          return String((item as { text?: unknown }).text ?? "");
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

export async function enhancePrompt(input: {
  kind?: string;
  settingsJson?: string | null;
  models?: string[];
  messageEnvVars?: Record<string, string>;
  homeMode?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  configToml?: string | null;
  authJson?: string | null;
  model?: string | null;
  text: string;
}) {
  const text = input.text.trim();
  if (!text) throw Object.assign(new Error("请先输入要强化的提示词"), { statusCode: 400 });
  const { baseUrl, headers } = providerHttpConnection(input);
  if (!baseUrl)
    throw Object.assign(new Error("当前供应商未配置 Base URL，无法强化提示词"), {
      statusCode: 400
    });
  let model =
    input.model?.trim() ||
    parseModelsFromConfigToml(input.configToml)[0] ||
    (input.kind === "claude-code" ? "sonnet" : "gpt-4o-mini");
  if (input.kind === "claude-code" && ["sonnet", "opus", "haiku"].includes(model)) {
    const settings = input.settingsJson
      ? (JSON.parse(input.settingsJson) as { env?: Record<string, string> })
      : {};
    const env = { ...settings.env, ...input.messageEnvVars };
    const mapped = env[`ANTHROPIC_DEFAULT_${model.toUpperCase()}_MODEL`];
    const family = new RegExp(`^claude-${model}-`, "i");
    const catalog = input.models?.some((id) => family.test(id))
      ? input.models
      : (await testProviderConnection(input)).models;
    model = mapped || catalog.find((id) => family.test(id)) || model;
  }
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/${input.kind === "claude-code" ? "messages" : "chat/completions"}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...headers
        },
        body: JSON.stringify(
          input.kind === "claude-code"
            ? {
                model,
                max_tokens: 4096,
                system: PROMPT_ENHANCE_INSTRUCTION,
                messages: [{ role: "user", content: text }]
              }
            : {
                model,
                temperature: 0.2,
                messages: [
                  { role: "system", content: PROMPT_ENHANCE_INSTRUCTION },
                  { role: "user", content: text }
                ]
              }
        ),
        signal: AbortSignal.timeout(PROMPT_ENHANCE_TIMEOUT_MS)
      }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw Object.assign(
        new Error("强化接口响应超时（60 秒），请检查供应商地址、模型或上游负载"),
        {
          statusCode: 504
        }
      );
    }
    throw error;
  }
  const durationMs = Date.now() - started;
  if (!response.ok) {
    throw Object.assign(new Error(`强化接口返回 HTTP ${response.status}`), { statusCode: 502 });
  }
  const payload = (await response.json().catch(() => null)) as {
    content?: Array<{ type?: string; text?: string }>;
  } | null;
  const enhanced =
    input.kind === "claude-code"
      ? Array.isArray(payload?.content)
        ? payload.content
            .filter((block: { type?: string }) => block.type === "text")
            .map((block: { text?: string }) => block.text ?? "")
            .join("\n")
            .trim()
        : ""
      : completionText(payload);
  if (!enhanced) throw Object.assign(new Error("强化结果为空"), { statusCode: 502 });
  return { text: enhanced, model, durationMs };
}
