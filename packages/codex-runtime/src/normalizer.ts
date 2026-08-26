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
        envelope("tool.output", { itemId: item.id, tool: "update_plan", items: item.items, phase })
      ];
    return [
      envelope("tool.output", {
        itemId: item.id,
        tool: "runtime_error",
        message: item.message,
        phase
      })
    ];
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
