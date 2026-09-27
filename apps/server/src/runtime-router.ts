import { BridgeWorkerAdapter } from "@codex-omni/codex-runtime";
import { ClaudeWorkerAdapter } from "@codex-omni/claude-runtime";
import type { WorkerRuntimeInfo } from "@codex-omni/agent-runtime";
import {
  clientType,
  type ApprovalResponse,
  type BridgeEvent,
  type BridgeRequest
} from "@codex-omni/protocol";

/** Client selection stays outside the process transport and SDK adapters. */
export class RuntimeRouter {
  private adapters = { codex: new BridgeWorkerAdapter(), "claude-code": new ClaudeWorkerAdapter() };
  private selected = new Map<string, keyof typeof this.adapters>();

  run(
    request: BridgeRequest,
    onEvent: (event: BridgeEvent) => void,
    onRuntime?: (info: WorkerRuntimeInfo) => void
  ) {
    const kind = clientType(request.clientType);
    this.selected.set(request.sessionId, kind);
    return this.adapters[kind].run(request, onEvent, onRuntime);
  }
  private adapter(sessionId: string) {
    return this.adapters[this.selected.get(sessionId) ?? "codex"];
  }
  isActive(sessionId: string) {
    return this.adapter(sessionId).isActive(sessionId);
  }
  runtimeInfo(sessionId: string) {
    return this.adapter(sessionId).runtimeInfo(sessionId);
  }
  cancel(sessionId: string) {
    return this.adapter(sessionId).cancel(sessionId);
  }
  steer(sessionId: string, message: string, attachments?: BridgeRequest["attachments"]) {
    return this.selected.get(sessionId) === "claude-code"
      ? this.adapters["claude-code"].sendAcknowledgedCommand(sessionId, {
          type: "turn.steer",
          message,
          ...(attachments ? { attachments } : {})
        })
      : this.adapter(sessionId).steer(sessionId, message, attachments);
  }
  respond(
    sessionId: string,
    requestId: string,
    decision: ApprovalResponse["decision"],
    response?: Omit<ApprovalResponse, "decision">
  ) {
    return this.adapter(sessionId).respond(sessionId, requestId, decision, response);
  }
  stopTask(sessionId: string, taskId: string) {
    return (
      this.selected.get(sessionId) === "claude-code" &&
      this.adapters["claude-code"].sendAcknowledgedCommand(sessionId, { type: "task.stop", taskId })
    );
  }
  shutdown() {
    for (const adapter of Object.values(this.adapters)) adapter.shutdown();
  }
}
