function stripTomlComment(line: string) {
  let inString = false;
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (char === quote && line[index - 1] !== "\\") inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "#") return line.slice(0, index);
  }
  return line;
}

function unwrapTomlKey(key: string) {
  const trimmed = key.trim();
  const quoted = trimmed.match(/^"(.*)"$/);
  return quoted ? quoted[1]! : trimmed;
}

function unwrapTomlString(value: string) {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return (quoted ? quoted[2]! : trimmed).trim();
}

export function parseModelsFromConfigToml(content?: string | null) {
  if (!content?.trim()) return [];
  const models: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const model = value.trim();
    if (!model || seen.has(model)) return;
    seen.add(model);
    models.push(model);
  };

  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = unwrapTomlKey(sectionMatch[1] ?? "");
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_.-]+|"(?:\\.|[^"\\])*")\s*=\s*(.+)$/);
    if (!assignment) continue;
    const key = unwrapTomlKey(assignment[1] ?? "");
    const value = unwrapTomlString(assignment[2] ?? "");
    if (!value) continue;
    if (key === "model") add(value);
    if (section === "model_aliases") {
      add(key);
      add(value);
    }
  }
  return models;
}

export function parseTomlStringValue(content: string | null | undefined, keys: string[]) {
  if (!content?.trim()) return "";
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = unwrapTomlKey(sectionMatch[1] ?? "");
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_.-]+|"(?:\\.|[^"\\])*")\s*=\s*(.+)$/);
    if (!assignment) continue;
    const key = unwrapTomlKey(assignment[1] ?? "");
    const value = unwrapTomlString(assignment[2] ?? "");
    if (!value) continue;
    if (keys.includes(key) || keys.includes(`${section}.${key}`)) return value;
  }
  return "";
}

export function parseProviderConnection(input: {
  baseUrl?: string | null;
  apiKey?: string | null;
  configToml?: string | null;
  authJson?: string | null;
}) {
  let baseUrl = input.baseUrl?.trim() || parseTomlStringValue(input.configToml, ["base_url"]);
  let apiKey = input.apiKey?.trim() || "";
  if (!apiKey && input.authJson) {
    try {
      const auth = JSON.parse(input.authJson) as Record<string, unknown>;
      for (const key of ["OPENAI_API_KEY", "api_key", "apiKey", "token"]) {
        const value = auth[key];
        if (typeof value === "string" && value.trim()) {
          apiKey = value.trim();
          break;
        }
      }
    } catch {
      // Invalid auth.json is reported by the caller.
    }
  }
  if (baseUrl) baseUrl = baseUrl.replace(/\/+$/, "");
  return { baseUrl, apiKey };
}

export type McpServerConfig = {
  name: string;
  enabled: boolean;
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
  extra: Record<string, string>;
};

type TomlSection = { header: string | null; lines: string[] };

function splitTomlSections(content: string): TomlSection[] {
  const sections: TomlSection[] = [{ header: null, lines: [] }];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = stripTomlComment(line).trim();
    const match = trimmed.match(/^\[([^\]]+)\]$/);
    if (match) {
      sections.push({ header: unwrapTomlKey(match[1] ?? ""), lines: [line] });
    } else {
      sections[sections.length - 1]!.lines.push(line);
    }
  }
  return sections;
}

function joinTomlSections(sections: TomlSection[]) {
  return sections
    .map((section) => section.lines.join("\n"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

function parseTomlArray(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const items: string[] = [];
  let current = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]!;
    if (inString) {
      current += char;
      if (char === quote && inner[index - 1] !== "\\") inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      const item = unwrapTomlString(current);
      if (item) items.push(item);
      current = "";
      continue;
    }
    current += char;
  }
  const last = unwrapTomlString(current);
  if (last) items.push(last);
  return items;
}

function mcpNameFromHeader(header: string) {
  const match = header.match(/^(mcp_servers(?:_disabled)?)\.(.+)$/);
  if (!match) return null;
  const rest = match[2]!;
  const env = rest.endsWith(".env");
  const name = env ? rest.slice(0, -4) : rest;
  return {
    enabled: match[1] === "mcp_servers",
    name,
    env
  };
}

function quoteToml(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function parseMcpServers(content?: string | null): McpServerConfig[] {
  if (!content?.trim()) return [];
  const servers = new Map<string, McpServerConfig>();
  const ensure = (name: string, enabled: boolean) => {
    const current = servers.get(name) ?? {
      name,
      enabled,
      command: null,
      args: [],
      url: null,
      env: {},
      extra: {}
    };
    current.enabled = enabled;
    servers.set(name, current);
    return current;
  };
  for (const section of splitTomlSections(content)) {
    if (!section.header) continue;
    const parsed = mcpNameFromHeader(section.header);
    if (!parsed) continue;
    const server = ensure(parsed.name, parsed.enabled);
    for (const rawLine of section.lines.slice(1)) {
      const line = stripTomlComment(rawLine).trim();
      if (!line) continue;
      const assignment = line.match(/^([A-Za-z0-9_.-]+|"(?:\\.|[^"\\])*")\s*=\s*(.+)$/);
      if (!assignment) continue;
      const key = unwrapTomlKey(assignment[1] ?? "");
      const rawValue = assignment[2] ?? "";
      if (parsed.env) {
        const value = unwrapTomlString(rawValue);
        if (value) server.env[key] = value;
        continue;
      }
      if (key === "command") server.command = unwrapTomlString(rawValue);
      else if (key === "url") server.url = unwrapTomlString(rawValue);
      else if (key === "args") server.args = parseTomlArray(rawValue);
      else server.extra[key] = unwrapTomlString(rawValue);
    }
  }
  return [...servers.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function serializeMcpServer(server: McpServerConfig) {
  const root = server.enabled ? "mcp_servers" : "mcp_servers_disabled";
  const lines = [`[${root}.${server.name}]`];
  if (server.command) lines.push(`command = ${quoteToml(server.command)}`);
  if (server.args.length) {
    lines.push(`args = [${server.args.map((item) => quoteToml(item)).join(", ")}]`);
  }
  if (server.url) lines.push(`url = ${quoteToml(server.url)}`);
  for (const [key, value] of Object.entries(server.extra)) {
    if (!value) continue;
    lines.push(`${key} = ${quoteToml(value)}`);
  }
  const envEntries = Object.entries(server.env).filter(([, value]) => value);
  if (envEntries.length) {
    lines.push("", `[${root}.${server.name}.env]`);
    for (const [key, value] of envEntries) lines.push(`${key} = ${quoteToml(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function upsertMcpServer(content: string, server: McpServerConfig) {
  const sections = splitTomlSections(content).filter((section) => {
    if (!section.header) return true;
    const parsed = mcpNameFromHeader(section.header);
    return !parsed || parsed.name !== server.name;
  });
  const serialized = serializeMcpServer(server).trimEnd();
  const body = joinTomlSections(sections).trimEnd();
  return `${body}${body ? "\n\n" : ""}${serialized}\n`;
}

export function removeMcpServer(content: string, name: string) {
  const sections = splitTomlSections(content).filter((section) => {
    if (!section.header) return true;
    const parsed = mcpNameFromHeader(section.header);
    return !parsed || parsed.name !== name;
  });
  return joinTomlSections(sections);
}

export function setMcpServerEnabled(content: string, name: string, enabled: boolean) {
  const servers = parseMcpServers(content);
  const current = servers.find((item) => item.name === name);
  if (!current) throw Object.assign(new Error("MCP 服务器不存在"), { statusCode: 404 });
  return upsertMcpServer(content, { ...current, enabled });
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

export function buildApiKeyProviderFiles(input: {
  name: string;
  model?: string | null;
  baseUrl?: string | null;
  apiKey: string;
}) {
  const model = input.model?.trim() || "";
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "") || "";
  const lines = [
    ...(model ? [`model = ${tomlString(model)}`] : []),
    `model_provider = ${tomlString(baseUrl ? "custom" : "openai")}`
  ];
  if (baseUrl) {
    lines.push(
      "",
      "[model_providers.custom]",
      `name = ${tomlString(input.name.trim() || "custom")}`,
      `base_url = ${tomlString(baseUrl)}`,
      `wire_api = "chat"`
    );
  }
  return {
    configToml: `${lines.join("\n")}\n`,
    authJson: JSON.stringify({ OPENAI_API_KEY: input.apiKey }, null, 2)
  };
}
