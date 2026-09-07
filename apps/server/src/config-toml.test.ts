import { describe, expect, it } from "vitest";
import { buildApiKeyProviderFiles, parseModelsFromConfigToml } from "./config-toml.js";

describe("parseModelsFromConfigToml", () => {
  it("reads the default model and profile models", () => {
    expect(
      parseModelsFromConfigToml(`
model = "gpt-5"
model_provider = "openai"

[profiles.coding]
model = "gpt-5-codex"
`)
    ).toEqual(["gpt-5", "gpt-5-codex"]);
  });

  it("reads model aliases and ignores comments", () => {
    expect(
      parseModelsFromConfigToml(`
# model = "ignored"
model = "gpt-5" # default
[model_aliases]
fast = "gpt-5-mini"
"gpt-5.5" = "proxy-gpt-5.5"
`)
    ).toEqual(["gpt-5", "fast", "gpt-5-mini", "gpt-5.5", "proxy-gpt-5.5"]);
  });

  it("returns an empty list when no models are declared", () => {
    expect(parseModelsFromConfigToml('model_provider = "openai"')).toEqual([]);
    expect(parseModelsFromConfigToml("")).toEqual([]);
  });
});

describe("buildApiKeyProviderFiles", () => {
  it("uses the openai provider when no base URL is set", () => {
    const files = buildApiKeyProviderFiles({
      name: "Work",
      model: "gpt-5",
      apiKey: "sk-test"
    });
    expect(files.configToml).toContain('model = "gpt-5"');
    expect(files.configToml).toContain('model_provider = "openai"');
    expect(files.configToml).not.toContain("[model_providers.custom]");
    expect(JSON.parse(files.authJson)).toEqual({ OPENAI_API_KEY: "sk-test" });
  });

  it("writes a custom provider when a base URL is set", () => {
    const files = buildApiKeyProviderFiles({
      name: "Proxy",
      model: "gpt-5",
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-2"
    });
    expect(files.configToml).toContain('model_provider = "custom"');
    expect(files.configToml).toContain('name = "Proxy"');
    expect(files.configToml).toContain('base_url = "https://api.example.com/v1"');
    expect(files.configToml).toContain('wire_api = "responses"');
  });

  it("does not guess a context window for unknown custom models", () => {
    const files = buildApiKeyProviderFiles({
      name: "Grok",
      model: "grok-4.6",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-3"
    });
    expect(files.configToml).not.toContain("model_context_window");
    expect(files.configToml).not.toContain("model_auto_compact_token_limit");
    expect(
      buildApiKeyProviderFiles({
        name: "Work",
        model: "gpt-5.1-codex-max",
        apiKey: "sk-4"
      }).configToml
    ).not.toContain("model_context_window");
  });
});
