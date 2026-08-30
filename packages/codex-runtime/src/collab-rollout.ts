import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";

export const COLLAB_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_input",
  "wait_agent",
  "wait",
  "resume_agent",
  "close_agent"
]);

export type CollabRolloutEvent = {
  itemId: string;
  tool: string;
  phase: "started" | "completed";
  status: "in_progress" | "completed";
  prompt?: string;
  receiverThreadIds?: string[];
  nickname?: string;
  output?: string;
  agentStatus?: unknown;
  input?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function asIdList(value: unknown): string[] {
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

function extractReceivers(record: Record<string, unknown>) {
  return uniqueIds([
    ...asIdList(record.targets),
    ...asIdList(record.target),
    ...asIdList(record.receiver_thread_ids),
    ...asIdList(record.receiverThreadIds),
    ...asIdList(record.agent_id),
    ...asIdList(record.agentId)
  ]);
}

export function findRolloutFile(codexHome: string, threadId: string) {
  const root = path.join(codexHome, "sessions");
  const suffix = `-${threadId}.jsonl`;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name.startsWith("rollout-") && entry.name.endsWith(suffix)) return full;
    }
  }
  return "";
}

export function parseCollabRolloutLine(
  line: string,
  pendingTools: Map<string, string>
): CollabRolloutEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const root = asRecord(obj);
  if (!root) return null;
  const payload = asRecord(root.payload) ?? (root.type ? root : null);
  if (!payload) return null;
  const payloadType = asText(payload.type);
  if (payloadType === "function_call") {
    const tool = asText(payload.name);
    if (!COLLAB_TOOL_NAMES.has(tool)) return null;
    const itemId = asText(payload.call_id ?? payload.callId);
    if (!itemId) return null;
    pendingTools.set(itemId, tool);
    const args = asRecord(parseJsonValue(payload.arguments)) ?? {};
    const prompt = asText(args.message) || asText(args.prompt) || asText(args.instructions);
    const receivers = extractReceivers(args);
    return {
      itemId,
      tool,
      phase: "started",
      status: "in_progress",
      ...(prompt ? { prompt } : {}),
      ...(receivers.length ? { receiverThreadIds: receivers } : {}),
      input: args
    };
  }
  if (payloadType === "function_call_output") {
    const itemId = asText(payload.call_id ?? payload.callId);
    if (!itemId) return null;
    const tool = pendingTools.get(itemId);
    if (!tool) return null;
    pendingTools.delete(itemId);
    const output = asText(payload.output);
    const parsed = asRecord(parseJsonValue(output));
    const receivers = parsed ? extractReceivers(parsed) : [];
    const nickname = parsed ? asText(parsed.nickname) : "";
    return {
      itemId,
      tool,
      phase: "completed",
      status: "completed",
      ...(receivers.length ? { receiverThreadIds: receivers } : {}),
      ...(nickname ? { nickname } : {}),
      ...(output ? { output } : {}),
      ...(parsed?.status ? { agentStatus: parsed.status } : {})
    };
  }
  return null;
}

export function createCollabRolloutTailer(codexHome: string) {
  let threadId = "";
  let filePath = "";
  let offset = 0;
  let buffer = "";
  let startedAtEnd = false;
  const pendingTools = new Map<string, string>();

  const readNewEvents = (): CollabRolloutEvent[] => {
    if (!filePath) return [];
    let fd;
    try {
      fd = openSync(filePath, "r");
    } catch {
      return [];
    }
    try {
      const size = fstatSync(fd).size;
      if (!startedAtEnd) {
        offset = size;
        startedAtEnd = true;
        return [];
      }
      if (size <= offset) return [];
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      buffer += buf.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      const events: CollabRolloutEvent[] = [];
      for (const line of lines) {
        const parsed = parseCollabRolloutLine(line, pendingTools);
        if (parsed) events.push(parsed);
      }
      return events;
    } finally {
      closeSync(fd);
    }
  };

  return {
    setThreadId(id: string) {
      if (threadId === id) return;
      threadId = id;
      filePath = "";
      offset = 0;
      buffer = "";
      startedAtEnd = false;
      pendingTools.clear();
    },
    flush() {
      if (!threadId) return [] as CollabRolloutEvent[];
      if (!filePath) {
        filePath = findRolloutFile(codexHome, threadId);
        if (!filePath) return [];
        try {
          offset = statSync(filePath).size;
          startedAtEnd = true;
        } catch {
          filePath = "";
          return [];
        }
      }
      return readNewEvents();
    }
  };
}
