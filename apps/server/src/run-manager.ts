import path from "node:path";
import { nanoid } from "nanoid";
import {
  BridgeWorkerAdapter,
  resolveProviderHome,
  runtimeKey,
  terminateRecordedWorker,
  type WorkerRuntimeInfo
} from "@codex-omni/codex-runtime";
import {
  isPlaceholderSessionTitle,
  titleFromFirstMessage,
  type QueuedTurnRow,
  type RunRow,
  type RunStatus,
  type Store
} from "@codex-omni/db";
import {
  applyTextPatch,
  compactStreamEvent,
  firstUsefulFailureMessage,
  isGenericCodexExecError,
  sanitizeCodexExecError,
  truncateToolText,
  type BridgeEvent,
  type RunCommand
} from "@codex-omni/protocol";
import { captureGitCheckpoint } from "./project-git.js";
import { backfillSessionRolloutTools, rolloutToolPayload } from "./session-rollout.js";
import { mergeToolPayload } from "./tool-payload.js";
import { applyPlanMode, applyProjectRules } from "./workspace-loop.js";

type WebSocket = { readyState: number; OPEN: number; send(data: string): void };

const runtimeDefaults = {
  sandbox: "workspace-write" as const,
  approvalPolicy: "on-request" as const,
  networkAccessEnabled: true
};

type TurnStartCommand = Extract<RunCommand, { type: "turn.start" | "run.retry" }>;
type EnqueueCommand = Extract<RunCommand, { type: "turn.enqueue" }>;
type ClientEvent = {
  type: string;
  sessionId: string;
  requestId?: string;
  seq?: number;
  payload?: unknown;
};
type ActiveRun = {
  runId: string;
  sessionId: string;
  startedAt: number;
  timeout: NodeJS.Timeout;
};

const runLabels: Record<RunStatus, string> = {
  running: "任务进行中",
  completed: "任务已完成",
  failed: "任务异常中断",
  cancelled: "已手动终止",
  interrupted: "任务未完成（已中断）"
};

function failureMessageFromRunEvents(store: Store, requestId: string) {
  const messages: unknown[] = [];
  for (const event of store.listRunEvents(requestId, -1, 2000)) {
    try {
      const parsed = JSON.parse(event.eventJson) as {
        type?: string;
        payload?: Record<string, unknown>;
      };
      const payload = parsed.payload ?? {};
      if (parsed.type === "run.failed" || parsed.type === "run.reconnecting") {
        messages.push(payload.message, payload.reason);
      } else if (parsed.type === "tool.output" && payload.tool === "runtime_error") {
        messages.push(payload.error, payload.message);
      }
    } catch {
      // Ignore malformed run events when recovering a readable failure reason.
    }
  }
  return firstUsefulFailureMessage(...messages.reverse());
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function resolveFailureMessage(
  store: Store,
  requestId: string,
  incoming: unknown,
  previous?: string | null
) {
  const run = store.getRun(requestId);
  const reconnecting = parseJson<Record<string, unknown>>(run?.reconnectingJson, {});
  return sanitizeCodexExecError(
    incoming,
    firstUsefulFailureMessage(
      previous,
      reconnecting.reason,
      reconnecting.message,
      failureMessageFromRunEvents(store, requestId)
    )
  );
}


export class RunManager {
  private worker = new BridgeWorkerAdapter();
  private subscribers = new Map<string, Set<WebSocket>>();
  private cancelling = new Set<string>();
  private reconnecting = new Set<string>();
  private activeRuns = new Map<string, ActiveRun>();
  private runtimeMonitor: NodeJS.Timeout;
  readonly serviceInstanceId = nanoid();

  constructor(
    private store: Store,
    private runtimeRoot: string,
    private turnTimeoutMs = Math.max(
      60_000,
      Number(process.env.CODEX_OMNI_TURN_TIMEOUT_MS ?? 2 * 60 * 60 * 1000)
    )
  ) {
    this.runtimeMonitor = setInterval(() => this.refreshRuntimeRecords(), 3000);
    this.runtimeMonitor.unref();
  }

  reconcileStartup() {
    const running = this.store.listRunningRuns();
    for (const run of running) {
      if (run.workerPid) terminateRecordedWorker(run.workerPid, run.id);
    }
    return this.store.resetInterruptedSessions();
  }

  shutdown() {
    clearInterval(this.runtimeMonitor);
    for (const active of this.activeRuns.values()) {
      clearTimeout(active.timeout);
      this.finishRun(active.sessionId, "interrupted", { reason: "server-shutdown" });
    }
    this.worker.shutdown();
  }

  cancel(sessionId: string) {
    const active = this.activeRuns.get(sessionId);
    if (!active && !this.worker.isActive(sessionId)) return false;
    this.cancelling.add(sessionId);
    this.finishRun(sessionId, "cancelled", { reason: "manual-cancel" });
    this.worker.cancel(sessionId);
    return true;
  }

  subscribe(sessionId: string, socket: WebSocket) {
    const set = this.subscribers.get(sessionId) ?? new Set();
    set.add(socket);
    this.subscribers.set(sessionId, set);
    return () => {
      set.delete(socket);
      if (!set.size) this.subscribers.delete(sessionId);
    };
  }

  unsubscribeSocket(socket: WebSocket) {
    for (const [sessionId, set] of this.subscribers) {
      set.delete(socket);
      if (!set.size) this.subscribers.delete(sessionId);
    }
  }

  private broadcast(sessionId: string, event: ClientEvent | BridgeEvent) {
    const body = JSON.stringify({ ...event, sessionId });
    for (const socket of this.subscribers.get(sessionId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(body);
    }
  }

  private send(socket: WebSocket, event: ClientEvent) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  }

  private publicQueue(sessionId: string) {
    return this.store.listQueuedTurns(sessionId).map((item) => ({
      ...item,
      options: parseJson<Record<string, unknown>>(item.optionsJson, {})
    }));
  }

  private publicApproval(input: ReturnType<Store["getApproval"]>) {
    if (!input) return null;
    const { payloadJson, ...approval } = input;
    return { ...approval, payload: parseJson(payloadJson, undefined) };
  }

  private publicRun(run: RunRow | undefined) {
    if (!run) return null;
    return {
      ...run,
      usage: parseJson<Record<string, number> | null>(run.usageJson, null),
      reconnecting: parseJson<Record<string, unknown> | null>(run.reconnectingJson, null),
      runtimeAlive: this.worker.isActive(run.sessionId)
    };
  }

  private sendQueueSnapshot(sessionId: string) {
    this.broadcast(sessionId, {
      type: "queue.updated",
      sessionId,
      payload: { items: this.publicQueue(sessionId) }
    });
  }

  private acknowledgeQueue(sessionId: string, queueId: string, status: string) {
    this.broadcast(sessionId, {
      type: "queue.acknowledged",
      sessionId,
      payload: { queueId, status }
    });
  }

  private sendSessionSnapshot(
    sessionId: string,
    socket: WebSocket,
    cursor?: { lastRequestId?: string; lastSeq?: number }
  ) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    if (
      session.status === "running" &&
      !this.worker.isActive(sessionId) &&
      !this.activeRuns.has(sessionId)
    ) {
      this.finishRun(sessionId, "interrupted", { reason: "worker-gone" });
    }
    const latestRun = this.store.getLatestRun(sessionId);
    const runtime = this.worker.runtimeInfo(sessionId);
    const approvals = this.store
      .listPendingApprovals(sessionId)
      .map((approval) => this.publicApproval(approval));
    let replayAfter = -1;
    if (latestRun && cursor?.lastRequestId === latestRun.id && typeof cursor.lastSeq === "number") {
      replayAfter = cursor.lastSeq;
    }
    const replay = latestRun ? this.store.listRunEvents(latestRun.id, replayAfter, 1001) : [];
    const firstReplaySeq = replay[0]?.seq;
    const replayTruncated =
      replay.length > 1000 ||
      (typeof firstReplaySeq === "number" && firstReplaySeq > replayAfter + 1);
    this.send(socket, {
      type: "session.snapshot",
      sessionId,
      ...(latestRun ? { requestId: latestRun.id, seq: latestRun.lastSeq } : {}),
      payload: {
        session: this.store.getSession(sessionId),
        run: this.publicRun(latestRun),
        runtime,
        approvals,
        queue: this.publicQueue(sessionId),
        replayTruncated,
        serverTime: Date.now()
      }
    });
    if (!replayTruncated) {
      for (const item of replay) {
        if (socket.readyState !== socket.OPEN) break;
        socket.send(item.eventJson);
      }
    }
  }

  private persistRun(sessionId: string, status: RunStatus, extra: Record<string, unknown> = {}) {
    const session = this.store.getSession(sessionId);
    const active = this.activeRuns.get(sessionId);
    const run = active ? this.store.getRun(active.runId) : this.store.getLatestRun(sessionId);
    const startedAt =
      (extra.startedAt as number | undefined) ?? active?.startedAt ?? run?.startedAt ?? Date.now();
    const endedAt =
      status === "running" ? undefined : ((extra.endedAt as number | undefined) ?? Date.now());
    const firstResponseAt =
      typeof extra.firstResponseAt === "number"
        ? extra.firstResponseAt
        : (run?.firstResponseAt ?? undefined);
    const runId =
      typeof extra.runId === "string" ? extra.runId : (active?.runId ?? run?.id ?? undefined);
    const resolvedReason =
      extra.reason == null
        ? undefined
        : run?.reason &&
            isGenericCodexExecError(String(extra.reason)) &&
            !isGenericCodexExecError(run.reason)
          ? String(run.reason)
          : sanitizeCodexExecError(extra.reason, run?.reason ?? "");
    const data = {
      status,
      startedAt,
      endedAt,
      ...extra,
      ...(typeof firstResponseAt === "number" ? { firstResponseAt } : {}),
      ...(runId ? { runId } : {}),
      ...(resolvedReason ? { reason: resolvedReason } : {})
    };
    this.store.upsertEventMessage({
      sessionId,
      role: "run",
      content: runLabels[status],
      providerId: session?.providerId ?? null,
      eventType: status === "completed" ? "turn.completed" : `run.${status}`,
      itemId: `${sessionId}:current-run`,
      dataJson: JSON.stringify(data)
    });
    if (run) {
      this.store.updateRun(run.id, {
        status,
        ...(typeof endedAt === "number" ? { endedAt } : {}),
        ...(typeof extra.firstResponseAt === "number"
          ? { firstResponseAt: extra.firstResponseAt }
          : {}),
        ...(extra.usage ? { usageJson: JSON.stringify(extra.usage) } : {}),
        ...(resolvedReason ? { reason: resolvedReason } : {}),
        reconnectingJson: extra.reconnecting ? JSON.stringify(extra.reconnecting) : null
      });
    }
    return data;
  }

  private finishRun(
    sessionId: string,
    status: Exclude<RunStatus, "running">,
    extra: Record<string, unknown> = {},
    broadcast = true
  ) {
    if (status === "cancelled") this.cancelling.add(sessionId);
    const active = this.activeRuns.get(sessionId);
    if (active) clearTimeout(active.timeout);
    const data = this.persistRun(sessionId, status, extra);
    this.store.updateSession(sessionId, { status: status === "completed" ? "idle" : status });
    this.store.resolvePendingApprovals(sessionId, status === "cancelled" ? "cancelled" : "expired");
    if (broadcast) {
      this.broadcast(sessionId, {
        type: status === "completed" ? "turn.completed" : `run.${status}`,
        sessionId,
        ...(active ? { requestId: active.runId } : {}),
        payload: data
      });
    }
    this.reconnecting.delete(sessionId);
    this.activeRuns.delete(sessionId);
  }

  private persistEvent(sessionId: string, providerId: string, event: BridgeEvent) {
    if (this.cancelling.has(sessionId) && event.type === "run.failed") return;
    const compact = compactStreamEvent(event);
    this.store.appendRunEvent(compact.requestId, sessionId, compact.seq, JSON.stringify(compact));
    const payload = (compact.payload ?? {}) as Record<string, any>;
    const itemId = payload.itemId as string | undefined;
    const persistentItemId = itemId ? `${compact.requestId}:${itemId}` : undefined;
    const existing = persistentItemId
      ? this.store.getMessageByItemId(sessionId, persistentItemId)
      : undefined;
    if (compact.type === "assistant.delta" || compact.type === "assistant.completed") {
      if (persistentItemId) {
        this.store.upsertEventMessage({
          sessionId,
          role: "assistant",
          content: applyTextPatch(existing?.content ?? "", payload),
          providerId,
          eventType: compact.type,
          itemId: persistentItemId,
          dataJson: JSON.stringify(payload)
        });
      }
      return;
    }
    if (compact.type === "approval.requested") {
      const approvalId = String(payload.approvalId ?? "");
      if (!approvalId) return;
      this.store.upsertApproval({
        id: approvalId,
        runId: event.requestId,
        sessionId,
        itemId: itemId ?? null,
        tool: String(payload.tool ?? "command"),
        command: String(payload.command ?? ""),
        payloadJson: JSON.stringify(payload)
      });
      this.store.upsertEventMessage({
        sessionId,
        role: "approval",
        content: String(payload.command ?? ""),
        providerId,
        eventType: event.type,
        itemId: `approval:${approvalId}`,
        dataJson: JSON.stringify({ ...payload, status: "pending" })
      });
      return;
    }
    const role =
      compact.type === "reasoning.delta"
        ? "reasoning"
        : compact.type === "tool.started" || compact.type === "tool.output"
          ? "tool"
          : compact.type === "file.change"
            ? "file"
            : compact.type === "run.failed"
              ? "error"
              : compact.type === "turn.completed"
                ? "run"
                : null;
    if (!role) return;
    const active = this.activeRuns.get(sessionId);
    let data: Record<string, any> =
      compact.type === "turn.completed" || compact.type === "run.failed"
        ? {
            ...payload,
            usage: payload.usage,
            startedAt: active?.startedAt,
            runId: compact.requestId
          }
        : payload;
    if (compact.type === "tool.started" || compact.type === "tool.output") {
      let existingData: unknown = {};
      try {
        existingData = existing?.dataJson ? JSON.parse(existing.dataJson) : {};
      } catch {
        existingData = {};
      }
      data = mergeToolPayload(existingData, data);
    }
    const folded =
      compact.type === "reasoning.delta"
        ? applyTextPatch(existing?.content ?? "", payload)
        : compact.type === "tool.started" || compact.type === "tool.output"
          ? applyTextPatch(existing?.content ?? "", {
              text: payload.output,
              delta: payload.outputDelta
            })
          : (payload.text ?? payload.output ?? payload.message ?? "");
    const truncated =
      compact.type === "tool.started" || compact.type === "tool.output"
        ? truncateToolText(String(folded ?? ""))
        : { text: String(folded ?? ""), truncated: false };
    this.store.upsertEventMessage({
      sessionId,
      role,
      content: truncated.text,
      providerId,
      eventType: compact.type,
      itemId: persistentItemId ?? `${compact.requestId}:${compact.type}`,
      dataJson: JSON.stringify({
        ...data,
        ...(compact.type === "tool.started" || compact.type === "tool.output"
          ? { output: truncated.text, ...(truncated.truncated ? { truncated: true } : {}) }
          : {}),
        outputDelta: undefined
      })
    });
  }

  private updateRuntime(runId: string, runtime: WorkerRuntimeInfo) {
    const run = this.store.getRun(runId);
    if (!run) return;
    this.store.updateRun(runId, {
      workerPid: runtime.workerPid,
      codexPid: runtime.codexPid,
      workerStartedAt: runtime.startedAt,
      heartbeatAt: Date.now()
    });
  }

  private refreshRuntimeRecords() {
    for (const active of this.activeRuns.values()) {
      const runtime = this.worker.runtimeInfo(active.sessionId);
      if (runtime?.alive) this.updateRuntime(active.runId, runtime);
    }
  }

  enqueueTurn(command: EnqueueCommand) {
    return this.queueCommand(command);
  }

  private queueCommand(command: EnqueueCommand) {
    const session = this.store.getSession(command.sessionId);
    const project = this.store.getProject(command.projectId);
    if (!session || !project || session.projectId !== project.id)
      throw new Error("Session/project mismatch");
    const existingRun = command.clientId
      ? this.store.getRunBySourceQueueId(command.clientId)
      : undefined;
    if (existingRun) {
      if (existingRun.sessionId !== command.sessionId)
        throw new Error("Queued turn id already belongs to another session");
      this.store.deleteQueuedTurn(command.clientId!);
      this.acknowledgeQueue(command.sessionId, command.clientId!, existingRun.status);
      this.sendQueueSnapshot(command.sessionId);
      return existingRun;
    }
    const queued = this.store.enqueueTurn({
      ...(command.clientId ? { id: command.clientId } : {}),
      sessionId: command.sessionId,
      projectId: command.projectId,
      providerId: command.providerId ?? session.providerId,
      message: command.message,
      optionsJson: JSON.stringify({
        ...(command.model ? { model: command.model } : {}),
        ...(command.sandbox ? { sandbox: command.sandbox } : {}),
        ...(command.approvalPolicy ? { approvalPolicy: command.approvalPolicy } : {}),
        ...(typeof command.networkAccessEnabled === "boolean"
          ? { networkAccessEnabled: command.networkAccessEnabled }
          : {}),
        ...(command.mode ? { mode: command.mode } : {}),
        ...(command.displayMessage ? { displayMessage: command.displayMessage } : {}),
        ...(command.attachments?.length ? { attachments: command.attachments } : {})
      })
    });
    this.acknowledgeQueue(command.sessionId, queued.id, "queued");
    this.sendQueueSnapshot(command.sessionId);
    if (!this.activeRuns.has(command.sessionId) && !this.worker.isActive(command.sessionId)) {
      void this.startNextQueued(command.sessionId);
    }
    return queued;
  }

  private queuedToCommand(item: QueuedTurnRow): TurnStartCommand {
    const options = parseJson<Record<string, any>>(item.optionsJson, {});
    return {
      type: "turn.start",
      projectId: item.projectId,
      sessionId: item.sessionId,
      message: item.message,
      ...(item.providerId ? { providerId: item.providerId } : {}),
      ...(options.model ? { model: String(options.model) } : {}),
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(typeof options.networkAccessEnabled === "boolean"
        ? { networkAccessEnabled: options.networkAccessEnabled }
        : {}),
      ...(options.mode === "plan" || options.mode === "execute" ? { mode: options.mode } : {})
    };
  }

  private async startNextQueued(sessionId: string) {
    if (this.activeRuns.has(sessionId) || this.worker.isActive(sessionId)) return;
    const item = this.store.listQueuedTurns(sessionId)[0];
    if (!item) return;
    try {
      await this.startTurn(this.queuedToCommand(item), item.id);
    } catch (error) {
      this.broadcast(sessionId, {
        type: "server.error",
        sessionId,
        payload: { message: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  private async startTurn(command: TurnStartCommand, sourceQueueId?: string) {
    const session = this.store.getSession(command.sessionId);
    const project = this.store.getProject(command.projectId);
    if (!session || !project || session.projectId !== project.id)
      throw new Error("Session/project mismatch");
    if (this.worker.isActive(session.id) || this.activeRuns.has(session.id))
      throw new Error("Session already has an active turn");
    if (session.status === "running") {
      this.finishRun(session.id, "interrupted", { reason: "worker-gone" });
    }
    const requestedProvider = command.providerId ?? session.providerId ?? project.providerId;
    if (!requestedProvider) throw new Error("Select a provider first");
    if (session.providerId && session.providerId !== requestedProvider) {
      const hasStarted = Boolean(session.threadId) || this.store.hasMessageRole(session.id, "user");
      if (hasStarted) throw new Error("provider-continuation-required");
    }
    const provider = this.store.getProvider(requestedProvider);
    if (!provider) throw new Error("Provider not found");
    const portableContext = !session.threadId
      ? this.store.findMessageByEventType(session.id, "provider.continuation")?.content
      : null;
    const planMode = command.type === "turn.start" && command.mode === "plan";
    const userMessageText = planMode ? applyPlanMode(command.message) : command.message;
    const projectRules = applyProjectRules(
      "",
      (this.store.listProjectNotes?.(project.id) ?? [])
        .filter((note) => note.enabled)
        .map((note) => ({ title: note.title, content: note.content }))
    );
    const runtimeBody = projectRules ? `${projectRules}\n\n${userMessageText}` : userMessageText;
    const runtimeMessage = portableContext
      ? `${portableContext}\n\nContinue from that context and answer this new user request:\n\n${runtimeBody}`
      : runtimeBody;
    const settings = this.store.getSettings(runtimeDefaults);
    this.cancelling.delete(session.id);
    this.reconnecting.delete(session.id);
    const startedAt = Date.now();
    const requestId = nanoid();
    const timeout = setTimeout(() => {
      const current = this.activeRuns.get(session.id);
      if (current?.runId !== requestId) return;
      this.finishRun(session.id, "failed", { reason: "turn-timeout", startedAt });
      this.worker.cancel(session.id);
    }, this.turnTimeoutMs);
    timeout.unref();
    this.activeRuns.set(session.id, {
      runId: requestId,
      sessionId: session.id,
      startedAt,
      timeout
    });
    const selectedModel =
      command.type === "turn.start" ? (command.model ?? provider.model) : provider.model;
    this.store.createRun({
      id: requestId,
      sessionId: session.id,
      projectId: project.id,
      providerId: provider.id,
      serviceInstanceId: this.serviceInstanceId,
      model: selectedModel,
      cwd: project.realPath,
      startedAt,
      ...(sourceQueueId ? { sourceQueueId } : {})
    });
    void this.captureTurnCheckpoint(session.id, project.id, project.realPath, requestId, planMode);
    if (sourceQueueId) {
      this.store.deleteQueuedTurn(sourceQueueId);
      this.acknowledgeQueue(session.id, sourceQueueId, "running");
      this.sendQueueSnapshot(session.id);
    }
    this.store.updateSession(session.id, { status: "running", providerId: provider.id });
    this.persistRun(session.id, "running", { startedAt });
    const initialEvent: BridgeEvent = {
      protocolVersion: 1,
      requestId,
      projectId: project.id,
      sessionId: session.id,
      seq: 0,
      type: "run.started",
      payload: { status: "running", startedAt }
    };
    this.persistEvent(session.id, provider.id, initialEvent);
    this.broadcast(session.id, initialEvent);
    const isFirstUserMessage = !this.store.hasMessageRole(session.id, "user");
    const userMessage = this.store.addMessage({
      sessionId: session.id,
      role: "user",
      content: userMessageText,
      providerId: provider.id,
      eventType: "user.message"
    });
    this.broadcast(session.id, {
      type: "user.message",
      sessionId: session.id,
      requestId,
      payload: {
        id: userMessage.id,
        message: userMessage.content,
        providerId: userMessage.providerId,
        createdAt: userMessage.createdAt
      }
    });
    if (isFirstUserMessage && isPlaceholderSessionTitle(session.title)) {
      this.store.updateSession(session.id, { title: titleFromFirstMessage(command.message) });
    }
    let completed = false;
    const onRuntimeEvent = (rawEvent: BridgeEvent) => {
      const event: BridgeEvent = compactStreamEvent({
        ...rawEvent,
        requestId,
        projectId: project.id,
        sessionId: session.id
      });
      const payload = (event.payload ?? {}) as Record<string, any>;
      if (event.type === "run.failed") {
        const incoming = String(payload.message ?? payload.reason ?? "");
        const previous = this.store.getMessageByItemId(session.id, `${requestId}:run.failed`);
        if (
          previous?.content &&
          isGenericCodexExecError(incoming) &&
          !isGenericCodexExecError(previous.content)
        ) {
          return;
        }
        const sanitized = resolveFailureMessage(
          this.store,
          requestId,
          incoming,
          previous?.content
        );
        if (sanitized && sanitized !== incoming) payload.message = sanitized;
      }
      const terminalEvent = event.type === "turn.completed" || event.type === "run.failed";
      if (event.type === "run.reconnecting") {
        this.reconnecting.add(session.id);
        this.persistRun(session.id, "running", { startedAt, reconnecting: payload });
      } else if (this.reconnecting.delete(session.id) && !terminalEvent) {
        this.persistRun(session.id, "running", { startedAt });
      }
      if (
        [
          "reasoning.delta",
          "assistant.delta",
          "assistant.completed",
          "tool.started",
          "tool.output",
          "file.change",
          "approval.requested"
        ].includes(event.type)
      ) {
        const run = this.store.getRun(requestId);
        if (run && !run.firstResponseAt) {
          const observedFirstResponseAt =
            typeof payload.firstResponseAt === "number" ? payload.firstResponseAt : Date.now();
          this.store.updateRun(requestId, { firstResponseAt: observedFirstResponseAt });
          this.persistRun(session.id, "running", {
            startedAt,
            firstResponseAt: observedFirstResponseAt
          });
        }
      }
      this.persistEvent(session.id, provider.id, event);
      this.broadcast(session.id, event);
      if (event.type === "thread.started") {
        const threadId = String(payload.threadId ?? "");
        if (threadId) {
          this.store.updateSession(session.id, { threadId });
          this.store.updateRun(requestId, { threadId });
        }
      }
      if (event.type === "turn.completed") {
        completed = true;
        this.finishRun(
          session.id,
          "completed",
          {
            startedAt,
            firstResponseAt: payload.firstResponseAt,
            endedAt: typeof payload.endedAt === "number" ? payload.endedAt : Date.now(),
            usage: payload.usage
          },
          false
        );
      } else if (event.type === "run.failed") {
        this.finishRun(
          session.id,
          "failed",
          {
            startedAt,
            firstResponseAt: payload.firstResponseAt,
            endedAt: typeof payload.endedAt === "number" ? payload.endedAt : Date.now(),
            ...(payload.message || payload.reason
              ? { reason: String(payload.message ?? payload.reason) }
              : {})
          },
          false
        );
      }
    };
    try {
      if (process.env.CODEX_OMNI_FAKE_RUNTIME === "1") {
        await this.runFakeTurn({
          requestId,
          projectId: project.id,
          sessionId: session.id,
          message: command.message,
          onEvent: onRuntimeEvent
        });
      } else {
        const codexHome = await resolveProviderHome({
          providersRoot: path.join(this.runtimeRoot, "providers"),
          providerId: provider.id,
          homeMode: provider.homeMode,
          codexHomePath: provider.codexHomePath,
          configToml: provider.configToml,
          authJson: provider.authJson
        });
        await this.worker.run(
          {
            protocolVersion: 1,
            requestId,
            projectId: project.id,
            sessionId: session.id,
            ...(session.threadId ? { threadId: session.threadId } : {}),
            cwd: project.realPath,
            runtimeKey: runtimeKey(project.id, provider.id),
            codexHome,
            message: runtimeMessage,
            ...(selectedModel ? { model: selectedModel } : {}),
            ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
            ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
            ...(provider.configToml ? { configToml: provider.configToml } : {}),
            ...(provider.authJson ? { authJson: provider.authJson } : {}),
            ...(provider.envJson ? { messageEnvVars: JSON.parse(provider.envJson) } : {}),
            sandbox: planMode
              ? "read-only"
              : command.type === "turn.start"
                ? (command.sandbox ?? settings.sandbox)
                : "workspace-write",
            approvalPolicy:
              command.type === "turn.start"
                ? (command.approvalPolicy ?? settings.approvalPolicy)
                : "never",
            networkAccessEnabled:
              command.type === "turn.start"
                ? (command.networkAccessEnabled ?? settings.networkAccessEnabled)
                : settings.networkAccessEnabled
          },
          onRuntimeEvent,
          (runtime) => this.updateRuntime(requestId, runtime)
        );
        const latest = this.store.getSession(session.id);
        this.publishRolloutBackfill({
          sessionId: session.id,
          projectId: project.id,
          providerId: provider.id,
          threadId: latest?.threadId ?? session.threadId,
          codexHome
        });
      }
      const current = this.store.getSession(session.id);
      if (current?.status === "running") {
        completed = true;
        this.finishRun(session.id, "completed", { startedAt });
      }
    } catch (error) {
      const current = this.store.getSession(session.id);
      if (current?.status === "running") {
        const incoming = error instanceof Error ? error.message : String(error);
        const previous = this.store.getMessageByItemId(session.id, `${requestId}:run.failed`);
        const reason = resolveFailureMessage(
          this.store,
          requestId,
          incoming,
          previous?.content
        );
        if (!previous?.content || isGenericCodexExecError(previous.content)) {
          this.store.upsertEventMessage({
            sessionId: session.id,
            role: "error",
            content: reason,
            providerId: provider.id,
            eventType: "run.failed",
            itemId: `${requestId}:run.failed`,
            dataJson: JSON.stringify({
              message: reason,
              status: "failed",
              startedAt,
              runId: requestId
            })
          });
        }
        this.finishRun(session.id, "failed", { startedAt, reason });
      }
    } finally {
      clearTimeout(timeout);
      this.cancelling.delete(session.id);
      if (completed) void this.startNextQueued(session.id);
    }
  }

  private async runFakeTurn(input: {
    requestId: string;
    projectId: string;
    sessionId: string;
    message: string;
    onEvent: (event: BridgeEvent) => void;
  }) {
    const itemId = "fake-assistant";
    const full = `已收到：${input.message}`;
    const parts = full.match(/.{1,12}/g) ?? [full];
    let text = "";
    let seq = 1;
    const emit = (type: BridgeEvent["type"], payload: Record<string, unknown>) => {
      input.onEvent({
        protocolVersion: 1,
        requestId: input.requestId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        seq: seq++,
        type,
        payload
      });
    };
    for (const part of parts) {
      if (this.cancelling.has(input.sessionId)) return;
      text += part;
      emit("assistant.delta", { itemId, delta: part });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    if (this.cancelling.has(input.sessionId)) return;
    emit("assistant.completed", { itemId, text });
    emit("file.change", {
      itemId: "fake-file",
      changes: [
        {
          path: "README.md",
          kind: "add",
          diff: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -0,0 +1,2 @@\n+hello\n+world\n"
        }
      ]
    });
    emit("turn.completed", { endedAt: Date.now() });
  }

  private publishRolloutBackfill(input: {
    sessionId: string;
    projectId: string;
    providerId: string;
    threadId: string | null | undefined;
    codexHome: string;
  }) {
    try {
      const changes = backfillSessionRolloutTools({
        store: this.store,
        sessionId: input.sessionId,
        threadId: input.threadId,
        providerId: input.providerId,
        codexHome: input.codexHome
      });
      for (const change of changes) {
        const separator = change.itemId.indexOf(":");
        if (separator <= 0) continue;
        this.broadcast(input.sessionId, {
          protocolVersion: 1,
          requestId: change.itemId.slice(0, separator),
          projectId: input.projectId,
          sessionId: input.sessionId,
          seq: 0,
          type: "tool.output",
          payload: {
            ...rolloutToolPayload(change.event),
            itemId: change.itemId.slice(separator + 1)
          }
        });
      }
    } catch {
      // Rollout recovery is best-effort and must not fail the turn.
    }
  }

  private async captureTurnCheckpoint(
    sessionId: string,
    projectId: string,
    rootPath: string,
    runId: string,
    planMode: boolean
  ) {
    try {
      const snapshot = await captureGitCheckpoint(rootPath);
      this.store.addCheckpoint({
        sessionId,
        projectId,
        runId,
        title: planMode ? "计划前检查点" : "执行前检查点",
        gitHead: snapshot.head,
        gitBranch: snapshot.branch,
        gitStatus: snapshot.status,
        patch: snapshot.patch,
        filesJson: JSON.stringify(snapshot.files)
      });
    } catch {
      // Checkpoint capture is best-effort and must not fail the turn.
    }
  }

  async handle(command: RunCommand, socket: WebSocket) {
    if (command.type === "turn.cancel") {
      this.cancel(command.sessionId);
      return;
    }
    if (command.type === "session.subscribe") {
      this.subscribe(command.sessionId, socket);
      this.sendSessionSnapshot(command.sessionId, socket, {
        ...(command.lastRequestId ? { lastRequestId: command.lastRequestId } : {}),
        ...(typeof command.lastSeq === "number" ? { lastSeq: command.lastSeq } : {})
      });
      return;
    }
    if (
      command.type === "turn.start" ||
      command.type === "turn.enqueue" ||
      command.type === "run.retry"
    ) {
      this.subscribe(command.sessionId, socket);
    }
    if (command.type === "approval.respond") {
      const approval = this.store.getApproval(command.requestId);
      if (!approval || approval.sessionId !== command.sessionId || approval.status !== "pending")
        throw new Error("Approval request is no longer active");
      if (!this.worker.respond(command.sessionId, command.requestId, command.decision))
        throw new Error("Approval request is no longer active");
      const status =
        command.decision === "decline"
          ? "declined"
          : command.decision === "cancel"
            ? "cancelled"
            : "accepted";
      const resolved = this.store.resolveApproval(command.requestId, status, command.decision);
      const session = this.store.getSession(command.sessionId);
      const payload = {
        ...parseJson<Record<string, unknown>>(approval.payloadJson, {}),
        approvalId: approval.id,
        status,
        decision: command.decision,
        resolvedAt: resolved?.resolvedAt
      };
      this.store.upsertEventMessage({
        sessionId: command.sessionId,
        role: "approval",
        content: approval.command,
        providerId: session?.providerId ?? null,
        eventType: "approval.resolved",
        itemId: `approval:${approval.id}`,
        dataJson: JSON.stringify(payload)
      });
      this.broadcast(command.sessionId, {
        type: "approval.resolved",
        sessionId: command.sessionId,
        requestId: approval.runId,
        payload
      });
      return;
    }
    if (command.type === "turn.enqueue") {
      this.queueCommand(command);
      return;
    }
    if (command.type === "queue.remove") {
      const item = this.store.getQueuedTurn(command.queueId);
      if (item && item.sessionId !== command.sessionId) throw new Error("Queued turn not found");
      if (item) this.store.deleteQueuedTurn(command.queueId);
      const existingRun = this.store.getRunBySourceQueueId(command.queueId);
      this.acknowledgeQueue(
        command.sessionId,
        command.queueId,
        existingRun?.sessionId === command.sessionId ? existingRun.status : "removed"
      );
      this.sendQueueSnapshot(command.sessionId);
      return;
    }
    if (command.type === "queue.update") {
      const item = this.store.getQueuedTurn(command.queueId);
      if (!item || item.sessionId !== command.sessionId) throw new Error("Queued turn not found");
      const options = parseJson<Record<string, unknown>>(item.optionsJson, {});
      if (command.displayMessage) options.displayMessage = command.displayMessage;
      this.store.updateQueuedTurn(command.queueId, command.message, JSON.stringify(options));
      this.sendQueueSnapshot(command.sessionId);
      return;
    }
    if (command.type === "queue.move") {
      const item = this.store.getQueuedTurn(command.queueId);
      if (!item || item.sessionId !== command.sessionId) throw new Error("Queued turn not found");
      this.store.moveQueuedTurn(command.sessionId, command.queueId, command.direction);
      this.sendQueueSnapshot(command.sessionId);
      return;
    }
    if (command.type === "queue.start-next") {
      void this.startNextQueued(command.sessionId);
      return;
    }
    await this.startTurn(command);
  }

  listActiveRuns() {
    return this.store.listRunningRuns().map((run) => {
      const session = this.store.getSession(run.sessionId);
      const project = this.store.getProject(run.projectId);
      const provider = run.providerId ? this.store.getProvider(run.providerId) : null;
      const runtime = this.worker.runtimeInfo(run.sessionId);
      return {
        id: run.id,
        sessionId: run.sessionId,
        sessionTitle: session?.title ?? run.sessionId,
        projectId: run.projectId,
        projectName: project?.name ?? run.projectId,
        providerId: run.providerId,
        providerName: provider?.name ?? null,
        threadId: run.threadId,
        status: run.status,
        model: run.model,
        cwd: run.cwd,
        workerPid: runtime?.workerPid ?? run.workerPid,
        codexPid: runtime?.codexPid ?? run.codexPid,
        serviceInstanceId: run.serviceInstanceId,
        startedAt: run.startedAt,
        firstResponseAt: run.firstResponseAt,
        lastEventAt: run.lastEventAt,
        heartbeatAt: run.heartbeatAt,
        lastSeq: run.lastSeq,
        subscriberCount: this.subscribers.get(run.sessionId)?.size ?? 0,
        runtimeAlive: Boolean(runtime?.alive),
        reconnecting: parseJson<Record<string, unknown> | null>(run.reconnectingJson, null)
      };
    });
  }
}
