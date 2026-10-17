import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import { resolveAppVersion } from "./app-version.js";

export type HostResource = {
  total: number;
  used: number;
  free: number;
  usage: number;
};

export type CpuTimes = {
  idle: number;
  total: number;
};

export type HostInfo = {
  app: { name: string; version: string };
  node: string;
  hostname: string;
  platform: NodeJS.Platform;
  arch: string;
  release: string;
  uptimeSec: number;
  cpu: {
    model: string;
    cores: number;
    load1: number;
    load5: number;
    load15: number;
    usage: number;
  };
  memory: HostResource;
  storage: HostResource & { path: string };
};

function readAppMeta() {
  return {
    name: "codex-omni",
    version: resolveAppVersion()
  };
}

export function usagePercent(used: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

export function readCpuTimes(cpus = os.cpus()): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

export function cpuUsageFromTimes(previous: CpuTimes, current: CpuTimes) {
  const total = current.total - previous.total;
  if (total <= 0) return 0;
  const idle = current.idle - previous.idle;
  return usagePercent(total - idle, total);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Linux includes guest time in user/nice already. Sum only the first eight
// counters, treating I/O wait and hypervisor steal as unavailable, not execution.
export function parseProcCpuTimes(text: string): CpuTimes | null {
  const line = text.split("\n").find((line) => /^cpu\s/.test(line));
  if (!line) return null;
  const times = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (times.length < 8 || times.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return {
    idle: times[3]! + times[4]! + times[7]!,
    total: times.reduce((sum, value) => sum + value, 0)
  };
}

async function readHostCpuTimes(): Promise<CpuTimes> {
  if (process.platform === "linux") {
    try {
      const times = parseProcCpuTimes(await readFile("/proc/stat", "utf8"));
      if (times) return times;
    } catch {
      // Non-Linux hosts and unavailable procfs fall back to Node's CPU counters.
    }
  }
  return readCpuTimes();
}

export function createCpuUsageSampler(
  read = readHostCpuTimes,
  wait = delay,
  now = () => performance.now()
) {
  let pending: Promise<number> | null = null;
  let sampledAt = -Infinity;
  let cached = 0;
  return function sample(): Promise<number> {
    if (pending) return pending;
    if (now() - sampledAt < 1000) return Promise.resolve(cached);
    pending = (async () => {
      const previous = await read();
      await wait(1000);
      const current = await read();
      cached = cpuUsageFromTimes(previous, current);
      sampledAt = now();
      return cached;
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
}

export const sampleCpuUsage = createCpuUsageSampler();

export async function readMemory(): Promise<HostResource> {
  const total = os.totalmem();
  let available = os.freemem();
  try {
    const text = await readFile("/proc/meminfo", "utf8");
    const match = text.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (match?.[1]) available = Number(match[1]) * 1024;
  } catch {
    // Fall back to os.freemem() when /proc/meminfo is unavailable.
  }
  const used = Math.max(0, total - available);
  return { total, used, free: available, usage: usagePercent(used, total) };
}

export async function collectHostInfo(storagePath: string): Promise<HostInfo> {
  const app = readAppMeta();
  const cpus = os.cpus();
  const cores = cpus.length || 1;
  const load = os.loadavg();
  const load1 = load[0] ?? 0;
  const load5 = load[1] ?? 0;
  const load15 = load[2] ?? 0;
  const memory = await readMemory();
  const usage = await sampleCpuUsage();
  let storage: HostInfo["storage"] = {
    path: storagePath,
    total: 0,
    used: 0,
    free: 0,
    usage: 0
  };
  try {
    const stats = await statfs(storagePath);
    const block = Number(stats.bsize);
    const total = Number(stats.blocks) * block;
    const free = Number(stats.bavail) * block;
    const used = Math.max(0, total - free);
    storage = { path: storagePath, total, used, free, usage: usagePercent(used, total) };
  } catch {
    // Keep empty storage when the mount cannot be read.
  }
  return {
    app,
    node: process.version,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptimeSec: Math.round(os.uptime()),
    cpu: {
      model: (cpus[0]?.model ?? "未知").replace(/\s+/g, " ").trim(),
      cores,
      load1,
      load5,
      load15,
      usage
    },
    memory,
    storage
  };
}
