import { afterEach, describe, expect, it, vi } from "vitest";
import { parseModelsFromConfigToml, parseProviderConnection } from "./config-toml.js";
import {
  cloneProviderName,
  filterModels,
  enhancePrompt,
  parseProviderImport,
  serializeProviderExport
} from "./provider-ops.js";

describe("provider ops", () => {
  it("round-trips export/import and clones names", () => {
    const exported = serializeProviderExport({
      name: "Work",
      kind: "codex",
      model: "gpt-5",
      models: ["gpt-5"],
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      configToml: 'model = "gpt-5"\nbase_url = "https://api.example.com/v1"\n',
      authJson: '{"OPENAI_API_KEY":"sk-test"}',
      messageEnvVars: { FOO: "bar" },
      homeMode: "managed"
    });
    const imported = parseProviderImport(JSON.parse(JSON.stringify(exported)));
    expect(imported.name).toBe("Work");
    expect(imported.apiKey).toBe("sk-test");
    expect(imported.homeMode).toBe("managed");
    expect(
      parseProviderImport({
        name: "Key",
        homeMode: "api-key",
        apiKey: "sk-live"
      }).homeMode
    ).toBe("api-key");
    expect(cloneProviderName("Work")).toBe("Work 副本");
    expect(cloneProviderName("Work 副本")).toBe("Work 副本 2");
  });

  it("parses connection details and filters models", () => {
    expect(
      parseProviderConnection({
        configToml: 'base_url = "https://api.example.com/v1/"\n',
        authJson: '{"OPENAI_API_KEY":"sk-1"}'
      })
    ).toEqual({ baseUrl: "https://api.example.com/v1", apiKey: "sk-1" });
    expect(filterModels(["gpt-5", "gpt-5-mini", "o4-mini"], "mini")).toEqual([
      "gpt-5-mini",
      "o4-mini"
    ]);
    expect(parseModelsFromConfigToml('model = "gpt-5"')).toEqual(["gpt-5"]);
  });
});

describe("enhancePrompt", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rewrites a prompt through chat completions", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "请在 src/app.ts 修复空指针，并补充回归测试。" } }]
          }),
          { status: 200 }
        )
    ) as typeof fetch;
    const result = await enhancePrompt({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5",
      text: "修一下空指针"
    });
    expect(result.text).toContain("src/app.ts");
    expect(result.model).toBe("gpt-5");
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("rejects empty prompts and missing base URL", async () => {
    await expect(enhancePrompt({ text: "   " })).rejects.toThrow("请先输入");
    await expect(enhancePrompt({ text: "hello" })).rejects.toThrow("Base URL");
  });
});
