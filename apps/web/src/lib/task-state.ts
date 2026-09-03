import { parseReconnectNotice, type ReconnectNotice } from "@codex-omni/protocol";

export type TaskStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type TaskState = {
  startedAt: number;
  firstResponseAt?: number;
  endedAt?: number;
  usage?: Record<string, number>;
  status: TaskStatus;
  reason?: string;
  reconnecting?: ReconnectNotice;
  runId?: string;
};

const RUN_EVENTS = new Set([
  "run.started",
  "run.running",
  "run.reconnecting",
  "run.completed",
  "turn.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted"
]);

const parseData = (value?: string | null) => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return undefined;
  }
};

export function taskStatusLabel(status: TaskStatus) {
  if (status === "running") return "任务进行中";
  if (status === "completed") return "任务已完成";
  if (status === "cancelled") return "已手动终止";
  if (status === "interrupted") return "任务未完成（已中断）";
  return "任务异常中断";
}

export function statusFromRunEvent(eventType?: string | null, payloadStatus?: string) {
  if (payloadStatus === "running" || eventType === "run.started") return "running" as const;
  if (
    payloadStatus === "completed" ||
    eventType === "turn.completed" ||
    eventType === "run.completed"
  )
    return "completed" as const;
  if (payloadStatus === "cancelled" || eventType === "run.cancelled") return "cancelled" as const;
  if (payloadStatus === "interrupted" || eventType === "run.interrupted")
    return "interrupted" as const;
  if (payloadStatus === "failed" || eventType === "run.failed") return "failed" as const;
  return null;
}

export function buildTaskState(input: {
  startedAt: number;
  status: TaskStatus;
  firstResponseAt?: number | undefined;
  endedAt?: number | undefined;
  usage?: Record<string, number> | undefined;
  reason?: string | undefined;
  reconnecting?: ReconnectNotice | undefined;
  runId?: string | undefined;
}): TaskState {
  return {
    startedAt: input.startedAt,
    status: input.status,
    ...(input.firstResponseAt != null ? { firstResponseAt: input.firstResponseAt } : {}),
    ...(input.endedAt != null ? { endedAt: input.endedAt } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.reconnecting ? { reconnecting: input.reconnecting } : {}),
    ...(input.runId ? { runId: input.runId } : {})
  };
}

export function resolveTaskState(input: {
  sessionStatus?: string | null | undefined;
  messages: Array<{
    eventType?: string | null;
    dataJson?: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
}): TaskState | null {
  const lastRun = [...input.messages]
    .reverse()
    .find((message) => message.eventType && RUN_EVENTS.has(message.eventType));
  const data = parseData(lastRun?.dataJson) ?? {};
  const reconnectingData =
    data.reconnecting && typeof data.reconnecting === "object"
      ? (data.reconnecting as Record<string, unknown>)
      : null;
  const reconnecting = parseReconnectNotice(reconnectingData?.message);
  const fromEvent = statusFromRunEvent(lastRun?.eventType, data.status);
  const status =
    input.sessionStatus === "running"
      ? "running"
      : input.sessionStatus === "cancelled" ||
          input.sessionStatus === "interrupted" ||
          input.sessionStatus === "failed"
        ? input.sessionStatus
        : fromEvent;
  if (!status) return null;
  return buildTaskState({
    startedAt: Number(data.startedAt ?? lastRun?.createdAt ?? Date.now()),
    status,
    ...(typeof data.firstResponseAt === "number" ? { firstResponseAt: data.firstResponseAt } : {}),
    ...(status === "running"
      ? {}
      : { endedAt: Number(data.endedAt ?? lastRun?.updatedAt ?? Date.now()) }),
    ...(data.usage ? { usage: data.usage } : {}),
    ...(data.reason ? { reason: String(data.reason) } : {}),
    ...(status === "running" && reconnecting ? { reconnecting } : {}),
    ...(typeof data.runId === "string" ? { runId: data.runId } : {})
  });
}

const sameTaskRun = (left: TaskState, right: TaskState) => {
  if (left.runId && right.runId) return left.runId === right.runId;
  return left.startedAt === right.startedAt;
};

export function reconcileTaskState(
  current: TaskState | null,
  resolved: TaskState | null
): TaskState | null {
  if (!current) return resolved;
  if (!resolved) return current.status === "running" ? current : null;
  if (!sameTaskRun(current, resolved)) {
    return resolved.startedAt > current.startedAt ? resolved : current;
  }
  const status =
    current.status !== "running"
      ? current.status
      : resolved.status !== "running"
        ? resolved.status
        : "running";
  return buildTaskState({
    startedAt: current.startedAt,
    status,
    ...(current.firstResponseAt != null
      ? { firstResponseAt: current.firstResponseAt }
      : resolved.firstResponseAt != null
        ? { firstResponseAt: resolved.firstResponseAt }
        : {}),
    ...(status !== "running"
      ? current.endedAt != null
        ? { endedAt: current.endedAt }
        : resolved.endedAt != null
          ? { endedAt: resolved.endedAt }
          : {}
      : {}),
    ...(current.usage ? { usage: current.usage } : resolved.usage ? { usage: resolved.usage } : {}),
    ...(current.reason
      ? { reason: current.reason }
      : resolved.reason
        ? { reason: resolved.reason }
        : {}),
    ...(status === "running" && current.reconnecting
      ? { reconnecting: current.reconnecting }
      : status === "running" && resolved.reconnecting
        ? { reconnecting: resolved.reconnecting }
        : {}),
    ...(current.runId ? { runId: current.runId } : resolved.runId ? { runId: resolved.runId } : {})
  });
}

export function patchTaskState(
  current: TaskState | null,
  patch: {
    status: TaskStatus;
    startedAt?: number;
    firstResponseAt?: number;
    endedAt?: number;
    usage?: Record<string, number>;
    reason?: string;
    reconnecting?: ReconnectNotice | null;
    runId?: string;
  }
): TaskState {
  const firstResponseAt = patch.firstResponseAt ?? current?.firstResponseAt;
  const usage = patch.usage ?? current?.usage;
  const reason = patch.reason ?? current?.reason;
  const runId = patch.runId ?? current?.runId;
  const reconnecting =
    patch.status !== "running"
      ? undefined
      : patch.reconnecting === null
        ? undefined
        : (patch.reconnecting ?? current?.reconnecting);
  const next = buildTaskState({
    startedAt: patch.startedAt ?? current?.startedAt ?? Date.now(),
    status: patch.status,
    ...(typeof firstResponseAt === "number" ? { firstResponseAt } : {}),
    ...(typeof patch.endedAt === "number" ? { endedAt: patch.endedAt } : {}),
    ...(usage ? { usage } : {}),
    ...(reason ? { reason } : {}),
    ...(reconnecting ? { reconnecting } : {}),
    ...(runId ? { runId } : {})
  });
  if (
    current &&
    current.startedAt === next.startedAt &&
    current.firstResponseAt === next.firstResponseAt &&
    current.endedAt === next.endedAt &&
    current.status === next.status &&
    current.reason === next.reason &&
    current.runId === next.runId &&
    current.usage === next.usage &&
    current.reconnecting === next.reconnecting
  ) {
    return current;
  }
  return next;
}

export function beginRunningTaskState(
  current: TaskState | null,
  patch: { startedAt?: number; runId?: string }
): TaskState {
  const runId = patch.runId ?? current?.runId;
  const sameRun =
    Boolean(patch.runId && current?.runId === patch.runId) ||
    (current?.status === "running" && !patch.runId);
  return buildTaskState({
    startedAt: patch.startedAt ?? current?.startedAt ?? Date.now(),
    status: "running",
    ...(sameRun && current?.firstResponseAt != null
      ? { firstResponseAt: current.firstResponseAt }
      : {}),
    ...(sameRun && current?.usage ? { usage: current.usage } : {}),
    ...(sameRun && current?.reconnecting ? { reconnecting: current.reconnecting } : {}),
    ...(runId ? { runId } : {})
  });
}
