import { describe, expect, it } from "vitest";
import { resolveCodexModelRuntimeConfig } from "./model-runtime-config.js";

describe("provider model runtime config", () => {
  it.each(["gpt-5.1-codex-max", "small-custom", "proxy-128k", "grok-4.6"])(
    "does not guess context capacity from %s",
    (model) => {
      expect(resolveCodexModelRuntimeConfig({ model })).toEqual({});
    }
  );

  it("passes explicit provider limits for small and large models", () => {
    expect(
      resolveCodexModelRuntimeConfig({ contextWindow: 32000, autoCompactTokenLimit: 28000 })
    ).toEqual({ contextWindow: 32000, autoCompactTokenLimit: 28000 });
    expect(resolveCodexModelRuntimeConfig({ contextWindow: 128000 })).toEqual({
      contextWindow: 128000
    });
    expect(resolveCodexModelRuntimeConfig({ autoCompactTokenLimit: 64000 })).toEqual({
      autoCompactTokenLimit: 64000
    });
  });

  it("leaves TOML and profile precedence to the CLI instead of replaying root values as flags", () => {
    expect(
      resolveCodexModelRuntimeConfig({
        model: "custom",
        contextWindow: null,
        autoCompactTokenLimit: null,
        configToml:
          'model_context_window = 32000\nmodel_auto_compact_token_limit = 28000\nservice_tier = "fast"\n[profiles.work]\nmodel_context_window = 128000\n'
      })
    ).toEqual({});
  });

  it.each([
    { contextWindow: 0 },
    { contextWindow: -1 },
    { contextWindow: 12.5 },
    { autoCompactTokenLimit: 0 },
    { contextWindow: 32000, autoCompactTokenLimit: 32000 },
    { contextWindow: 32000, autoCompactTokenLimit: 64000 }
  ])("rejects invalid provider limits %j", (value) => {
    expect(() => resolveCodexModelRuntimeConfig(value)).toThrow();
  });
});
