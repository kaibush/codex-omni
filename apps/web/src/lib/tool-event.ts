export function formatToolValue(value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function cleanCommand(commandText: string) {
  if (!commandText) return "";
  const trimmed = commandText.trim();
  const shellMatch = trimmed.match(
    /^(?:\/\S+\/)?(?:bash|zsh|sh|fish)(?:\.exe)?\s+-(?:l?c)\s+(['"])([\s\S]+)\1$/
  );
  const inner = shellMatch?.[2] ?? trimmed;
  const cdMatch = inner.match(/^\s*cd\s+[^&;]+(?:\s*&&\s*|\s*;\s*)([\s\S]+)$/i);
  return (cdMatch?.[1] ?? inner).trim();
}

export function isCommandTool(data: unknown) {
  const record = asRecord(data);
  return record?.tool === "command" || typeof record?.command === "string";
}

export function toolCallRequest(data: unknown) {
  const record = asRecord(data);
  if (!record) return "";
  if (typeof record.command === "string" && record.command.trim())
    return cleanCommand(record.command);
  if (typeof record.query === "string" && record.query.trim()) return record.query;
  if (record.input !== undefined) return formatToolValue(record.input);
  if (record.arguments !== undefined) return formatToolValue(record.arguments);
  if (record.items !== undefined) return formatToolValue(record.items);
  return "";
}

export function toolCallOutput(data: unknown, text?: string | undefined) {
  if (text?.trim()) return text;
  const record = asRecord(data);
  if (!record) return "";
  if (typeof record.output === "string" && record.output) return record.output;
  if (record.result !== undefined) return formatToolValue(record.result);
  if (record.error !== undefined) return formatToolValue(record.error);
  if (typeof record.message === "string") return record.message;
  return "";
}

export function toolCallTitle(data: unknown) {
  const record = asRecord(data);
  const tool = typeof record?.tool === "string" ? record.tool : "";
  if (tool === "command" || typeof record?.command === "string") {
    const command = cleanCommand(typeof record?.command === "string" ? record.command : "");
    return (
      command
        .split("\n")
        .find((line) => line.trim())
        ?.trim() || "Command"
    );
  }
  if (tool === "web_search") {
    return (typeof record?.query === "string" && record.query.trim()) || "Web search";
  }
  if (tool === "update_plan") return "Update plan";
  if (tool.startsWith("mcp__")) return tool.slice(5).replaceAll("__", " / ");
  return tool || "Tool call";
}

export function toolCallStatusLabel(status?: string | undefined) {
  if (status === "in_progress") return "进行中";
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  return status ?? "";
}
