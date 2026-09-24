import {
  DEFAULT_PROVIDER_AUTH_TEMPLATE,
  DEFAULT_PROVIDER_CONFIG_TEMPLATE
} from "@codex-omni/protocol";

export type ProviderTemplates = { configToml: string; authJson: string };

export const defaultProviderTemplates: ProviderTemplates = {
  configToml: DEFAULT_PROVIDER_CONFIG_TEMPLATE,
  authJson: DEFAULT_PROVIDER_AUTH_TEMPLATE
};

const escapeString = (value: string) => JSON.stringify(value).slice(1, -1);

export function renderProviderTemplates(
  templates: ProviderTemplates,
  values: { name: string; model: string; baseUrl: string; apiKey: string }
): ProviderTemplates {
  const render = (template: string) =>
    template.replace(/{{(name|model|baseUrl|apiKey)}}/g, (_match, key: keyof typeof values) =>
      escapeString(values[key])
    );
  return { configToml: render(templates.configToml), authJson: render(templates.authJson) };
}

export function providerConfigValue(config: string | null | undefined, key: "model" | "base_url") {
  if (!config) return "";
  const match = config.match(new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*')`, "m"));
  if (!match) return "";
  const quoted = match[1]!;
  if (quoted.startsWith("'")) return quoted.slice(1, -1);
  try { return JSON.parse(quoted) as string; } catch { return quoted.slice(1, -1); }
}

export function setProviderConfigValue(config: string, key: "model" | "base_url", value: string) {
  const assignment = `${key} = ${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m");
  if (pattern.test(config)) return config.replace(pattern, assignment);
  if (key === "model") return `${assignment}\n${config}`;
  const lines = config.split(/\r?\n/);
  const section = lines.findIndex((line) => /^\s*\[model_providers\.custom\]\s*$/.test(line));
  if (section >= 0) {
    let end = section + 1;
    while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end]!)) end += 1;
    lines.splice(end, 0, assignment);
    return lines.join("\n");
  }
  return `${config.trimEnd()}\n${assignment}\n`;
}

export function providerAuthKey(authJson: string | null | undefined) {
  if (!authJson || authJson === "configured") return "";
  try {
    const value = (JSON.parse(authJson) as Record<string, unknown>).OPENAI_API_KEY;
    return typeof value === "string" ? value : "";
  } catch { return ""; }
}

export function setProviderAuthKey(authJson: string, apiKey: string) {
  try {
    const parsed = JSON.parse(authJson) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, OPENAI_API_KEY: apiKey }, null, 2);
  } catch {
    return JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2);
  }
}
