import { compactTimelineItem, parseReconnectNotice, type ReconnectNotice } from "@codex-omni/protocol";
import type { Message, TimelineItem } from "@/types";
import type { TaskState } from "@/lib/task-state";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
export type RunState = TaskState;
export type QueuedCommand = { id: string; sessionId: string; data: string; message: string };
export type WorkspaceView = "chat" | "files" | "git" | "terminal";
export type ReplayCursor = { requestId: string; lastSeq: number };

export const SESSION_PAGE_SIZE = 50;
export const OUTBOUND_TURNS_STORAGE_KEY = "codex-omni:outbound-turns:v1";
export const MAX_OUTBOUND_COMMANDS = 32;
export const MAX_OUTBOUND_COMMAND_BYTES = 4 * 1024 * 1024;
export const SIDEBAR_WIDTH_KEY = "codex-omni:sidebar-width";
export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 420;
export const SIDEBAR_WIDTH_DEFAULT = 288;

export const clampSidebarWidth = (value: number) =>
  Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));

export const loadSidebarWidth = () => {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(value)) return clampSidebarWidth(value);
  } catch {
    // private browsing
  }
  return SIDEBAR_WIDTH_DEFAULT;
};

export const persistSidebarWidth = (value: number) => {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(value)));
  } catch {
    // private browsing
  }
};

export const loadOutboundCommands = (): QueuedCommand[] => {
  try {
    const value = JSON.parse(localStorage.getItem(OUTBOUND_TURNS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const valid = value.filter(
      (item): item is QueuedCommand =>
        item &&
        typeof item.id === "string" &&
        typeof item.sessionId === "string" &&
        typeof item.data === "string" &&
        typeof item.message === "string"
    );
    return boundOutboundCommands(valid);
  } catch {
    return [];
  }
};

export const persistOutboundCommands = (commands: QueuedCommand[]) => {
  try {
    const bounded = boundOutboundCommands(commands);
    if (bounded.length)
      localStorage.setItem(OUTBOUND_TURNS_STORAGE_KEY, JSON.stringify(bounded));
    else localStorage.removeItem(OUTBOUND_TURNS_STORAGE_KEY);
  } catch {
    // localStorage can be unavailable in private browsing; server-side queue remains authoritative.
  }
};

export const boundOutboundCommands = (commands: QueuedCommand[]) => {
  const result: QueuedCommand[] = [];
  let bytes = 2;
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index]!;
    const size = command.data.length + command.message.length;
    if (result.length >= MAX_OUTBOUND_COMMANDS) break;
    if (result.length > 0 && bytes + size > MAX_OUTBOUND_COMMAND_BYTES) break;
    result.push(command);
    bytes += size;
  }
  return result.reverse();
};

export const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return rest ? `${minutes}分${rest}秒` : `${minutes}分`;
};
export const formatTokens = (value?: number) => {
  if (value == null) return null;
  if (value < 1000) return value.toLocaleString();
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
};
export const parseData = (value: string | null) => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};
export const reconnectNoticeFrom = (value: unknown): ReconnectNotice | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const payload = value as Record<string, unknown>;
  const parsed = parseReconnectNotice(payload.message);
  if (parsed) return parsed;
  if (typeof payload.attempt !== "number" || typeof payload.maxAttempts !== "number")
    return undefined;
  return {
    message:
      typeof payload.message === "string"
        ? payload.message
        : `Reconnecting... ${payload.attempt}/${payload.maxAttempts}`,
    attempt: payload.attempt,
    maxAttempts: payload.maxAttempts,
    ...(typeof payload.reason === "string" ? { reason: payload.reason } : {})
  };
};
export const replayCursorKey = (id: string) => `codex-omni:replay:${id}`;
export const timelineMessageId = (message: Message) => {
  if (message.role === "approval") {
    const data = parseData(message.dataJson);
    const approvalId = data?.approvalId ?? message.itemId?.replace(/^approval:/, "");
    return approvalId ? `approval-${approvalId}` : message.id;
  }
  if (!message.itemId) return message.id;
  const [requestId, ...itemParts] = message.itemId.split(":");
  if (
    requestId &&
    itemParts.length &&
    ["assistant", "reasoning", "tool", "file", "error"].includes(message.role)
  ) {
    return `${message.role}-${requestId}-${itemParts.join(":")}`;
  }
  return `${message.role}-${message.itemId}`;
};
export const fromMessage = (m: Message, options?: { preview?: boolean }): TimelineItem => {
  const item: TimelineItem = {
    id: timelineMessageId(m),
    messageId: m.id,
    kind:
      m.role === "system" ? "system" : m.role === "run" ? "system" : (m.role as TimelineItem["kind"]),
    text: m.content,
    data: parseData(m.dataJson),
    providerId: m.providerId,
    streaming: false,
    createdAt: m.createdAt
  };
  return compactTimelineItem(item, options);
};
export const isVisibleTimelineMessage = (message: Message) =>
  message.role !== "run" &&
  !(message.role === "error" && parseReconnectNotice(message.content) !== null);

export function upsert(items: TimelineItem[], id: string, next: Omit<TimelineItem, "id">) {
  const found = items.some((x) => x.id === id);
  if (found) {
    return items.map((x) => {
      if (x.id !== id) return x;
      const createdAt = x.createdAt ?? next.createdAt;
      return createdAt == null ? { ...x, ...next, id } : { ...x, ...next, id, createdAt };
    });
  }
  return [...items, { ...next, id, createdAt: next.createdAt ?? Date.now() }];
}
