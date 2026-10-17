import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  collectHostInfo,
  cpuUsageFromTimes,
  createCpuUsageSampler,
  parseProcCpuTimes
} from "./host-info.js";

describe("collectHostInfo", () => {
  it("reads version, cpu, memory and storage from this machine", async () => {
    const info = await collectHostInfo(os.tmpdir());
    expect(info.app.name).toBe("codex-omni");
    expect(info.app.version).toMatch(/^\d+\.\d+/);
    expect(info.node).toMatch(/^v\d+/);
    expect(info.hostname.length).toBeGreaterThan(0);
    expect(info.cpu.cores).toBeGreaterThan(0);
    expect(info.cpu.model.length).toBeGreaterThan(0);
    expect(info.cpu.usage).toBeGreaterThanOrEqual(0);
    expect(info.cpu.usage).toBeLessThanOrEqual(100);
    expect(info.memory.total).toBeGreaterThan(0);
    expect(info.memory.used).toBeGreaterThanOrEqual(0);
    expect(info.memory.used).toBeLessThanOrEqual(info.memory.total);
    expect(info.storage.total).toBeGreaterThan(0);
    expect(info.storage.usage).toBeGreaterThanOrEqual(0);
    expect(info.storage.usage).toBeLessThanOrEqual(100);
  });
});

describe("cpuUsageFromTimes", () => {
  it("uses idle deltas instead of load average", () => {
    expect(cpuUsageFromTimes({ idle: 80, total: 100 }, { idle: 90, total: 120 })).toBe(50);
    expect(cpuUsageFromTimes({ idle: 50, total: 100 }, { idle: 90, total: 140 })).toBe(0);
  });
});

describe("Linux CPU accounting", () => {
  it("includes softirq and steal in total without double-counting guest time", () => {
    const before = parseProcCpuTimes("cpu 100 20 30 400 50 10 15 75 25 5\ncpu0 1 2 3 4")!;
    const after = parseProcCpuTimes("cpu 110 20 40 440 60 10 25 95 30 6")!;
    expect(before).toEqual({ idle: 525, total: 700 });
    expect(after).toEqual({ idle: 595, total: 800 });
    expect(cpuUsageFromTimes(before, after)).toBe(30);
  });

  it("rejects malformed counters", () => {
    expect(parseProcCpuTimes("cpu0 1 2 3 4 5 6 7 8")).toBeNull();
    expect(parseProcCpuTimes("cpu 1 2 3 4")).toBeNull();
    expect(parseProcCpuTimes("cpu 1 2 3 4 5 6 nope 8")).toBeNull();
  });
});

describe("CPU sampling window", () => {
  it("shares concurrent sampling and starts a fresh window after a long gap", async () => {
    let now = 0;
    const read = vi
      .fn()
      .mockResolvedValueOnce({ idle: 0, total: 0 })
      .mockResolvedValueOnce({ idle: 40, total: 100 })
      .mockResolvedValueOnce({ idle: 1000, total: 5000 })
      .mockResolvedValueOnce({ idle: 1090, total: 5100 });
    const wait = vi.fn(async (ms: number) => {
      now += ms;
    });
    const sample = createCpuUsageSampler(read, wait, () => now);
    const first = sample();
    expect(sample()).toBe(first);
    expect(await first).toBe(60);
    expect(await sample()).toBe(60);
    expect(read).toHaveBeenCalledTimes(2);
    now += 30_000;
    expect(await sample()).toBe(10);
    expect(wait.mock.calls).toEqual([[1000], [1000]]);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("can retry a failed sample", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce({ idle: 0, total: 0 })
      .mockResolvedValueOnce({ idle: 20, total: 100 });
    const sample = createCpuUsageSampler(read, async () => undefined);
    await expect(sample()).rejects.toThrow("read failed");
    expect(await sample()).toBe(80);
  });
});
