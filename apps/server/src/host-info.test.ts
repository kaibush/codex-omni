import os from "node:os";
import { describe, expect, it } from "vitest";
import { collectHostInfo, cpuUsageFromTimes } from "./host-info.js";

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
