import type { Store } from "@codex-omni/db";
import type { RunManager } from "./run-manager.js";

export function nextRunAt(input: {
  cadence: "interval" | "daily";
  intervalMinutes?: number | null | undefined;
  dailyAt?: string | null | undefined;
  from?: number | undefined;
}) {
  const from = input.from ?? Date.now();
  if (input.cadence === "interval") {
    const minutes = Math.max(5, Math.min(24 * 60, Math.trunc(input.intervalMinutes ?? 60)));
    return from + minutes * 60_000;
  }
  const match = (input.dailyAt ?? "09:00").match(/^(\d{1,2}):(\d{2})$/);
  const hours = Math.min(23, Math.max(0, Number(match?.[1] ?? 9)));
  const minutes = Math.min(59, Math.max(0, Number(match?.[2] ?? 0)));
  const date = new Date(from);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= from) date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function startScheduledJobs(store: Store, runs: RunManager) {
  const tick = async () => {
    for (const job of store.dueScheduledJobs()) {
      try {
        const project = store.getProject(job.projectId);
        if (!project) {
          store.upsertScheduledJob({ ...job, enabled: false, nextRunAt: Date.now() + 60_000 });
          continue;
        }
        let session = job.sessionId ? store.getSession(job.sessionId) : undefined;
        if (!session) {
          session = store.createSession({
            projectId: project.id,
            title: `定时：${job.title}`,
            providerId: project.providerId
          });
        }
        runs.enqueueTurn({
          type: "turn.enqueue",
          projectId: project.id,
          sessionId: session.id,
          message: job.prompt,
          displayMessage: `定时任务：${job.title}`,
          providerId: session.providerId ?? project.providerId ?? undefined
        });
        store.upsertScheduledJob({
          ...job,
          sessionId: session.id,
          lastRunAt: Date.now(),
          nextRunAt: nextRunAt({
            cadence: job.cadence,
            intervalMinutes: job.intervalMinutes,
            dailyAt: job.dailyAt,
            from: Date.now()
          })
        });
      } catch {
        store.upsertScheduledJob({
          ...job,
          nextRunAt: Date.now() + 5 * 60_000
        });
      }
    }
  };
  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
