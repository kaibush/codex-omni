import { AgentBridgeWorkerAdapter } from "@codex-omni/agent-runtime";
import { INCOMPLETE_TURN_MESSAGE } from "./worker-stream.js";
export { terminateRecordedWorker } from "@codex-omni/agent-runtime";
export type { WorkerRuntimeInfo } from "@codex-omni/agent-runtime";

export class BridgeWorkerAdapter extends AgentBridgeWorkerAdapter {
  constructor(workerEntry?: URL) {
    super(
      workerEntry ??
        new URL(
          import.meta.url.endsWith(".ts") ? "./worker-entry.ts" : "./worker-entry.js",
          import.meta.url
        ),
      INCOMPLETE_TURN_MESSAGE
    );
  }
}

export { parseCodexProviderConfig } from "./configuration.js";
export { createNormalizer } from "./normalizer.js";
export { extractRolloutToolEvents, findRolloutFile } from "./collab-rollout.js";
export type { CollabRolloutEvent } from "./collab-rollout.js";

export { buildCodexRunInput, sanitizeCodexAttachments } from "./codex-input.js";
export { resolveCodexModelRuntimeConfig } from "./model-runtime-config.js";
export {
  consumeCodexEventStream,
  INCOMPLETE_TURN_MESSAGE,
  incompleteStreamError,
  isTerminalBridgeEvent,
  workerExitError
} from "./worker-stream.js";

export { bundledCodexCliPath, bundledCodexVersions } from "./codex-versions.js";
export type { BundledCodexVersions } from "./codex-versions.js";
