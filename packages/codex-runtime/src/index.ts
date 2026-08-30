import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { eventSchema, type BridgeEvent, type BridgeRequest } from "@codex-omni/protocol";

export type WorkerRuntimeInfo = {
  requestId: string;
  sessionId: string;
  workerPid: number | null;
  codexPid: number | null;
  startedAt: number;
  alive: boolean;
};

type ActiveWorker = {
  child: ChildProcess;
  requestId: string;
  sessionId: string;
  startedAt: number;
};

const readProcText = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

const childPids = (pid: number) =>
  readProcText(`/proc/${pid}/task/${pid}/children`)
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0);

const descendantPids = (rootPid: number) => {
  if (process.platform !== "linux") return [];
  const result: number[] = [];
  const queue = [...childPids(rootPid)];
  const visited = new Set<number>();
  while (queue.length) {
    const pid = queue.shift()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    result.push(pid);
    queue.push(...childPids(pid));
  }
  return result;
};

const commandLine = (pid: number) =>
  readProcText(`/proc/${pid}/cmdline`).replaceAll("\0", " ").trim();

const environment = (pid: number) => readProcText(`/proc/${pid}/environ`).replaceAll("\0", "\n");

const findCodexPid = (workerPid: number) =>
  descendantPids(workerPid).find((pid) => {
    const command = commandLine(pid);
    return /(?:^|\/)codex(?:\s|$)/.test(command) && /\bexec\b/.test(command);
  }) ?? null;

const signalTree = (child: ChildProcess, signal: NodeJS.Signals) => {
  const pid = child.pid;
  if (!pid) return false;
  try {
    if (process.platform !== "win32") process.kill(-pid, signal);
    else child.kill(signal);
    return true;
  } catch {
    try {
      return child.kill(signal);
    } catch {
      return false;
    }
  }
};

export function terminateRecordedWorker(workerPid: number, requestId: string) {
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0) return false;
  const matchesRecordedWorker = () => {
    if (process.platform !== "linux") return true;
    const env = environment(workerPid);
    return env.includes(`CODEX_OMNI_RUN_ID=${requestId}\n`);
  };
  if (!matchesRecordedWorker()) return false;
  try {
    if (process.platform !== "win32") process.kill(-workerPid, "SIGTERM");
    else process.kill(workerPid, "SIGTERM");
    setTimeout(() => {
      if (!matchesRecordedWorker()) return;
      try {
        if (process.platform !== "win32") process.kill(-workerPid, "SIGKILL");
        else process.kill(workerPid, "SIGKILL");
      } catch {
        // The recorded process group already exited.
      }
    }, 3000).unref();
    return true;
  } catch {
    return false;
  }
}

export class BridgeWorkerAdapter {
  private active = new Map<string, ActiveWorker>();

  run(
    request: BridgeRequest,
    onEvent: (event: BridgeEvent) => void,
    onRuntime?: (runtime: WorkerRuntimeInfo) => void
  ): Promise<void> {
    if (this.active.has(request.sessionId))
      return Promise.reject(new Error("Session already has an active turn"));
    const jsUrl = new URL("./worker-entry.js", import.meta.url);
    const tsUrl = new URL("./worker-entry.ts", import.meta.url);
    const sourceUrl = import.meta.url.endsWith(".ts") ? tsUrl : jsUrl;
    const args = sourceUrl.pathname.endsWith(".ts")
      ? ["--import", "tsx", fileURLToPath(sourceUrl)]
      : [fileURLToPath(sourceUrl)];
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(process.execPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: request.cwd,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          CODEX_OMNI_RUN_ID: request.requestId,
          CODEX_OMNI_SESSION_ID: request.sessionId
        }
      });
      const active: ActiveWorker = {
        child,
        requestId: request.requestId,
        sessionId: request.sessionId,
        startedAt
      };
      this.active.set(request.sessionId, active);
      onRuntime?.(this.runtimeInfo(request.sessionId)!);
      let stderr = "";
      let settled = false;
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 16000) stderr = stderr.slice(-16000);
      });
      readline.createInterface({ input: child.stdout! }).on("line", (line) => {
        try {
          onEvent(eventSchema.parse(JSON.parse(line)));
        } catch (error) {
          signalTree(child, "SIGTERM");
          settleReject(new Error(`Invalid bridge event: ${String(error)}`));
        }
      });
      child.once("error", (error) => settleReject(error));
      child.once("exit", (code, signal) => {
        this.active.delete(request.sessionId);
        onRuntime?.({
          requestId: request.requestId,
          sessionId: request.sessionId,
          workerPid: child.pid ?? null,
          codexPid: null,
          startedAt,
          alive: false
        });
        if (settled) return;
        settled = true;
        if (code === 0 && !signal) resolve();
        else
          reject(
            new Error(
              stderr.trim() ||
                (signal
                  ? `Bridge worker exited with signal ${signal}`
                  : `Bridge worker exited with ${code}`)
            )
          );
      });
      child.stdin?.write(`${JSON.stringify(request)}\n`);
    });
  }

  respond(
    sessionId: string,
    requestId: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel"
  ) {
    const child = this.active.get(sessionId)?.child;
    if (!child?.stdin?.writable) return false;
    child.stdin.write(`${JSON.stringify({ type: "approval.respond", requestId, decision })}\n`);
    return true;
  }

  cancel(sessionId: string) {
    const active = this.active.get(sessionId);
    if (!active) return false;
    signalTree(active.child, "SIGTERM");
    setTimeout(() => {
      if (active.child.exitCode === null && active.child.signalCode === null)
        signalTree(active.child, "SIGKILL");
    }, 3000).unref();
    return true;
  }

  isActive(sessionId: string) {
    const child = this.active.get(sessionId)?.child;
    return Boolean(child && child.exitCode === null && child.signalCode === null);
  }

  runtimeInfo(sessionId: string): WorkerRuntimeInfo | null {
    const active = this.active.get(sessionId);
    if (!active) return null;
    const workerPid = active.child.pid ?? null;
    return {
      requestId: active.requestId,
      sessionId: active.sessionId,
      workerPid,
      codexPid: workerPid ? findCodexPid(workerPid) : null,
      startedAt: active.startedAt,
      alive: active.child.exitCode === null && active.child.signalCode === null
    };
  }

  listRuntimeInfo() {
    return [...this.active.keys()]
      .map((sessionId) => this.runtimeInfo(sessionId))
      .filter((runtime): runtime is WorkerRuntimeInfo => Boolean(runtime));
  }

  shutdown() {
    for (const sessionId of this.active.keys()) this.cancel(sessionId);
  }
}

export {
  assertExternalCodexHome,
  materializeProviderHome,
  resolveProviderHome,
  runtimeKey
} from "./provider-home.js";
export { createNormalizer } from "./normalizer.js";
export { extractRolloutToolEvents, findRolloutFile } from "./collab-rollout.js";
export type { CollabRolloutEvent } from "./collab-rollout.js";
