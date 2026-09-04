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

export function planItemSignature(data: unknown) {
  return parsePlanItems(data)
    .map((item) => item.text)
    .join("\n");
}

export function planItemProgress(data: unknown) {
  return parsePlanItems(data).reduce((sum, item) => {
    if (item.status === "completed") return sum + 2;
    if (item.status === "in_progress") return sum + 1;
    return sum;
  }, 0);
}

export function existingPlanTimelineId(
  items: Array<{ id: string; kind: string; data?: unknown }>,
  requestId: string,
  data: unknown
) {
  const plans = items.filter((item) => item.kind === "tool" && isPlanTool(item.data));
  if (!plans.length) return undefined;
  const prefix = `tool-${requestId}-`;
  const sameRequest = plans.find((item) => item.id.startsWith(prefix));
  if (sameRequest) return sameRequest.id;
  const signature = planItemSignature(data);
  if (!signature) return undefined;
  return plans.find((item) => planItemSignature(item.data) === signature)?.id;
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
  if (COLLAB_TOOLS.has(normalized) || normalized.startsWith("collab")) return true;
  return normalized === "wait" && hasCollabWaitTargets(data);
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

function hasCollabWaitTargets(data: unknown) {
  const record = asRecord(data);
  if (!record) return false;
  const nested = parseJsonRecord(record.input);
  for (const source of [record, nested]) {
    if (!source) continue;
    const ids = uniqueIds([
      ...asIdList(source.targets),
      ...asIdList(source.target),
      ...asIdList(source.receiverThreadIds),
      ...asIdList(source.receiver_thread_ids),
      ...asIdList(source.receiverThreadId),
      ...asIdList(source.receiver_thread_id),
      ...asIdList(source.agent_id),
      ...asIdList(source.agentId),
      ...asIdList(source.agent_ids),
      ...asIdList(source.agentIds)
    ]);
    if (ids.length) return true;
  }
  return false;
}

function statusTexts(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return [];
  const completed = asText(record.completed);
  if (completed) return [completed];
  const parts: string[] = [];
  for (const entry of Object.values(record)) {
    const nested = asRecord(entry);
    const text = nested ? asText(nested.completed) : "";
    if (text) parts.push(text);
  }
  return parts;
}

export function collabCardDetails(data: unknown) {
  const record = asRecord(data) ?? {};
  const nested = asRecord(record.input) ?? parseJsonRecord(record.input) ?? {};
  const output = asText(record.output);
  const parsed =
    parseJsonRecord(output) ?? asRecord(record.agentStatus) ?? parseJsonRecord(record.agentStatus);
  const prompt =
    asText(record.prompt) ||
    asText(record.message) ||
    asText(nested.message) ||
    asText(nested.prompt);
  const nickname = asText(record.nickname) || asText(parsed?.nickname);
  const statusRecord = asRecord(parsed?.status);
  const receivers = uniqueIds([
    ...asIdList(record.receiverThreadIds),
    ...asIdList(record.receiver_thread_ids),
    ...asIdList(nested.targets),
    ...asIdList(nested.target),
    ...asIdList(parsed?.agent_id),
    ...asIdList(statusRecord ? Object.keys(statusRecord) : [])
  ]);
  const statusParts = uniqueIds(
    [
      ...statusTexts(parsed?.status),
      ...statusTexts(parsed?.previous_status),
      ...statusTexts(record.agentStatus)
    ].filter((part) => part !== nickname)
  );
  let result = "";
  if (statusParts.length) result = statusParts.join("\n");
  else if (nickname && asText(parsed?.agent_id)) result = `已启动 ${nickname}`;
  else if (output && !parsed) result = output;
  return { prompt, nickname, receivers, result };
}

export type RuntimeNoticeLevel = "info" | "warning" | "error";
export type RuntimeNotice = {
  level: RuntimeNoticeLevel;
  title: string;
  message: string;
};

const RECONNECT_NOTICE = /^Reconnecting(?:\.{3}|…)?\s*\d+\s*\/\s*\d+/i;
const COMPACTION_DEFAULT_MESSAGE = "上下文已压缩。长会话会降低准确性，建议新开对话。";

function toolName(data: unknown) {
  return compactToolName(String(asRecord(data)?.tool ?? ""));
}

function nestedRecord(data: unknown) {
  const record = asRecord(data);
  return record ? parseJsonRecord(record.input) : null;
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isReconnectNoticeMessage(message: string) {
  return RECONNECT_NOTICE.test(message.trim());
}

export function runtimeNoticeMessage(data: unknown, text?: string): string {
  const record = asRecord(data);
  return firstString([record?.message, record?.output, text]);
}

export function isRecoverableStreamError(item: {
  kind?: string;
  text?: string;
  data?: unknown;
}) {
  if (item.kind !== "error" && toolName(item.data) !== "runtimeerror") return false;
  const message = runtimeNoticeMessage(item.data, item.text);
  return /stream disconnected before completion|stream closed before response\.completed|socket closed/i.test(
    message
  );
}

export function isRuntimePlaceholder(data: unknown, text?: string): boolean {
  if (toolName(data) !== "runtimeerror") return false;
  const message = runtimeNoticeMessage(data, text);
  if (isReconnectNoticeMessage(message)) return false;
  return !message;
}

export function isCompactionTool(data: unknown): boolean {
  if (toolName(data) === "contextcompacted") return true;
  return (
    toolName(data) === "runtimeerror" && /heads up: long threads/i.test(runtimeNoticeMessage(data))
  );
}

export function classifyRuntimeNotice(
  data: unknown,
  text?: string,
  kind?: string
): RuntimeNotice | null {
  const message = runtimeNoticeMessage(data, text);
  if (isReconnectNoticeMessage(message)) return null;
  if (isRuntimePlaceholder(data, text)) return null;
  const tool = toolName(data);
  const runtimeError = tool === "runtimeerror" || kind === "error";
  if (runtimeError && message) {
    if (/model metadata/i.test(message)) {
      return { level: "warning", title: "模型提示", message };
    }
    if (/service tier/i.test(message)) {
      return { level: "warning", title: "服务层级", message };
    }
    if (/heads up: long threads/i.test(message) || /compaction/i.test(message)) {
      return { level: "warning", title: "会话提示", message };
    }
  }
  if (tool === "contextcompacted" || isCompactionTool(data)) {
    return {
      level: "warning",
      title: "上下文压缩",
      message: message || COMPACTION_DEFAULT_MESSAGE
    };
  }
  if (runtimeError && message) {
    return { level: "error", title: "运行失败", message };
  }
  return null;
}

export function isRuntimeNotice(data: unknown, text?: string, kind?: string): boolean {
  return classifyRuntimeNotice(data, text, kind) !== null;
}

export function isUserInputTool(data: unknown): boolean {
  return toolName(data) === "requestuserinput";
}

export type UserInputOption = { label: string; description?: string };
export type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: UserInputOption[];
};

function questionsSource(data: unknown): unknown[] {
  const record = asRecord(data);
  if (!record) return [];
  if (Array.isArray(record.questions)) return record.questions;
  const nested = nestedRecord(data);
  if (Array.isArray(nested?.questions)) return nested.questions;
  const output = parseJsonRecord(record.output);
  if (Array.isArray(output?.questions)) return output.questions;
  return [];
}

function parseUserInputOption(value: unknown): UserInputOption | null {
  const row = asRecord(value);
  if (row) {
    const label = String(row.label ?? "").trim();
    if (!label) return null;
    const description = String(row.description ?? "").trim();
    return description ? { label, description } : { label };
  }
  if (typeof value === "string" && value.trim()) return { label: value.trim() };
  return null;
}

export function parseUserInputQuestions(data: unknown): UserInputQuestion[] {
  return questionsSource(data).flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const options = Array.isArray(row.options)
      ? row.options
          .map(parseUserInputOption)
          .filter((option): option is UserInputOption => option !== null)
      : [];
    return [
      {
        id: String(row.id ?? "").trim() || `question-${index + 1}`,
        header: String(row.header ?? "").trim(),
        question: String(row.question ?? "").trim(),
        options
      }
    ];
  });
}

export function isViewImageTool(data: unknown): boolean {
  return toolName(data) === "viewimage";
}

export function mergeToolEventData(base: unknown, extra: unknown) {
  const previous = asRecord(base) ?? {};
  const next = asRecord(extra) ?? {};
  const input = {
    ...(parseJsonRecord(previous.input) ?? {}),
    ...(parseJsonRecord(next.input) ?? {})
  };
  const path = firstString([next.path, previous.path, input.path]);
  const merged: Record<string, unknown> = {
    ...previous,
    ...next,
    ...(Object.keys(input).length ? { input } : {}),
    ...(path ? { path } : {})
  };
  if (isPlanTool(previous) || isPlanTool(next) || isPlanTool(merged)) {
    const nextProgress = planItemProgress(next);
    const previousProgress = planItemProgress(previous);
    const source = nextProgress > previousProgress ? next : previous;
    const items = planSource(source);
    if (items.length) merged.items = items;
    const status = String(
      (nextProgress > previousProgress ? next.status : previous.status) ??
        next.status ??
        previous.status ??
        ""
    );
    if (status) merged.status = status;
  }
  return merged;
}

export function viewImagePath(data: unknown): string {
  const record = asRecord(data);
  const nested = nestedRecord(data);
  const args = record ? parseJsonRecord(record.arguments) : null;
  return firstString([record?.path, nested?.path, args?.path, record?.file, nested?.file]);
}

export function isWriteStdinTool(data: unknown): boolean {
  return toolName(data) === "writestdin";
}

function asSessionId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function asStdinText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function firstField(data: unknown, keys: string[]) {
  const record = asRecord(data);
  const nested = nestedRecord(data);
  for (const source of [record, nested]) {
    if (!source) continue;
    for (const key of keys) {
      if (source[key] != null && source[key] !== "") return source[key];
    }
  }
  return undefined;
}

export function writeStdinDetails(data: unknown): {
  sessionId: string;
  text: string;
  yieldTimeMs?: number;
} {
  const record = asRecord(data);
  const nested = nestedRecord(data);
  const sessionId = asSessionId(firstField(data, ["session_id", "sessionId"]));
  const text =
    asStdinText(firstField(data, ["chars", "text"])) || (nested ? "" : asStdinText(record?.input));
  const yieldTimeMs = asOptionalNumber(firstField(data, ["yield_time_ms", "yieldTimeMs"]));
  return yieldTimeMs == null ? { sessionId, text } : { sessionId, text, yieldTimeMs };
}

export function isStandaloneTimelineTool(data: unknown, text?: string, kind?: string): boolean {
  return (
    isPlanTool(data) ||
    isCollabTool(data) ||
    isUserInputTool(data) ||
    isViewImageTool(data) ||
    isWriteStdinTool(data) ||
    isCompactionTool(data) ||
    isRuntimePlaceholder(data, text) ||
    isRuntimeNotice(data, text, kind)
  );
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
