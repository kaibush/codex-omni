import { AgentBridgeWorkerAdapter } from "@codex-omni/agent-runtime";

export class ClaudeWorkerAdapter extends AgentBridgeWorkerAdapter {
  constructor(workerEntry?: URL) {
    super(
      workerEntry ??
        new URL(
          import.meta.url.endsWith(".ts") ? "./worker-entry.ts" : "./worker-entry.js",
          import.meta.url
        ),
      "Claude Code 事件流提前结束，任务未完成"
    );
  }
}

export {
  resolveClaudeHome,
  claudeEnvironment,
  parseClaudeMcpServers,
  parseClaudeSettings
} from "./configuration.js";
export { createClaudeNormalizer } from "./normalizer.js";

export { claudeRuntimeInfo } from "./versions.js";
