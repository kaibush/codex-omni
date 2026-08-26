import { describe, expect, it } from "vitest";
import {
  beginRunningTaskState,
  patchTaskState,
  reconcileTaskState,
  resolveTaskState,
  taskStatusLabel
} from "./task-state";

describe("resolveTaskState", () => {
  it("keeps a running session visible after reload", () => {
    expect(
      resolveTaskState({
        sessionStatus: "running",
        messages: [
          {
            eventType: "run.started",
            dataJson: JSON.stringify({ status: "running", startedAt: 1000 }),
            createdAt: 1000,
            updatedAt: 1000
          }
        ]
      })
    ).toMatchObject({ status: "running", startedAt: 1000 });
  });

  it("restores the persisted run identity", () => {
    expect(
      resolveTaskState({
        sessionStatus: "running",
        messages: [
          {
            eventType: "run.started",
            dataJson: JSON.stringify({ status: "running", startedAt: 1000, runId: "run-1" }),
            createdAt: 1000,
            updatedAt: 1000
          }
        ]
      })
    ).toMatchObject({ status: "running", runId: "run-1" });
  });

  it("distinguishes completed, failed, cancelled and interrupted turns", () => {
    expect(
      resolveTaskState({
        sessionStatus: "idle",
        messages: [
          {
            eventType: "turn.completed",
            dataJson: JSON.stringify({ status: "completed", startedAt: 1, endedAt: 8 }),
            createdAt: 8,
            updatedAt: 8
          }
        ]
      })?.status
    ).toBe("completed");
    expect(
      resolveTaskState({
        sessionStatus: "failed",
        messages: [{ eventType: "run.failed", dataJson: null, createdAt: 2, updatedAt: 2 }]
      })?.status
    ).toBe("failed");
    expect(
      resolveTaskState({
        sessionStatus: "cancelled",
        messages: [{ eventType: "run.cancelled", dataJson: null, createdAt: 3, updatedAt: 3 }]
      })?.status
    ).toBe("cancelled");
    expect(
      resolveTaskState({
        sessionStatus: "interrupted",
        messages: [{ eventType: "run.interrupted", dataJson: null, createdAt: 4, updatedAt: 4 }]
      })?.status
    ).toBe("interrupted");
  });

  it("restores reconnecting as a running state and clears it when progress resumes", () => {
    const running = resolveTaskState({
      sessionStatus: "running",
      messages: [
        {
          eventType: "run.running",
          dataJson: JSON.stringify({
            status: "running",
            startedAt: 1000,
            reconnecting: {
              message: "Reconnecting... 2/5 (temporary disconnect)",
              attempt: 2,
              maxAttempts: 5,
              reason: "temporary disconnect"
            }
          }),
          createdAt: 1000,
          updatedAt: 2000
        }
      ]
    });
    expect(running).toMatchObject({
      status: "running",
      reconnecting: { attempt: 2, maxAttempts: 5 }
    });
    expect(
      patchTaskState(running, { status: "running", reconnecting: null, firstResponseAt: 2500 })
    ).toMatchObject({ status: "running", firstResponseAt: 2500 });
    expect(
      patchTaskState(running, { status: "running", reconnecting: null, firstResponseAt: 2500 })
        .reconnecting
    ).toBeUndefined();
  });
});

describe("taskStatusLabel", () => {
  it("uses distinct Chinese labels", () => {
    expect(taskStatusLabel("running")).toBe("任务进行中");
    expect(taskStatusLabel("completed")).toBe("任务已完成");
    expect(taskStatusLabel("failed")).toBe("任务异常中断");
    expect(taskStatusLabel("cancelled")).toBe("已手动终止");
    expect(taskStatusLabel("interrupted")).toBe("任务未完成（已中断）");
  });
});

describe("beginRunningTaskState", () => {
  it("does not reuse firstResponseAt from a previous completed run", () => {
    const previous = resolveTaskState({
      sessionStatus: "idle",
      messages: [
        {
          eventType: "turn.completed",
          dataJson: JSON.stringify({
            status: "completed",
            startedAt: 1_000,
            firstResponseAt: 1_500,
            endedAt: 8_000
          }),
          createdAt: 8_000,
          updatedAt: 8_000
        }
      ]
    });
    expect(
      beginRunningTaskState(previous && { ...previous, runId: "run-1" }, {
        startedAt: 10_000,
        runId: "run-2"
      })
    ).toEqual({ startedAt: 10000, status: "running", runId: "run-2" });
  });

  it("keeps firstResponseAt when the same run is restated", () => {
    expect(
      beginRunningTaskState(
        {
          startedAt: 1000,
          firstResponseAt: 1500,
          status: "running",
          runId: "run-1"
        },
        { startedAt: 1000, runId: "run-1" }
      )
    ).toMatchObject({ firstResponseAt: 1500, status: "running", runId: "run-1" });
  });
});

describe("reconcileTaskState", () => {
  it("does not let a stale HTTP result erase realtime timing for the same run", () => {
    expect(
      reconcileTaskState(
        {
          startedAt: 1000,
          firstResponseAt: 1500,
          status: "running",
          runId: "run-1"
        },
        { startedAt: 900, status: "running", runId: "run-1" }
      )
    ).toMatchObject({
      startedAt: 1000,
      firstResponseAt: 1500,
      status: "running",
      runId: "run-1"
    });
  });

  it("keeps a terminal realtime state from regressing to running", () => {
    expect(
      reconcileTaskState(
        { startedAt: 1000, endedAt: 2000, status: "completed", runId: "run-1" },
        { startedAt: 1000, status: "running", runId: "run-1" }
      )?.status
    ).toBe("completed");
  });

  it("selects a newer run instead of carrying state across runs", () => {
    expect(
      reconcileTaskState(
        { startedAt: 1000, firstResponseAt: 1200, status: "completed", runId: "run-1" },
        { startedAt: 3000, status: "running", runId: "run-2" }
      )
    ).toEqual({ startedAt: 3000, status: "running", runId: "run-2" });
  });
});
