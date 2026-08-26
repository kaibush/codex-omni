import {
  parseReconnectNotice,
  textPatch,
  type BridgeEvent,
  type BridgeRequest
} from "@codex-omni/protocol";
import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";

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
        if (reconnecting) {
          return [
            envelope("run.reconnecting", {
              ...reconnecting,
              status: "running",
              startedAt,
              firstResponseAt
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
