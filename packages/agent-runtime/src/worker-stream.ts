import { firstUsefulFailureMessage } from "@codex-omni/protocol";

export function workerExitError(input: {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  sawTerminalEvent: boolean;
  failed?: boolean;
  failureMessage?: string;
  incompleteMessage?: string;
}): Error | null {
  if (input.code === 0 && !input.signal && !input.failed) {
    if (!input.sawTerminalEvent)
      return new Error(input.incompleteMessage ?? "客户端事件流提前结束，任务未完成");
    return null;
  }
  return new Error(
    firstUsefulFailureMessage(input.failureMessage, input.stderr) ||
      (input.signal
        ? `Bridge worker exited with signal ${input.signal}`
        : `Bridge worker exited with ${input.code}`)
  );
}

export function isTerminalBridgeEvent(type: string) {
  return type === "turn.completed" || type === "run.failed";
}
