import { textPatch, type BridgeEvent, type BridgeRequest } from "@codex-omni/protocol";

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
const blocks = (value: unknown): RecordValue[] => (Array.isArray(value) ? value.map(record) : []);
const contentText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : blocks(value)
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n");

function fileDiff(file: string, result: RecordValue) {
  if (typeof result.patch === "string") return result.patch;
  const hunks = blocks(result.structuredPatch);
  if (!hunks.length) return "";
  const lines: string[] = [`--- a/${file}`, `+++ b/${file}`];
  for (const hunk of hunks) {
    if (
      ![hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines].every(
        (value) => Number.isInteger(value) && value >= 0
      ) ||
      !Array.isArray(hunk.lines) ||
      !hunk.lines.every((line: unknown) => typeof line === "string" && /^[ +\\-]/.test(line))
    )
      return "";
    const oldCount = hunk.lines.filter(
      (line: string) => line.startsWith(" ") || line.startsWith("-")
    ).length;
    const newCount = hunk.lines.filter(
      (line: string) => line.startsWith(" ") || line.startsWith("+")
    ).length;
    if (oldCount !== hunk.oldLines || newCount !== hunk.newLines) return "";
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      ...hunk.lines
    );
  }
  return `${lines.join("\n")}\n`;
}

export function createClaudeNormalizer(request: BridgeRequest) {
  let seq = 0;
  let threadId = request.threadId;
  const startedAt = Date.now();
  let firstResponseAt: number | undefined;
  let assistantSeen = false;
  const streams = new Map<string, string>();
  const text = new Map<string, string>();
  const tools = new Map<string, RecordValue>();
  const streamTools = new Map<string, string>();
  const toolJson = new Map<string, string>();
  const activeTasks = new Set<string>();
  const taskTools = new Map<string, string>();
  const taskStatus = new Map<string, string>();
  const todos = new Map<string, RecordValue>();

  const emit = (type: BridgeEvent["type"], payload: unknown): BridgeEvent => ({
    protocolVersion: 1,
    requestId: request.requestId,
    projectId: request.projectId,
    sessionId: request.sessionId,
    ...(threadId ? { threadId } : {}),
    seq: ++seq,
    type,
    payload: { ...(payload as RecordValue), clientType: "claude-code" }
  });
  const metadata = (parent: string | null) =>
    parent ? { parentToolUseId: parent, subagent: true } : {};
  const textEvent = (
    id: string,
    value: string,
    thinking: boolean,
    parent: string | null,
    complete: boolean
  ) => {
    const previous = text.get(id) ?? "";
    text.set(id, value);
    const patch = textPatch(previous, value);
    if (parent)
      return emit("tool.output", {
        itemId: id,
        tool: thinking ? "subagent_reasoning" : "subagent_message",
        ...metadata(parent),
        output: value,
        status: complete ? "completed" : "in_progress"
      });
    if (!thinking) assistantSeen = true;
    return emit(
      thinking ? "reasoning.delta" : complete ? "assistant.completed" : "assistant.delta",
      { itemId: id, ...patch, ...(complete ? { text: value, completed: true } : {}) }
    );
  };
  const toolPayload = (id: string, name: string, input: RecordValue, parent: string | null) => ({
    itemId: id,
    tool: name,
    input,
    ...metadata(parent),
    ...(name === "Bash" ? { command: input.command } : {}),
    ...(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(name)
      ? { path: input.file_path ?? input.notebook_path }
      : {}),
    ...(["Agent", "Task"].includes(name)
      ? {
          prompt: input.prompt,
          description: input.description,
          nickname: input.name ?? input.subagent_type,
          agentRole: input.subagent_type
        }
      : {})
  });

  const normalize = (raw: unknown): BridgeEvent[] => {
    const message = record(raw);
    const events: BridgeEvent[] = [];
    if (typeof message.session_id === "string" && message.session_id !== threadId) {
      threadId = message.session_id;
      events.push(emit("thread.started", { threadId, clientType: "claude-code" }));
    }
    const parent =
      typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null;
    if (message.type === "stream_event") {
      firstResponseAt ??= Date.now();
      const event = record(message.event);
      const scope = parent ?? "main";
      if (event.type === "message_start")
        streams.set(scope, String(event.message?.id ?? message.uuid));
      const streamId = streams.get(scope) ?? String(message.uuid);
      const index = Number(event.index ?? 0);
      const id = `${streamId}:${index}`;
      if (event.type === "content_block_start") {
        const block = record(event.content_block);
        if (block.type === "tool_use") {
          const payload = toolPayload(
            String(block.id),
            String(block.name),
            record(block.input),
            parent
          );
          tools.set(String(block.id), payload);
          streamTools.set(id, String(block.id));
          events.push(emit("tool.started", { ...payload, status: "in_progress" }));
        } else if (block.type === "text" || block.type === "thinking") {
          events.push(
            textEvent(
              id,
              String(block.text ?? block.thinking ?? ""),
              block.type === "thinking",
              parent,
              false
            )
          );
        }
      } else if (event.type === "content_block_delta") {
        const delta = record(event.delta);
        if (delta.type === "text_delta" || delta.type === "thinking_delta") {
          events.push(
            textEvent(
              id,
              (text.get(id) ?? "") + String(delta.text ?? delta.thinking ?? ""),
              delta.type === "thinking_delta",
              parent,
              false
            )
          );
        } else if (delta.type === "input_json_delta") {
          const toolId = streamTools.get(id);
          if (toolId)
            toolJson.set(toolId, (toolJson.get(toolId) ?? "") + String(delta.partial_json ?? ""));
        }
      }
    } else if (message.type === "assistant") {
      firstResponseAt ??= Date.now();
      const assistant = record(message.message);
      for (const [index, block] of blocks(assistant.content).entries()) {
        const id = `${assistant.id ?? message.uuid}:${index}`;
        if (block.type === "text" || block.type === "thinking") {
          events.push(
            textEvent(
              id,
              String(block.text ?? block.thinking ?? ""),
              block.type === "thinking",
              parent,
              true
            )
          );
        } else if (block.type === "tool_use") {
          const toolId = String(block.id);
          const payload = toolPayload(toolId, String(block.name), record(block.input), parent);
          const existed = tools.has(toolId);
          tools.set(toolId, payload);
          toolJson.delete(toolId);
          events.push(
            emit(existed ? "tool.output" : "tool.started", { ...payload, status: "in_progress" })
          );
          if (block.name === "TodoWrite")
            events.push(
              emit("tool.output", {
                itemId: "claude:plan",
                tool: "update_plan",
                items: blocks(block.input?.todos).map((todo) => ({ ...todo, text: todo.content })),
                status: "completed"
              })
            );
        }
      }
    } else if (message.type === "user") {
      for (const block of blocks(message.message?.content)) {
        if (block.type !== "tool_result") continue;
        const toolId = String(block.tool_use_id);
        const payload = tools.get(toolId) ?? { itemId: toolId, tool: "tool", ...metadata(parent) };
        const output = contentText(block.content);
        const result = record(message.tool_use_result);
        const background =
          result.isAsync || result.status === "async_launched" || result.status === "running";
        if (!background) {
          for (const [taskId, id] of taskTools)
            if (id === toolId) {
              activeTasks.delete(taskId);
              taskStatus.set(taskId, block.is_error ? "failed" : "completed");
            }
        }
        events.push({
          ...emit("tool.output", {
            ...payload,
            output,
            result,
            status: block.is_error ? "failed" : background ? "in_progress" : "completed",
            isError: Boolean(block.is_error)
          })
        });
        if (
          !block.is_error &&
          !result.staged &&
          ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(payload.tool)
        ) {
          const file = String(payload.path ?? "");
          if (file)
            events.push(
              emit("file.change", {
                itemId: `${toolId}:file`,
                changes: [
                  {
                    path: file,
                    kind: result.type === "create" ? "add" : "update",
                    diff: fileDiff(file, result)
                  }
                ]
              })
            );
        }
        if (payload.tool === "TaskCreate" && !block.is_error) {
          const task = record(result.task);
          const taskId = String(task.id ?? result.taskId ?? toolId);
          todos.set(taskId, {
            text: payload.input?.subject ?? task.subject ?? "任务",
            status: "pending"
          });
        } else if (payload.tool === "TaskUpdate" && !block.is_error) {
          const taskId = String(payload.input?.taskId ?? "");
          if (payload.input?.status === "deleted") todos.delete(taskId);
          else
            todos.set(taskId, {
              ...(todos.get(taskId) ?? { text: payload.input?.subject ?? taskId }),
              status: payload.input?.status ?? "pending"
            });
        }
        if (["TaskCreate", "TaskUpdate"].includes(payload.tool))
          events.push(
            emit("tool.output", {
              itemId: "claude:tasks",
              tool: "update_plan",
              items: [...todos.values()],
              status: "completed"
            })
          );
      }
    } else if (message.type === "system") {
      if (message.subtype === "init") {
        events.push(
          emit("tool.output", {
            itemId: "claude:capabilities",
            tool: "client_capabilities",
            clientType: "claude-code",
            model: message.model,
            version: message.claude_code_version,
            commands: message.slash_commands ?? [],
            terminalCommands: message.terminal_slash_commands ?? [],
            agents: message.agents ?? [],
            skills: message.skills ?? [],
            mcpServers: message.mcp_servers ?? [],
            permissionMode: message.permissionMode,
            status: "completed"
          })
        );
      } else if (
        ["task_started", "task_progress", "task_notification", "task_updated"].includes(
          message.subtype
        )
      ) {
        const taskId = String(message.task_id);
        if (message.ambient || message.skip_transcript) return events;
        if (message.tool_use_id) taskTools.set(taskId, String(message.tool_use_id));
        const toolId = taskTools.get(taskId);
        const payload = toolId ? tools.get(toolId) : undefined;
        const rawStatus =
          message.subtype === "task_notification"
            ? message.status
            : (message.patch?.status ?? taskStatus.get(taskId) ?? "in_progress");
        const status = ["running", "pending"].includes(rawStatus) ? "in_progress" : rawStatus;
        taskStatus.set(taskId, status);
        if (["completed", "failed", "stopped", "killed"].includes(status))
          activeTasks.delete(taskId);
        else activeTasks.add(taskId);
        events.push(
          emit(message.subtype === "task_started" ? "tool.started" : "tool.output", {
            ...payload,
            itemId: toolId ?? `task:${taskId}`,
            tool: payload?.tool ?? "Agent",
            taskId,
            status,
            description: message.description ?? message.patch?.description,
            summary: message.summary,
            ...(message.summary ? { output: message.summary } : {}),
            usage: message.usage,
            nickname: message.subagent_type ?? payload?.nickname,
            background: message.is_backgrounded ?? message.patch?.is_backgrounded,
            outputFile: message.output_file
          })
        );
      } else if (message.subtype === "compact_boundary") {
        events.push(
          emit("tool.output", {
            itemId: `compact:${message.uuid}`,
            tool: "context_compacted",
            output: "Claude Code 已压缩上下文",
            metadata: message.compact_metadata,
            status: "completed"
          })
        );
      } else if (message.subtype === "status" && message.status === "compacting") {
        events.push(
          emit("tool.output", {
            itemId: `status:${message.uuid}`,
            tool: "context_compacting",
            output: "正在压缩上下文…",
            status: "in_progress"
          })
        );
      } else if (message.subtype === "api_retry") {
        events.push(
          emit("run.reconnecting", {
            message: `Claude Code 正在重试（${message.attempt ?? 1}）`,
            reason: message.error ?? message.error_status
          })
        );
      } else if (message.subtype === "local_command_output") {
        events.push(
          emit("tool.output", {
            itemId: `command:${message.uuid}`,
            tool: "slash_command",
            output: message.content ?? message.stdout ?? "",
            status: "completed"
          })
        );
      } else if (message.subtype === "notification" || message.subtype?.startsWith("hook_")) {
        events.push(
          emit("tool.output", {
            itemId: `notice:${message.uuid}`,
            tool: message.subtype,
            output: message.message ?? message.output ?? message.stdout ?? "",
            status: message.subtype === "hook_started" ? "in_progress" : "completed"
          })
        );
      }
    } else if (message.type === "tool_progress") {
      const payload = tools.get(String(message.tool_use_id));
      events.push(
        emit("tool.output", {
          ...payload,
          itemId: String(message.tool_use_id),
          tool: message.tool_name,
          ...metadata(parent),
          elapsedSeconds: message.elapsed_time_seconds,
          taskId: message.task_id,
          status: "in_progress"
        })
      );
    } else if (message.type === "result") {
      const usage = record(message.usage);
      const normalizedUsage = {
        input_tokens:
          Number(usage.input_tokens ?? 0) +
          Number(usage.cache_creation_input_tokens ?? 0) +
          Number(usage.cache_read_input_tokens ?? 0),
        output_tokens: Number(usage.output_tokens ?? 0),
        cached_input_tokens: Number(usage.cache_read_input_tokens ?? 0)
      };
      const payload = {
        startedAt,
        firstResponseAt,
        endedAt: Date.now(),
        usage: normalizedUsage,
        cumulativeCostUsd: message.total_cost_usd,
        modelUsage: message.modelUsage,
        numTurns: message.num_turns,
        stopReason: message.stop_reason,
        permissionDenials: message.permission_denials,
        clientType: "claude-code"
      };
      if (message.is_error || message.subtype !== "success") {
        const reason = Array.isArray(message.errors) ? message.errors.join("\n") : message.result;
        events.push(
          emit("run.failed", { ...payload, message: reason || `Claude Code ${message.subtype}` })
        );
      } else {
        if (!assistantSeen && typeof message.result === "string" && message.result)
          events.push(textEvent(`result:${message.uuid}`, message.result, false, null, true));
        events.push(emit("turn.completed", payload));
      }
    }
    return events;
  };
  return { normalize, emit, activeTasks, taskTools };
}
