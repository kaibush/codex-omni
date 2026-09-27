import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isPathInsideRoot } from "@codex-omni/agent-runtime";
import { query, type CanUseTool, type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import type {
  ApprovalResponse,
  BridgeEvent,
  BridgeRequest,
  TurnAttachment
} from "@codex-omni/protocol";
import { claudeQueryOptions, parseClaudeSettings } from "./configuration.js";
import { claudeInput, PromptQueue } from "./input.js";
import { createClaudeNormalizer } from "./normalizer.js";

export class ClaudeTurn {
  private abortController = new AbortController();
  private prompts = new PromptQueue();
  private approvals = new Map<string, (response: ApprovalResponse) => void>();
  private normalizer: ReturnType<typeof createClaudeNormalizer>;
  private query: Query | undefined;
  private pendingPrompts = new Set<string>();
  private acceptingInput = true;
  private planFiles = new Set<string>();
  private latestAssistantText = "";
  private releaseTimer: NodeJS.Timeout | undefined;

  constructor(
    private request: BridgeRequest,
    private onEvent: (event: BridgeEvent) => void,
    private createQuery: typeof query = query
  ) {
    this.normalizer = createClaudeNormalizer(request);
  }

  respond(id: string, response: ApprovalResponse) {
    const resolve = this.approvals.get(id);
    if (!resolve) return false;
    this.approvals.delete(id);
    resolve(response);
    return true;
  }

  private async planForReview(input: Record<string, unknown>) {
    if (typeof input.plan === "string" && input.plan.trim()) return { plan: input.plan };
    const configured = (
      parseClaudeSettings(this.request.settingsJson) as { plansDirectory?: string }
    ).plansDirectory;
    const roots = [
      path.join(this.request.runtimeHome ?? this.request.codexHome, "plans"),
      path.join(this.request.cwd, ".claude", "plans")
    ];
    if (typeof configured === "string") roots.push(path.resolve(this.request.cwd, configured));
    for (const file of [...this.planFiles].reverse()) {
      if (!roots.some((root) => isPathInsideRoot(root, file))) continue;
      try {
        const resolved = await realpath(file);
        const allowed = await Promise.all(
          roots
            .map(async (root) => isPathInsideRoot(await realpath(root), resolved))
            .map((check) => check.catch(() => false))
        );
        if (!allowed.some(Boolean) || (await stat(resolved)).size > 256_000) continue;
        return { plan: await readFile(resolved, "utf8"), planPath: resolved };
      } catch {
        /* A deleted plan can still be reviewed from the assistant text. */
      }
    }
    return this.latestAssistantText ? { plan: this.latestAssistantText } : {};
  }

  private async ask(
    tool: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    extra: Record<string, unknown> = {}
  ): Promise<ApprovalResponse> {
    const plan = tool === "ExitPlanMode" ? await this.planForReview(input) : {};
    if (signal.aborted || this.abortController.signal.aborted)
      return Promise.resolve({ decision: "cancel" });
    const approvalId = randomUUID();
    const kind =
      tool === "AskUserQuestion"
        ? "question"
        : tool === "ExitPlanMode"
          ? "plan"
          : tool === "mcp_elicitation"
            ? "elicitation"
            : "permission";
    return new Promise((resolve) => {
      const cancel = () => finish({ decision: "cancel" });
      const finish = (response: ApprovalResponse) => {
        signal.removeEventListener("abort", cancel);
        this.abortController.signal.removeEventListener("abort", cancel);
        this.approvals.delete(approvalId);
        resolve(response);
      };
      this.approvals.set(approvalId, finish);
      signal.addEventListener("abort", cancel, { once: true });
      this.abortController.signal.addEventListener("abort", cancel, { once: true });
      this.onEvent(
        this.normalizer.emit("approval.requested", {
          approvalId,
          tool,
          kind,
          input,
          questions: input.questions,
          plan: input.plan,
          command: String(
            input.command ??
              input.file_path ??
              input.message ??
              (kind === "question"
                ? "Claude Code 需要你回答问题"
                : kind === "plan"
                  ? "确认计划并开始执行"
                  : tool)
          ),
          clientType: "claude-code",
          ...extra,
          ...plan
        })
      );
    });
  }

  private canUseTool: CanUseTool = async (tool, input, context) => {
    const response = await this.ask(tool, input, context.signal, {
      itemId: context.toolUseID,
      parentToolUseId: context.agentID,
      title: context.title,
      description: context.description,
      suppressAlwaysAllow: context.suppressAlwaysAllowRule || !context.suggestions?.length
    });
    if (response.decision === "decline" || response.decision === "cancel")
      return {
        behavior: "deny",
        message: "用户未批准此操作",
        interrupt: response.decision === "cancel"
      };
    return {
      behavior: "allow",
      updatedInput: {
        ...input,
        ...response.updatedInput,
        ...(response.answers ? { answers: response.answers } : {})
      },
      ...(response.decision === "acceptForSession" &&
      !context.suppressAlwaysAllowRule &&
      context.suggestions?.length
        ? {
            updatedPermissions: context.suggestions.map((suggestion) => ({
              ...suggestion,
              destination: "session" as const
            }))
          }
        : {})
    };
  };

  async steer(message: string, attachments?: TurnAttachment[]) {
    if (!this.acceptingInput) return false;
    const input = await claudeInput(message, this.request.cwd, attachments);
    if (!this.acceptingInput) return false;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.pendingPrompts.add(input.uuid!);
    this.prompts.push(input);
    return true;
  }

  async stopTask(taskId: string) {
    if (!this.normalizer.activeTasks.has(taskId)) throw new Error("子任务已结束或不存在");
    await this.query?.stopTask(taskId);
  }

  cancel() {
    this.acceptingInput = false;
    this.abortController.abort();
    this.prompts.close();
  }

  fail(error: unknown) {
    this.onEvent(
      this.normalizer.emit("run.failed", {
        message: error instanceof Error ? error.message : String(error),
        clientType: "claude-code"
      })
    );
  }

  async run() {
    const options: Options = {
      ...claudeQueryOptions(this.request),
      abortController: this.abortController,
      canUseTool: this.canUseTool,
      hooks: {
        PreToolUse: [
          {
            matcher: "AskUserQuestion|ExitPlanMode",
            hooks: [
              async (hook, _id, context) => {
                if (hook.hook_event_name !== "PreToolUse") return {};
                const input = hook.tool_input as Record<string, unknown>;
                const response = await this.ask(hook.tool_name, input, context.signal, {
                  itemId: hook.tool_use_id,
                  suppressAlwaysAllow: true
                });
                const allowed =
                  response.decision === "accept" || response.decision === "acceptForSession";
                // PreToolUse runs even in bypass mode; interactive tools always reach
                // the human and never silently manufacture an answer.
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    permissionDecision: allowed ? ("allow" as const) : ("deny" as const),
                    permissionDecisionReason: allowed
                      ? "用户已确认"
                      : hook.tool_name === "AskUserQuestion"
                        ? "用户跳过了这个问题，不要代替用户回答。"
                        : `用户未批准，请调整计划。${typeof response.updatedInput?.feedback === "string" ? response.updatedInput.feedback : ""}`,
                    updatedInput: {
                      ...input,
                      ...response.updatedInput,
                      ...(response.answers ? { answers: response.answers } : {})
                    }
                  }
                };
              }
            ]
          }
        ]
      },
      onElicitation: async (elicitation, context) => {
        const response = await this.ask(
          "mcp_elicitation",
          elicitation as unknown as Record<string, unknown>,
          context.signal,
          { suppressAlwaysAllow: true }
        );
        if (response.decision === "accept" || response.decision === "acceptForSession") {
          const content: Record<string, string | number | boolean | string[]> = {};
          for (const [key, value] of Object.entries(
            response.updatedInput ?? response.answers ?? {}
          )) {
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean" ||
              (Array.isArray(value) &&
                value.every((entry): entry is string => typeof entry === "string"))
            )
              content[key] = value;
            else return { action: "decline" };
          }
          return { action: "accept", content };
        }
        return { action: response.decision === "cancel" ? "cancel" : "decline" };
      },
      stderr: (data) => process.stderr.write(data)
    };
    let completed: BridgeEvent | undefined;
    let failed = false;
    const release = () => {
      this.acceptingInput = false;
      this.prompts.close();
    };
    const maybeRelease = () => {
      if (this.releaseTimer) clearTimeout(this.releaseTimer);
      if (completed && !this.pendingPrompts.size && !this.normalizer.activeTasks.size) {
        this.releaseTimer = setTimeout(release, 500);
      }
    };
    try {
      if (this.request.conversationContext) {
        const context = await claudeInput(this.request.conversationContext, this.request.cwd);
        this.prompts.push({
          ...context,
          isSynthetic: true,
          client_composed: true,
          shouldQuery: false
        });
      }
      await this.steer(this.request.message, this.request.attachments);
      this.query = this.createQuery({ prompt: this.prompts, options });
      for await (const message of this.query) {
        if (message.type === "assistant" || message.type === "stream_event") {
          if (this.releaseTimer) clearTimeout(this.releaseTimer);
        }
        for (const event of this.normalizer.normalize(message)) {
          const payload = event.payload as Record<string, unknown>;
          if (event.type === "assistant.completed" && typeof payload.text === "string")
            this.latestAssistantText = payload.text;
          if (
            !payload.parentToolUseId &&
            typeof payload.path === "string" &&
            ["Read", "Write", "Edit", "MultiEdit"].includes(String(payload.tool))
          ) {
            this.planFiles.delete(payload.path);
            this.planFiles.add(path.resolve(this.request.cwd, payload.path));
          }
          if (event.type === "turn.completed") completed = event;
          else {
            this.onEvent(event);
            if (event.type === "run.failed") failed = true;
          }
        }
        if (message.type === "result") {
          const ids =
            message.user_message_uuids ??
            (message.user_message_uuid ? [message.user_message_uuid] : []);
          if (ids.length) for (const id of ids) this.pendingPrompts.delete(id);
          else if (!message.queued_turn_count) this.pendingPrompts.clear();
        }
        if (failed) {
          release();
          break;
        }
        if (
          message.type === "result" ||
          (message.type === "system" &&
            ["task_notification", "task_updated"].includes(message.subtype))
        )
          maybeRelease();
      }
      if (!failed && !this.abortController.signal.aborted) {
        if (!completed) throw new Error("Claude Code 事件流在返回结果前结束");
        this.onEvent(this.normalizer.emit("turn.completed", completed.payload));
      }
    } finally {
      if (this.releaseTimer) clearTimeout(this.releaseTimer);
      this.cancel();
      this.query?.close();
    }
  }
}
