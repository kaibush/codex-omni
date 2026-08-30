import {
  parseReconnectNotice,
  textPatch,
  type BridgeEvent,
  type BridgeRequest
} from "@codex-omni/protocol";
import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";

const providerFailurePattern =
  /\bHTTP\s*[45]\d{2}\b|\b(?:status|status[_ ]?code|code|response|error)\s*[:=]?\s*[45]\d{2}\b|\b[45]\d{2}\s+(?:unauthori[sz]ed|forbidden|bad request|not found|too many requests|internal server error|service unavailable)\b|api\s*key|unauthori[sz]ed|forbidden|invalid\s+(?:api\s*key|model|request|parameter)|model\s+(?:not\s+found|does\s+not\s+exist)|rate\s*limit|quota|insufficient\s+(?:quota|credits)|billing|payment required|authentication failed/i;

const isProviderFailure = (message: string, reason?: string) =>
  providerFailurePattern.test(message) || (reason ? providerFailurePattern.test(reason) : false);

const COLLAB_ITEM_TYPES = new Set([
  "collab_tool_call",
  "collabToolCall",
  "collab_agent_tool_call",
  "collabAgentToolCall"
]);
const COLLAB_TOOL_NAMES = new Set([
  "collab",
  "spawn_agent",
  "wait_agent",
  "wait",
  "send_input",
  "close_agent",
  "resume_agent",
  "handoff"
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compactType(value: string) {
  return value.toLowerCase().replace(/[_-]/g, "");
}

function asIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function asPrompt(value: unknown) {
  return typeof value === "string" ? value : "";
}

function planItemsFrom(record: Record<string, unknown>) {
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.steps)) return record.steps;
  if (Array.isArray(record.plan)) return record.plan;
  return [];
}

function isPlanLikeItem(type: string, tool: string) {
  const normalized = compactType(type);
  const normalizedTool = compactType(tool);
  return (
    normalized === "todolist" ||
    normalized === "plan" ||
    normalized === "planimplementation" ||
    normalized === "updateplan" ||
    normalizedTool === "todolist" ||
    normalizedTool === "updateplan"
  );
}

function isCollabLikeItem(type: string, tool: string) {
  const normalizedTool = compactType(tool.split("__").at(-1) ?? tool);
  return (
    COLLAB_ITEM_TYPES.has(type) ||
    type.toLowerCase().includes("collab") ||
    COLLAB_TOOL_NAMES.has(tool) ||
    COLLAB_TOOL_NAMES.has(normalizedTool)
  );
}

function mapUnknownItem(
  phase: "started" | "updated" | "completed",
  item: unknown,
  envelope: (type: BridgeEvent["type"], payload: unknown) => BridgeEvent
): BridgeEvent[] {
  const record = asRecord(item) ?? {};
  const type = String(record.type ?? "unknown");
  const tool = String(record.tool ?? record.name ?? "");
  const status =
    String(record.status ?? "") || (phase === "completed" ? "completed" : "in_progress");
  if (isPlanLikeItem(type, tool)) {
    return [
      envelope(phase === "started" ? "tool.started" : "tool.output", {
        itemId: String(record.id ?? ""),
        tool: "update_plan",
        items: planItemsFrom(record),
        status,
        phase
      })
    ];
  }
  const collab = isCollabLikeItem(type, tool);
  const payload = {
    itemId: String(record.id ?? ""),
    tool: collab ? tool || "collab" : tool || type,
    prompt: asPrompt(record.prompt) || asPrompt(record.message) || asPrompt(record.input),
    senderThreadId: record.sender_thread_id ?? record.senderThreadId,
    receiverThreadIds: asIdList(
      record.receiver_thread_ids ??
        record.receiverThreadIds ??
        record.receiver_thread_id ??
        record.receiverThreadId ??
        record.new_thread_id ??
        record.newThreadId
    ),
    agentStatus: record.agent_status ?? record.agentStatus ?? record.agents_states,
    status,
    phase,
    input: record.arguments ?? record.input ?? record
  };
  return [envelope(phase === "started" ? "tool.started" : "tool.output", payload)];
}

export function createNormalizer(request: BridgeRequest) {
  let seq = 0;
  const startedAt = Date.now();
  let firstResponseAt: number | undefined;
  const envelope = (
    type: BridgeEvent["type"],
    payload: unknown,
    ids: { threadId?: string; turnId?: string } = {}
  ): BridgeEvent => ({
    protocolVersion: 1,
    requestId: request.requestId,
    projectId: request.projectId,
    sessionId: request.sessionId,
    ...(ids.threadId ? { threadId: ids.threadId } : {}),
    ...(ids.turnId ? { turnId: ids.turnId } : {}),
    seq: ++seq,
    type,
    payload
  });
  const lastText = new Map<string, string>();
  const patchField = (itemId: string, key: "text" | "output", next: string | undefined) => {
    const value = next ?? "";
    const previous = lastText.get(`${key}:${itemId}`) ?? "";
    lastText.set(`${key}:${itemId}`, value);
    const patch = textPatch(previous, value);
    return key === "text"
      ? patch
      : "delta" in patch
        ? { outputDelta: patch.delta }
        : { output: patch.text };
  };
  const itemEvent = (
    phase: "started" | "updated" | "completed",
    item: ThreadItem
  ): BridgeEvent[] => {
    firstResponseAt ??= Date.now();
    if (item.type === "agent_message")
      return [
        envelope(phase === "completed" ? "assistant.completed" : "assistant.delta", {
          itemId: item.id,
          phase,
          ...(phase === "completed" ? { text: item.text } : patchField(item.id, "text", item.text))
        })
      ];
    if (item.type === "reasoning")
      return [
        envelope("reasoning.delta", {
          itemId: item.id,
          phase,
          ...patchField(item.id, "text", item.text)
        })
      ];
    if (item.type === "command_execution")
      return [
        envelope(phase === "started" ? "tool.started" : "tool.output", {
          itemId: item.id,
          tool: "command",
          command: item.command,
          exitCode: item.exit_code,
          status: item.status,
          phase,
          ...(phase === "completed"
            ? { output: item.aggregated_output }
            : patchField(item.id, "output", item.aggregated_output))
        })
      ];
    if (item.type === "file_change")
      return [
        envelope("file.change", {
          itemId: item.id,
          changes: item.changes,
          status: item.status,
          phase
        })
      ];
    if (item.type === "mcp_tool_call")
      return [
        envelope(phase === "started" ? "tool.started" : "tool.output", {
          itemId: item.id,
          tool: `mcp__${item.server}__${item.tool}`,
          input: item.arguments,
          result: item.result,
          error: item.error,
          status: item.status,
          phase
        })
      ];
    if (item.type === "web_search")
      return [
        envelope(phase === "started" ? "tool.started" : "tool.output", {
          itemId: item.id,
          tool: "web_search",
          query: item.query,
          phase
        })
      ];
    if (item.type === "todo_list")
      return [
        envelope(phase === "started" ? "tool.started" : "tool.output", {
          itemId: item.id,
          tool: "update_plan",
          items: item.items,
          status: phase === "completed" ? "completed" : "in_progress",
          phase
        })
      ];
    if (item.type === "error") {
      const message = String(asRecord(item)?.message ?? "").trim();
      // Exec JSON cannot represent collab/sub-agent items, so the CLI emits
      // empty error placeholders. Those are recovered from the session JSONL.
      if (!message) return [];
      return [
        envelope("tool.output", {
          itemId: item.id,
          tool: "runtime_error",
          message,
          phase
        })
      ];
    }
    return mapUnknownItem(phase, item, envelope);
  };
  const timedItemEvent = (
    phase: "started" | "updated" | "completed",
    item: ThreadItem
  ): BridgeEvent[] => {
    firstResponseAt ??= Date.now();
    return itemEvent(phase, item).map((event) => ({
      ...event,
      payload: {
        ...((event.payload ?? {}) as Record<string, unknown>),
        startedAt,
        firstResponseAt
      }
    }));
  };
  return {
    initial: () =>
      envelope("run.started", {
        runtimeKey: request.runtimeKey,
        providerConfigured: Boolean(request.apiKey || request.authJson),
        startedAt
      }),
    map(event: ThreadEvent): BridgeEvent[] {
      if (event.type === "thread.started")
        return [
          envelope("thread.started", { threadId: event.thread_id }, { threadId: event.thread_id })
        ];
      if (event.type === "turn.started") return [envelope("turn.started", {})];
      if (event.type === "turn.completed")
        return [
          envelope("turn.completed", {
            usage: event.usage,
            status: "completed",
            startedAt,
            firstResponseAt,
            endedAt: Date.now()
          })
        ];
      if (event.type === "turn.failed")
        return [
          envelope("run.failed", {
            message: event.error.message,
            status: "failed",
            startedAt,
            firstResponseAt,
            endedAt: Date.now()
          })
        ];
      if (event.type === "error") {
        const reconnecting = parseReconnectNotice(event.message);
        const providerFailure = reconnecting
          ? isProviderFailure(reconnecting.message, reconnecting.reason)
          : isProviderFailure(event.message);
        // The SDK reports the final exhausted attempt as a reconnect notice too.
        // Treat it as terminal so the original stream error is not replaced by
        // the worker's generic non-zero exit message. Provider failures are
        // terminal regardless of whether their text contains a retry-looking
        // prefix.
        if (reconnecting && !providerFailure && reconnecting.attempt < reconnecting.maxAttempts) {
          return [
            envelope("run.reconnecting", {
              ...reconnecting,
              status: "running",
              startedAt,
              firstResponseAt
            })
          ];
        }
        if (reconnecting) {
          return [
            envelope("run.failed", {
              message: reconnecting.reason ?? reconnecting.message,
              reason: reconnecting.reason,
              status: "failed",
              startedAt,
              firstResponseAt,
              endedAt: Date.now()
            })
          ];
        }
        return [
          envelope("run.failed", {
            message: event.message,
            status: "failed",
            startedAt,
            firstResponseAt,
            endedAt: Date.now()
          })
        ];
      }
      return timedItemEvent(event.type.slice(5) as "started" | "updated" | "completed", event.item);
    },
    toolEvent: (payload: Record<string, unknown>) => {
      firstResponseAt ??= Date.now();
      const phase = payload.phase === "started" ? "started" : "completed";
      return envelope(phase === "started" ? "tool.started" : "tool.output", {
        ...payload,
        phase,
        status: payload.status ?? (phase === "started" ? "in_progress" : "completed"),
        startedAt,
        firstResponseAt
      });
    },
    approvalRequested: (payload: {
      approvalId: string;
      itemId: string;
      tool: string;
      command: string;
    }) => {
      firstResponseAt ??= Date.now();
      return envelope("approval.requested", { ...payload, startedAt, firstResponseAt });
    },
    failure: (error: unknown) =>
      envelope("run.failed", {
        message: error instanceof Error ? error.message : String(error),
        status: "failed",
        startedAt,
        firstResponseAt,
        endedAt: Date.now()
      })
  };
}
