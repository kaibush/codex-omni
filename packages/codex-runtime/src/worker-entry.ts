import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import { bridgeRequestSchema } from "@codex-omni/protocol";
import { createCollabRolloutTailer } from "./collab-rollout.js";
import { gitMetadataWritableRoots } from "./git-metadata.js";
import { createNormalizer } from "./normalizer.js";
import { workerEnvironment } from "./provider-home.js";

function numericUsage(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
  }
  return result;
}

function eventMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  const message = record.reason ?? record.message;
  return typeof message === "string" ? message.trim() : "";
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const line = await new Promise<string>((resolve, reject) => {
  rl.once("line", resolve);
  rl.once("close", () => reject(new Error("Bridge request missing")));
});
const request = bridgeRequestSchema.parse(JSON.parse(line));
const normalizer = createNormalizer(request);
const send = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
const approvalResponses = new Map<string, (decision: string) => void>();
const approveForSession = new Set<string>();
rl.on("line", (input) => {
  try {
    const response = JSON.parse(input);
    if (response.type !== "approval.respond") return;
    approvalResponses.get(response.requestId)?.(response.decision);
  } catch {
    // Ignore malformed response lines; the active approval remains pending.
  }
});
const requestApproval = (item: { id: string; command: string }) => {
  if (approveForSession.has("command")) return Promise.resolve(true);
  const approvalId = randomUUID();
  send(
    normalizer.approvalRequested({
      approvalId,
      itemId: item.id,
      tool: "command",
      command: item.command
    })
  );
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(
      () => {
        approvalResponses.delete(approvalId);
        resolve(false);
      },
      5 * 60 * 1000
    );
    timeout.unref();
    approvalResponses.set(approvalId, (decision) => {
      clearTimeout(timeout);
      approvalResponses.delete(approvalId);
      if (decision === "acceptForSession") approveForSession.add("command");
      resolve(decision === "accept" || decision === "acceptForSession");
    });
  });
};
send(normalizer.initial());
const collabTailer = createCollabRolloutTailer(request.codexHome);
if (request.threadId) collabTailer.setThreadId(request.threadId, { fromEnd: true });
const flushCollab = () => {
  for (const event of collabTailer.flush()) send(normalizer.toolEvent(event));
};
const collabTimer = setInterval(flushCollab, 250);
collabTimer.unref();
let terminalFailure = false;
let lastFailureMessage = "";
try {
  const codex = new Codex({
    ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
    ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    env: workerEnvironment(request),
    config: {
      model_supports_reasoning_summaries: true,
      features: { multi_agent: true }
    }
  });
  const options = {
    workingDirectory: request.cwd,
    skipGitRepoCheck: true,
    sandboxMode: request.sandbox,
    approvalPolicy: request.approvalPolicy,
    networkAccessEnabled: request.networkAccessEnabled,
    ...(request.sandbox === "workspace-write"
      ? { additionalDirectories: gitMetadataWritableRoots(request.cwd) }
      : {}),
    ...(request.model ? { model: request.model } : {})
  };
  const thread = request.threadId
    ? codex.resumeThread(request.threadId, options)
    : codex.startThread(options);
  const { events } = await thread.runStreamed(request.message);
  for await (const event of events) {
    if (
      request.approvalPolicy !== "never" &&
      event.type === "item.started" &&
      event.item.type === "command_execution"
    ) {
      const allowed = await requestApproval(event.item);
      if (!allowed) throw new Error("Command denied by user");
    }
    if (event.type === "thread.started")
      collabTailer.setThreadId(event.thread_id, { fromEnd: Boolean(request.threadId) });
    if (event.type === "turn.completed") flushCollab();
    for (const mapped of normalizer.map(event)) {
      if (mapped.type === "turn.completed") {
        const latest = collabTailer.latestTokenUsage();
        if (!latest) send(mapped);
        else {
          const payload = { ...((mapped.payload ?? {}) as Record<string, unknown>) };
          payload.usage = { ...numericUsage(payload.usage), ...numericUsage(latest) };
          send({ ...mapped, payload });
        }
      } else {
        send(mapped);
      }
      const message = eventMessage(mapped.payload);
      if (mapped.type === "run.failed") {
        terminalFailure = true;
        if (message) lastFailureMessage = message;
      } else if (mapped.type === "run.reconnecting" && message) {
        lastFailureMessage = message;
      }
    }
    flushCollab();
  }
  flushCollab();
  if (terminalFailure) process.exitCode = 1;
} catch (error) {
  if (!terminalFailure) send(normalizer.failure(error, lastFailureMessage));
  process.exitCode = 1;
} finally {
  clearInterval(collabTimer);
  flushCollab();
  rl.close();
}
