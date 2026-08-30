import {
  extractRolloutToolEvents,
  findRolloutFile,
  type CollabRolloutEvent
} from "@codex-omni/codex-runtime";
import type { MessageRow, Store } from "@codex-omni/db";

const MATCH_WINDOW_MS = 2000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isEmptyRuntimeError(row: MessageRow) {
  if (row.role !== "tool" || !row.itemId) return false;
  let data: Record<string, unknown> | null = null;
  try {
    data = asRecord(JSON.parse(row.dataJson ?? "null"));
  } catch {
    data = null;
  }
  if (asText(data?.tool) !== "runtime_error") return false;
  return !asText(data?.message) && !asText(data?.output) && !asText(row.content);
}

function recoveredCallId(row: MessageRow) {
  if (!row.itemId) return "";
  if (row.itemId.startsWith("jsonl:")) return row.itemId.slice("jsonl:".length);
  try {
    const data = asRecord(JSON.parse(row.dataJson ?? "null"));
    const itemId = asText(data?.itemId);
    if (itemId.startsWith("call-") || itemId.startsWith("call_")) return itemId;
  } catch {
    // Keep using the persisted item id when data_json is not an object.
  }
  if (row.itemId.includes(":call-") || row.itemId.includes(":call_")) {
    const index = row.itemId.indexOf(":call");
    return index >= 0 ? row.itemId.slice(index + 1) : "";
  }
  return "";
}

function hasLiveItem(messages: MessageRow[], callId: string) {
  for (const row of messages) {
    const itemId = row.itemId ?? "";
    if (itemId === callId || itemId === `jsonl:${callId}` || itemId.endsWith(`:${callId}`))
      return true;
    if (recoveredCallId(row) === callId) return true;
  }
  return false;
}

export function rolloutToolPayload(event: CollabRolloutEvent) {
  return {
    itemId: event.itemId,
    tool: event.tool,
    ...(event.prompt ? { prompt: event.prompt } : {}),
    ...(event.receiverThreadIds?.length ? { receiverThreadIds: event.receiverThreadIds } : {}),
    ...(event.nickname ? { nickname: event.nickname } : {}),
    ...(event.output ? { output: event.output } : {}),
    ...(event.agentStatus !== undefined ? { agentStatus: event.agentStatus } : {}),
    ...(event.input !== undefined ? { input: event.input } : {}),
    status: event.status,
    phase: event.phase
  };
}

function persistRolloutEvent(input: {
  store: Store;
  sessionId: string;
  providerId: string | null | undefined;
  itemId: string;
  event: CollabRolloutEvent;
  createdAt?: number;
}) {
  input.store.upsertEventMessage({
    sessionId: input.sessionId,
    role: "tool",
    content: input.event.prompt || input.event.nickname || "",
    ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
    eventType: input.event.phase === "started" ? "tool.started" : "tool.output",
    itemId: input.itemId,
    dataJson: JSON.stringify(rolloutToolPayload(input.event)),
    ...(input.createdAt != null ? { createdAt: input.createdAt } : {})
  });
}

export type RolloutBackfillChange = {
  itemId: string;
  event: CollabRolloutEvent;
};

export function backfillSessionRolloutTools(input: {
  store: Store;
  sessionId: string;
  threadId: string | null | undefined;
  providerId: string | null | undefined;
  codexHome: string;
}): RolloutBackfillChange[] {
  if (!input.threadId) return [];
  const filePath = findRolloutFile(input.codexHome, input.threadId);
  if (!filePath) return [];
  const events = extractRolloutToolEvents(filePath);
  if (!events.length) return [];
  const messages = input.store.listMessages(input.sessionId);
  const recovered = new Set(messages.map(recoveredCallId).filter(Boolean));
  const emptyErrors = messages.filter(isEmptyRuntimeError);
  const used = new Set<number>();
  const changes: RolloutBackfillChange[] = [];
  for (const event of events) {
    if (recovered.has(event.itemId) || hasLiveItem(messages, event.itemId)) continue;
    const timestamp = event.timestamp;
    let best = -1;
    let bestDist = MATCH_WINDOW_MS + 1;
    if (timestamp != null) {
      for (let index = 0; index < emptyErrors.length; index += 1) {
        if (used.has(index)) continue;
        const dist = Math.abs(emptyErrors[index]!.createdAt - timestamp);
        if (dist < bestDist) {
          bestDist = dist;
          best = index;
        }
      }
    }
    if (best >= 0 && bestDist <= MATCH_WINDOW_MS) {
      used.add(best);
      const row = emptyErrors[best]!;
      persistRolloutEvent({
        store: input.store,
        sessionId: input.sessionId,
        providerId: input.providerId,
        itemId: row.itemId!,
        event
      });
      recovered.add(event.itemId);
      changes.push({ itemId: row.itemId!, event });
      continue;
    }
    const itemId = `jsonl:${event.itemId}`;
    persistRolloutEvent({
      store: input.store,
      sessionId: input.sessionId,
      providerId: input.providerId,
      itemId,
      event,
      ...(event.timestamp != null ? { createdAt: event.timestamp } : {})
    });
    recovered.add(event.itemId);
    changes.push({ itemId, event });
  }
  return changes;
}
