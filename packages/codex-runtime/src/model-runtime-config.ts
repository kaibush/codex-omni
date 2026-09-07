import { modelRuntimeSettingsSchema, type ModelRuntimeSettings } from "@codex-omni/protocol";

export type CodexModelRuntimeConfig = {
  contextWindow?: number;
  autoCompactTokenLimit?: number;
};

export function resolveCodexModelRuntimeConfig(
  input: ModelRuntimeSettings & {
    model?: string | null | undefined;
    configToml?: string | null | undefined;
  }
): CodexModelRuntimeConfig {
  const settings = modelRuntimeSettingsSchema.parse(input);
  // Only explicit provider overrides become CLI flags. CODEX_HOME/config.toml
  // (including profile values and service_tier) remains under the CLI's own
  // precedence rules. Model names never imply a guessed context capacity.
  return {
    ...(settings.contextWindow != null ? { contextWindow: settings.contextWindow } : {}),
    ...(settings.autoCompactTokenLimit != null
      ? { autoCompactTokenLimit: settings.autoCompactTokenLimit }
      : {})
  };
}
