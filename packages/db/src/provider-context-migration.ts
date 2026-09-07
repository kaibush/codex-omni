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
