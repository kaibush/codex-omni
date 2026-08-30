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

export type PlanItemStatus = "pending" | "in_progress" | "completed";
export type PlanItem = { text: string; status: PlanItemStatus };

const COLLAB_TOOLS = new Set([
  "collab",
  "spawnagent",
  "waitagent",
  "wait",
  "sendinput",
  "closeagent",
  "resumeagent",
  "handoff"
]);

function compactToolName(tool: string) {
  const last = tool.split("__").at(-1) ?? tool;
  return last.toLowerCase().replace(/[_-]/g, "");
}

function planSource(data: unknown): unknown[] {
  const record = asRecord(data);
  const nested = asRecord(record?.input);
  const candidates = [record?.items, record?.steps, nested?.items, nested?.steps, nested?.plan];
  return candidates.find(Array.isArray) ?? [];
}

export function isPlanTool(data: unknown) {
  const record = asRecord(data);
  const tool = compactToolName(String(record?.tool ?? ""));
  return (
    tool === "updateplan" ||
    tool === "todolist" ||
    tool === "plan" ||
    tool === "proposedplan" ||
    tool === "planimplementation"
  );
}

export function parsePlanItems(data: unknown): PlanItem[] {
  return planSource(data).map((item, index) => {
    const row = asRecord(item);
    const text =
      String(row?.text ?? row?.content ?? row?.title ?? row?.step ?? "").trim() ||
      `步骤 ${index + 1}`;
    const statusRaw = String(row?.status ?? "")
      .toLowerCase()
      .replaceAll("_", "-");
    if (
      statusRaw === "completed" ||
      statusRaw === "complete" ||
      statusRaw === "done" ||
      row?.completed === true
    ) {
      return { text, status: "completed" as const };
    }
    if (
      statusRaw === "in-progress" ||
      statusRaw === "doing" ||
      statusRaw === "running" ||
      statusRaw === "inprogress"
    ) {
      return { text, status: "in_progress" as const };
    }
    return { text, status: "pending" as const };
  });
}

export function isCollabTool(data: unknown) {
  const normalized = compactToolName(String(asRecord(data)?.tool ?? ""));
  return COLLAB_TOOLS.has(normalized) || normalized.startsWith("collab");
}

export function collabToolLabel(data: unknown) {
  const tool = compactToolName(String(asRecord(data)?.tool ?? "collab"));
  if (tool === "spawnagent") return "启动子代理";
  if (tool === "waitagent" || tool === "wait") return "等待子代理";
  if (tool === "sendinput") return "向子代理发送";
  if (tool === "closeagent") return "关闭子代理";
  if (tool === "resumeagent") return "恢复子代理";
  if (tool === "handoff") return "交接子代理";
  return tool.startsWith("collab") ? "子代理协作" : `子代理 · ${tool}`;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asIdList(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function uniqueIds(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function collabCardDetails(data: unknown) {
  const record = asRecord(data) ?? {};
  const nested = asRecord(record.input) ?? {};
  const output = asText(record.output);
  const parsed = parseJsonRecord(output) ?? parseJsonRecord(record.agentStatus);
  const prompt =
    asText(record.prompt) ||
    asText(record.message) ||
    asText(nested.message) ||
    asText(nested.prompt);
  const nickname = asText(record.nickname) || asText(parsed?.nickname);
  const receivers = uniqueIds([
    ...asIdList(record.receiverThreadIds),
    ...asIdList(record.receiver_thread_ids),
    ...asIdList(nested.targets),
    ...asIdList(nested.target),
    ...asIdList(parsed?.agent_id)
  ]);
  let result = output;
  const status = asRecord(parsed?.status);
  if (status) {
    const parts = Object.values(status)
      .map((value) => {
        const row = asRecord(value);
        return asText(row?.completed) || asText(value);
      })
      .filter(Boolean);
    if (parts.length) result = parts.join("\n");
  } else if (nickname && asText(parsed?.agent_id)) {
    result = `已启动 ${nickname}`;
  }
  return { prompt, nickname, receivers, result };
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
  if (tool === "update_plan") return "计划";
  if (isCollabTool(record)) return collabToolLabel(record);
  if (tool.startsWith("mcp__")) return tool.slice(5).replaceAll("__", " / ");
  return tool || "Tool call";
}

export function toolCallStatusLabel(status?: string | undefined) {
  if (status === "in_progress") return "进行中";
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  return status ?? "";
}
