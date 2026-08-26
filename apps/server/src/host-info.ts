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

let lastCpu: CpuTimes | null = null;
let lastCpuAt = 0;

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

export async function sampleCpuUsage(now = Date.now()) {
  const current = readCpuTimes();
  if (lastCpu && now - lastCpuAt >= 200) {
    const usage = cpuUsageFromTimes(lastCpu, current);
    lastCpu = current;
    lastCpuAt = now;
    return usage;
  }
  await delay(250);
  const next = readCpuTimes();
  const usage = cpuUsageFromTimes(current, next);
  lastCpu = next;
  lastCpuAt = Date.now();
  return usage;
}

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
