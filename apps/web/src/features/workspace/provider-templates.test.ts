import { describe, expect, it } from "vitest";
import {
  defaultClaudeProviderSettings,
  defaultProviderTemplates,
  providerAuthKey,
  providerConfigValue,
  renderProviderTemplates,
  setProviderAuthKey,
  setProviderConfigValue
} from "./provider-templates";

describe("provider templates", () => {
  it("renders editable defaults without leaking a real key", () => {
    const rendered = renderProviderTemplates(defaultProviderTemplates, {
      name: "Proxy",
      model: "model-a",
      baseUrl: "https://example.test/v1",
      apiKey: ""
    });
    expect(rendered.configToml).toContain('base_url = "https://example.test/v1"');
    expect(rendered.authJson).toContain('"OPENAI_API_KEY": ""');
  });

  it("keeps shortcut fields synchronized with config and auth text", () => {
    const config = setProviderConfigValue('model = "old"\n', "model", "new");
    const auth = setProviderAuthKey('{"other":"value"}', "sk-new");
    expect(providerConfigValue(config, "model")).toBe("new");
    expect(providerAuthKey(auth)).toBe("sk-new");
  });

  it("presets the Claude stream idle timeout to ten minutes", () => {
    expect(JSON.parse(defaultClaudeProviderSettings)).toEqual({
      env: { CLAUDE_STREAM_IDLE_TIMEOUT_MS: "600000" }
    });
  });
});
