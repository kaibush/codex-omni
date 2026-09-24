// The old API-key template inserted this exact pair for every unknown model.
// Only remove that generated root shape; hand-written/extended roots and other
// values are deliberately left alone. The caller restricts this to API-key homes.
export function removeLegacyGeneratedContextDefaults(content: string) {
  const lines = content.split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = firstTable < 0 ? lines.length : firstTable;
  const assignments = new Map<string, { value: string; line: number }>();
  for (let index = 0; index < rootEnd; index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    const match = line.match(
      /^(model|model_provider|model_context_window|model_auto_compact_token_limit)\s*=\s*(.+)$/
    );
    if (!match || assignments.has(match[1]!)) return content;
    assignments.set(match[1]!, { value: match[2]!, line: index });
  }
  const window = assignments.get("model_context_window");
  const compact = assignments.get("model_auto_compact_token_limit");
  if (assignments.size !== 4 || window?.value !== "256000" || compact?.value !== "230400")
    return content;
  return lines.filter((_, index) => index !== window.line && index !== compact.line).join("\n");
}

export function migrateLegacyGeneratedProviderConfig(content: string) {
  let customProvider = false;
  return removeLegacyGeneratedContextDefaults(content)
    .split("\n")
    .map((line) => {
      if (/^\s*\[/.test(line)) customProvider = /^\s*\[model_providers\.custom\]\s*$/.test(line);
      // SDK 0.153 no longer accepts the old API-key template's Chat wire mode.
      if (customProvider && /^\s*wire_api\s*=\s*"chat"\s*$/.test(line)) {
        return line.replace('"chat"', '"responses"');
      }
      return line;
    })
    .join("\n");
}

export const PROVIDER_STREAM_IDLE_TIMEOUT_MS = 600_000;

// Codex reads this setting from a named provider table, not from the root config.
export function setProviderStreamIdleTimeout(content: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const isProviderTable = (line: string) => {
    const match = line.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/);
    return Boolean(
      match &&
        /^model_providers\.(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\])*"|'[^']+')$/.test(
          match[1]!.trim()
        )
    );
  };
  const isTable = (line: string) => /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line);
  let providerStart = -1;
  let settingFound = false;
  let changed = false;
  const finishProvider = (end: number) => {
    if (providerStart < 0 || settingFound) return end;
    lines.splice(providerStart + 1, 0, `stream_idle_timeout_ms = ${PROVIDER_STREAM_IDLE_TIMEOUT_MS}`);
    changed = true;
    return end + 1;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isTable(line)) {
      index = finishProvider(index);
      providerStart = isProviderTable(line) ? index : -1;
      settingFound = false;
      continue;
    }
    if (providerStart < 0 || !/^\s*stream_idle_timeout_ms\s*=/.test(line)) continue;
    settingFound = true;
    const next = `stream_idle_timeout_ms = ${PROVIDER_STREAM_IDLE_TIMEOUT_MS}`;
    if (line !== next) {
      lines[index] = next;
      changed = true;
    }
  }
  finishProvider(lines.length);
  return changed ? lines.join(newline) : content;
}
