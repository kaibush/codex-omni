import { describe, expect, it } from "vitest";
import {
  applyCustomModelRuntimeToml,
  inferModelContextWindow,
  isKnownCodexModel,
  parseRootTomlValue,
  resolveCodexModelRuntimeConfig
} from "./model-runtime-config.js";

describe("custom model runtime config", () => {
  it("treats official Codex models as known and leaves custom aliases unknown", () => {
    expect(isKnownCodexModel("gpt-5.1-codex-max")).toBe(true);
    expect(isKnownCodexModel("gpt-5.6-sol")).toBe(false);
    expect(isKnownCodexModel("grok-4.6")).toBe(false);
    expect(isKnownCodexModel("deepseek-v4-flash")).toBe(false);
    expect(inferModelContextWindow("gpt-5.1-codex-max")).toBeUndefined();
    expect(inferModelContextWindow("grok-4.6")).toBe(256_000);
    expect(inferModelContextWindow("claude-opus-4.6")).toBe(256_000);
  });

  it("injects context window for unknown models without overwriting user values", () => {
    const injected = applyCustomModelRuntimeToml(`
model = "grok-4.6"
model_provider = "custom"
service_tier = "fast"

[model_providers.custom]
base_url = "https://api.example.com/v1"
`);
    expect(parseRootTomlValue(injected, "model_context_window")).toBe("256000");
    expect(parseRootTomlValue(injected, "model_auto_compact_token_limit")).toBe("230400");
    expect(parseRootTomlValue(injected, "service_tier")).toBe("fast");
    expect(injected).toContain("[model_providers.custom]");

    const preserved = applyCustomModelRuntimeToml(`
model = "grok-4.6"
model_context_window = 2000000
`);
    expect(parseRootTomlValue(preserved, "model_context_window")).toBe("2000000");
    expect(applyCustomModelRuntimeToml('model = "gpt-5.1-codex-max"\n')).toBe(
      'model = "gpt-5.1-codex-max"\n'
    );
  });

  it("prefers config.toml overrides when building SDK config", () => {
    const runtime = resolveCodexModelRuntimeConfig({
      model: "deepseek-v4-flash",
      configToml: `
model = "ignored"
model_context_window = 128000
service_tier = "fast"
`
    });
    expect(runtime).toMatchObject({
      model: "deepseek-v4-flash",
      contextWindow: 128000,
      autoCompactTokenLimit: 115200,
      serviceTier: "fast"
    });
  });
});
