import readline from "node:readline";
import { approvalResponseSchema, bridgeRequestSchema } from "@codex-omni/protocol";
import { ClaudeTurn } from "./turn.js";

const lines = readline.createInterface({ input: process.stdin });
let turn: ClaudeTurn | undefined;
let started = false;
lines.on("line", (line) => {
  let command: any;
  try {
    command = JSON.parse(line);
  } catch {
    process.stderr.write("Invalid bridge JSON\n");
    return;
  }
  if (!started) {
    started = true;
    const parsed = bridgeRequestSchema.safeParse(command);
    if (!parsed.success) {
      process.stderr.write(`${parsed.error.message}\n`);
      process.exitCode = 1;
      lines.close();
      process.stdin.destroy();
      return;
    }
    const request = parsed.data;
    const send = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
    turn = new ClaudeTurn(request, send);
    void turn
      .run()
      .catch((error) => {
        turn?.fail(error);
        process.exitCode = 1;
      })
      .finally(() => {
        lines.close();
        process.stdin.destroy();
      });
    return;
  }
  if (command.type === "approval.respond") {
    const response = approvalResponseSchema.safeParse(command);
    if (response.success) turn?.respond(String(command.requestId), response.data);
  } else if (command.type === "turn.steer") {
    void turn
      ?.steer(String(command.message), command.attachments)
      .then((accepted) => {
        process.stdout.write(
          `${JSON.stringify({ type: "command.response", commandId: command.commandId, accepted })}\n`
        );
      })
      .catch((error) => {
        process.stdout.write(
          `${JSON.stringify({ type: "command.response", commandId: command.commandId, accepted: false, error: String(error) })}\n`
        );
      });
  } else if (command.type === "task.stop") {
    void turn
      ?.stopTask(String(command.taskId))
      .then(() => {
        process.stdout.write(
          `${JSON.stringify({ type: "command.response", commandId: command.commandId, accepted: true })}\n`
        );
      })
      .catch((error) => {
        process.stdout.write(
          `${JSON.stringify({ type: "command.response", commandId: command.commandId, accepted: false, error: String(error) })}\n`
        );
      });
  }
});
process.once("SIGTERM", () => turn?.cancel());
process.once("SIGINT", () => turn?.cancel());
process.stdin.once("end", () => turn?.cancel());
