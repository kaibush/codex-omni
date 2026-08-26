import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import { bridgeRequestSchema } from "@codex-omni/protocol";
import { createNormalizer } from "./normalizer.js";
import { workerEnvironment } from "./provider-home.js";

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
try {
  const codex = new Codex({
    ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
    ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    env: workerEnvironment(request),
    config: { model_supports_reasoning_summaries: true }
  });
  const options = {
    workingDirectory: request.cwd,
    skipGitRepoCheck: true,
    sandboxMode: request.sandbox,
    approvalPolicy: request.approvalPolicy,
    networkAccessEnabled: request.networkAccessEnabled,
    ...(request.model ? { model: request.model } : {})
  };
  const thread = request.threadId
    ? codex.resumeThread(request.threadId, options)
    : codex.startThread(options);
  const { events } = await thread.runStreamed(request.message);
  let terminalFailure = false;
  for await (const event of events) {
    if (
      request.approvalPolicy !== "never" &&
      event.type === "item.started" &&
      event.item.type === "command_execution"
    ) {
      const allowed = await requestApproval(event.item);
      if (!allowed) throw new Error("Command denied by user");
    }
    for (const mapped of normalizer.map(event)) {
      send(mapped);
      if (mapped.type === "run.failed") terminalFailure = true;
    }
  }
  if (terminalFailure) process.exitCode = 1;
} catch (error) {
  send(normalizer.failure(error));
  process.exitCode = 1;
} finally {
  rl.close();
}
