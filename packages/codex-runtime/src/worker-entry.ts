import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import { bridgeRequestSchema } from "@codex-omni/protocol";
import { createCollabRolloutTailer } from "./collab-rollout.js";
import { buildCodexRunInput } from "./codex-input.js";
import { gitMetadataWritableRoots } from "./git-metadata.js";
import { resolveCodexModelRuntimeConfig } from "./model-runtime-config.js";
import { createNormalizer } from "./normalizer.js";
import { workerEnvironment } from "./provider-home.js";
import {
  consumeCodexEventStream,
  createMappedStreamState,
  incompleteStreamError
} from "./worker-stream.js";

function numericUsage(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
  }
  return result;
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
const streamState = createMappedStreamState();
try {
  const modelRuntime = resolveCodexModelRuntimeConfig(request);
  const codex = new Codex({
    ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
    ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    env: workerEnvironment(request),
    config: {
      model_supports_reasoning_summaries: true,
      features: { multi_agent: true },
      ...(modelRuntime.contextWindow ? { model_context_window: modelRuntime.contextWindow } : {}),
      ...(modelRuntime.autoCompactTokenLimit
        ? { model_auto_compact_token_limit: modelRuntime.autoCompactTokenLimit }
        : {})
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
  const { events } = await thread.runStreamed(
    buildCodexRunInput(request.message, request.attachments, request.cwd)
  );
  await consumeCodexEventStream({
    events,
    state: streamState,
    map: (event) => normalizer.map(event),
    onSdkEvent: async (event) => {
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
    },
    onMappedEvent: (mapped) => {
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
      flushCollab();
    }
  });
  flushCollab();
  const incomplete = incompleteStreamError(streamState);
  if (incomplete) {
    send(normalizer.failure(incomplete, streamState.lastFailureMessage));
    process.exitCode = 1;
  } else if (streamState.failed) process.exitCode = 1;
} catch (error) {
  if (!streamState.failed) send(normalizer.failure(error, streamState.lastFailureMessage));
  process.exitCode = 1;
} finally {
  clearInterval(collabTimer);
  flushCollab();
  rl.close();
  process.stdin.destroy();
}
