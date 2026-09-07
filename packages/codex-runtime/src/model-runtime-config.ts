export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 256_000;

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

function unwrapTomlString(value: string) {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return (quoted ? quoted[2]! : trimmed).trim();
}

export function parseRootTomlValue(content: string | null | undefined, key: string) {
  if (!content?.trim()) return "";
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1] ?? "";
      continue;
    }
    if (section) continue;
    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    if (assignment[1] === key) return unwrapTomlString(assignment[2] ?? "");
  }
  return "";
}

export function upsertRootTomlAssignment(content: string, key: string, serializedValue: string) {
  const lines = content.split(/\r?\n/);
  let section = "";
  let existingIndex = -1;
  let lastRootIndex = -1;
  let firstTableIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripTomlComment(lines[index] ?? "").trim();
    if (!line) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      if (firstTableIndex < 0) firstTableIndex = index;
      section = line;
      continue;
    }
    if (section) continue;
    lastRootIndex = index;
    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (assignment?.[1] === key) existingIndex = index;
  }
  const nextLine = `${key} = ${serializedValue}`;
  if (existingIndex >= 0) {
    lines[existingIndex] = nextLine;
    return lines.join("\n");
  }
  const insertAt = firstTableIndex >= 0 ? firstTableIndex : Math.max(lastRootIndex + 1, 0);
  const prefix = lines.slice(0, insertAt);
  const suffix = lines.slice(insertAt);
  if (prefix.length && prefix[prefix.length - 1]?.trim() && firstTableIndex >= 0) prefix.push("");
  prefix.push(nextLine);
  if (suffix[0]?.trim() && firstTableIndex >= 0 && suffix[0] !== "") prefix.push("");
  return [...prefix, ...suffix].join("\n").replace(/\n{3,}/g, "\n\n");
}

export function isKnownCodexModel(model: string) {
  const id = model.trim().toLowerCase();
  if (!id) return false;
  return /^(gpt-5(\.\d+)?(-codex(-max)?)?|gpt-5-codex|gpt-5-mini|gpt-5-nano|gpt-5-pro|gpt-4o(-mini)?|o3(-mini)?|o4-mini|codex-mini(-latest)?)$/.test(
    id
  );
}

export function inferModelContextWindow(model: string | null | undefined) {
  const id = model?.trim() ?? "";
  if (!id || isKnownCodexModel(id)) return undefined;
  return DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW;
}

export type CodexModelRuntimeConfig = {
  model: string;
  contextWindow?: number;
  autoCompactTokenLimit?: number;
  serviceTier?: string;
};

function positiveInt(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

export function resolveCodexModelRuntimeConfig(input: {
  model?: string | null;
  configToml?: string | null;
}): CodexModelRuntimeConfig {
  const model = (input.model?.trim() || parseRootTomlValue(input.configToml, "model")).trim();
  const configuredWindow = positiveInt(
    parseRootTomlValue(input.configToml, "model_context_window")
  );
  const inferredWindow = inferModelContextWindow(model);
  const contextWindow = configuredWindow ?? inferredWindow;
  const configuredCompact = positiveInt(
    parseRootTomlValue(input.configToml, "model_auto_compact_token_limit")
  );
  const autoCompactTokenLimit =
    configuredCompact ?? (contextWindow ? Math.floor(contextWindow * 0.9) : undefined);
  const serviceTier = parseRootTomlValue(input.configToml, "service_tier");
  return {
    model,
    ...(contextWindow ? { contextWindow } : {}),
    ...(autoCompactTokenLimit && !isKnownCodexModel(model) ? { autoCompactTokenLimit } : {}),
    ...(serviceTier ? { serviceTier } : {})
  };
}

export function applyCustomModelRuntimeToml(
  content: string | null | undefined,
  modelOverride?: string | null
) {
  const source = content ?? "";
  const model = (modelOverride?.trim() || parseRootTomlValue(source, "model")).trim();
  if (!model || isKnownCodexModel(model)) return source;
  const runtime = resolveCodexModelRuntimeConfig({ model, configToml: source });
  let next = source;
  if (runtime.contextWindow && !parseRootTomlValue(next, "model_context_window")) {
    next = upsertRootTomlAssignment(next, "model_context_window", String(runtime.contextWindow));
  }
  if (
    runtime.autoCompactTokenLimit &&
    !parseRootTomlValue(next, "model_auto_compact_token_limit")
  ) {
    next = upsertRootTomlAssignment(
      next,
      "model_auto_compact_token_limit",
      String(runtime.autoCompactTokenLimit)
    );
  }
  if (!next) return next;
  return next.endsWith("\n") ? next : `${next}\n`;
}
