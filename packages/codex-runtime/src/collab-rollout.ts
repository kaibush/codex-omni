import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync
} from "node:fs";
import path from "node:path";

export const COLLAB_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_input",
  "wait_agent",
  "resume_agent",
  "close_agent"
]);

const EXTRA_TOOL_NAMES = new Set(["view_image", "write_stdin", "request_user_input"]);

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
  timestamp?: number;
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

function numericFields(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
  }
  return result;
}

function isRecoveredTool(tool: string) {
  return COLLAB_TOOL_NAMES.has(tool) || EXTRA_TOOL_NAMES.has(tool);
}

function recoveredInput(tool: string, args: Record<string, unknown>) {
  if (tool !== "write_stdin") return args;
  const sessionId = args.sessionId ?? args.session_id;
  const chars = args.chars ?? args.text;
  return {
    ...args,
    ...(sessionId !== undefined ? { session_id: args.session_id ?? sessionId, sessionId } : {}),
    ...(chars !== undefined ? { chars: args.chars ?? chars, text: args.text ?? chars } : {})
  };
}

function parseRolloutPayload(line: string): Record<string, unknown> | null {
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
  return asRecord(root.payload) ?? (root.type ? root : null);
}

function parseTokenCountPayload(payload: Record<string, unknown>): Record<string, number> | null {
  if (asText(payload.type) !== "token_count") return null;
  const info = asRecord(payload.info);
  if (!info) return null;
  const usage = numericFields(info.total_token_usage);
  if (typeof info.model_context_window === "number" && Number.isFinite(info.model_context_window)) {
    usage.model_context_window = info.model_context_window;
  }
  return Object.keys(usage).length ? usage : null;
}

const rolloutFileCache = new Map<string, string>();

function searchRolloutFile(codexHome: string, threadId: string) {
  const root = path.join(codexHome, "sessions");
  const suffix = `-${threadId}.jsonl`;
  const walk = (dir: string): string => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return "";
    }
    const dirs: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(entry.name);
        continue;
      }
      if (entry.name.startsWith("rollout-") && entry.name.endsWith(suffix)) return full;
    }
    dirs.sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
    for (const name of dirs) {
      const found = walk(path.join(dir, name));
      if (found) return found;
    }
    return "";
  };
  return walk(root);
}

export function findRolloutFile(codexHome: string, threadId: string) {
  if (!threadId) return "";
  const key = `${codexHome}::${threadId}`;
  const cached = rolloutFileCache.get(key);
  if (cached) {
    try {
      if (statSync(cached).isFile()) return cached;
    } catch {
      rolloutFileCache.delete(key);
    }
  }
  const found = searchRolloutFile(codexHome, threadId);
  if (found) rolloutFileCache.set(key, found);
  return found;
}

function lineTimestamp(line: string) {
  const root = asRecord(parseJsonValue(line));
  const parsed = Date.parse(asText(root?.timestamp));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withTimestamp(event: CollabRolloutEvent, line: string): CollabRolloutEvent {
  const timestamp = lineTimestamp(line);
  return timestamp == null ? event : { ...event, timestamp };
}

export function parseCollabRolloutLine(
  line: string,
  pendingTools: Map<string, string>,
  byteOffset = 0
): CollabRolloutEvent | null {
  const payload = parseRolloutPayload(line);
  if (!payload) return null;
  const payloadType = asText(payload.type);
  if (payloadType === "function_call") {
    const tool = asText(payload.name);
    if (!isRecoveredTool(tool)) return null;
    const itemId = asText(payload.call_id ?? payload.callId);
    if (!itemId) return null;
    pendingTools.set(itemId, tool);
    const args = asRecord(parseJsonValue(payload.arguments)) ?? {};
    const prompt = asText(args.message) || asText(args.prompt) || asText(args.instructions);
    const receivers = extractReceivers(args);
    return withTimestamp(
      {
        itemId,
        tool,
        phase: "started",
        status: "in_progress",
        ...(prompt ? { prompt } : {}),
        ...(receivers.length ? { receiverThreadIds: receivers } : {}),
        input: recoveredInput(tool, args)
      },
      line
    );
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
    return withTimestamp(
      {
        itemId,
        tool,
        phase: "completed",
        status: "completed",
        ...(receivers.length ? { receiverThreadIds: receivers } : {}),
        ...(nickname ? { nickname } : {}),
        ...(output ? { output } : {}),
        ...(parsed?.status ? { agentStatus: parsed.status } : {})
      },
      line
    );
  }
  if (payloadType === "context_compacted") {
    return withTimestamp(
      {
        itemId: `context-compacted-${byteOffset}`,
        tool: "context_compacted",
        phase: "completed",
        status: "completed"
      },
      line
    );
  }
  return null;
}

export function extractRolloutToolEvents(filePath: string): CollabRolloutEvent[] {
  let text = "";
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const pendingTools = new Map<string, string>();
  const byId = new Map<string, CollabRolloutEvent>();
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseCollabRolloutLine(line, pendingTools, offset);
    offset += Buffer.byteLength(line, "utf8") + 1;
    if (!parsed) continue;
    const previous = byId.get(parsed.itemId);
    const timestamp = previous?.timestamp ?? parsed.timestamp;
    byId.set(
      parsed.itemId,
      previous
        ? {
            ...previous,
            ...parsed,
            ...(previous.prompt && !parsed.prompt ? { prompt: previous.prompt } : {}),
            ...(previous.receiverThreadIds?.length && !parsed.receiverThreadIds?.length
              ? { receiverThreadIds: previous.receiverThreadIds }
              : {}),
            ...(previous.input !== undefined && parsed.input === undefined
              ? { input: previous.input }
              : {}),
            ...(timestamp != null ? { timestamp } : {})
          }
        : parsed
    );
  }
  return [...byId.values()];
}

export function createCollabRolloutTailer(codexHome: string) {
  let threadId = "";
  let filePath = "";
  let offset = 0;
  let buffer = "";
  let startedAtEnd = false;
  let pinFromEnd = true;
  let latestUsage: Record<string, number> | null = null;
  const pendingTools = new Map<string, string>();
  const emitted = new Set<string>();

  const pinFile = (fromEnd: boolean) => {
    if (!threadId) return;
    filePath = findRolloutFile(codexHome, threadId);
    if (!filePath) return;
    try {
      offset = fromEnd ? statSync(filePath).size : 0;
      startedAtEnd = true;
    } catch {
      filePath = "";
    }
  };

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
        offset = pinFromEnd ? size : 0;
        startedAtEnd = true;
        if (pinFromEnd) return [];
      }
      if (size <= offset) return [];
      const previousOffset = offset;
      const leftoverBytes = Buffer.byteLength(buffer, "utf8");
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      buffer += buf.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      const events: CollabRolloutEvent[] = [];
      let lineOffset = previousOffset - leftoverBytes;
      for (const line of lines) {
        const payload = parseRolloutPayload(line);
        if (payload) {
          const usage = parseTokenCountPayload(payload);
          if (usage) latestUsage = usage;
        }
        const parsed = parseCollabRolloutLine(line, pendingTools, lineOffset);
        if (parsed) {
          const key = `${parsed.itemId}:${parsed.phase}`;
          if (!emitted.has(key)) {
            emitted.add(key);
            events.push(parsed);
          }
        }
        lineOffset += Buffer.byteLength(line, "utf8") + 1;
      }
      return events;
    } finally {
      closeSync(fd);
    }
  };

  return {
    setThreadId(id: string, options: { fromEnd?: boolean } = {}) {
      if (threadId === id) return;
      threadId = id;
      pinFromEnd = options.fromEnd !== false;
      filePath = "";
      offset = 0;
      buffer = "";
      startedAtEnd = false;
      latestUsage = null;
      pendingTools.clear();
      emitted.clear();
      pinFile(pinFromEnd);
    },
    flush() {
      if (!threadId) return [] as CollabRolloutEvent[];
      if (!filePath) pinFile(pinFromEnd);
      if (!filePath) return [];
      return readNewEvents();
    },
    latestTokenUsage() {
      return latestUsage;
    }
  };
}
