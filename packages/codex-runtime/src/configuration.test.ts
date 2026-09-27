import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import type { BridgeRequest } from "@codex-omni/protocol";
import { codexLaunchOptions, parseCodexProviderConfig } from "./configuration.js";

const request: BridgeRequest = {
  protocolVersion: 1,
  requestId: "run-a",
  projectId: "project",
  sessionId: "session",
  cwd: "/tmp/project",
  runtimeHome: "/tmp/client-codex",
  runtimeKey: "session",
  message: "Continue",
  sandbox: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false
};

describe("Codex process-scoped provider configuration", () => {
  it("keeps the client HOME fixed and supplies each run's route and credentials without secret argv", () => {
    const first = codexLaunchOptions({
      ...request,
      apiKey: "key-a",
      baseUrl: "https://a.invalid/v1",
      messageEnvVars: { CODEX_HOME: "/wrong-home", HOME: "/wrong-user" },
      configToml: `model_provider = "custom"\nsqlite_home = "/wrong-db"\n[model_providers.custom]\nname = "Custom"\nbase_url = "https://old.invalid/v1"\nrequires_openai_auth = true\nhttp_headers = { "X-Secret" = "header-secret" }`
    });
    const second = codexLaunchOptions({
      ...request,
      requestId: "run-b",
      apiKey: "key-b",
      baseUrl: "https://b.invalid/v1"
    });
    expect(first.env?.CODEX_HOME).toBe(request.runtimeHome);
    expect(second.env?.CODEX_HOME).toBe(request.runtimeHome);
    expect(first.env?.HOME).not.toBe("/wrong-user");
    const firstConfig = parse(first.configOverrides!.join("\n")) as any;
    const route = firstConfig.model_providers[firstConfig.model_provider];
    expect(route).toMatchObject({ base_url: "https://a.invalid/v1", requires_openai_auth: false });
    expect(first.env?.[route.env_key]).toBe("key-a");
    expect(first.env?.[route.env_http_headers["X-Secret"]]).toBe("header-secret");
    expect(firstConfig.sqlite_home).toBeUndefined();
    expect(first.configOverrides!.join("\n")).not.toMatch(/key-a|header-secret/);
    expect(second.env?.CODEX_OMNI_PROVIDER_API_KEY).toBe("key-b");
    expect(first.env?.CODEX_OMNI_PROVIDER_API_KEY).toBe("key-a");
  });

  it("reads managed API keys and bearer headers without writing auth.json", () => {
    const managed = codexLaunchOptions({
      ...request,
      authJson: '{"OPENAI_API_KEY":"managed-key"}',
      configToml:
        'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://managed.invalid/v1"'
    });
    expect(managed.env?.CODEX_OMNI_PROVIDER_API_KEY).toBe("managed-key");
    const bearer = codexLaunchOptions({
      ...request,
      configToml:
        'model_provider = "proxy"\n[model_providers.proxy]\nexperimental_bearer_token = "bearer-secret"'
    });
    expect(Object.values(bearer.env!)).toContain("bearer-secret");
    expect(bearer.configOverrides!.join("\n")).not.toContain("bearer-secret");
    expect(() => parseCodexProviderConfig("api_key = = secret")).toThrow("config.toml 格式无效");
    expect(() => parseCodexProviderConfig("", '{"tokens":{"access_token":"login"}}')).toThrow(
      "客户端原生配置"
    );
  });

  it("uses native login only when the client-native provider was selected", () => {
    expect(codexLaunchOptions({ ...request, homeMode: "native" }).configOverrides).toBeUndefined();
    expect(() =>
      codexLaunchOptions({
        ...request,
        configToml:
          'model_provider = "custom"\n[model_providers.custom]\nrequires_openai_auth = true'
      })
    ).toThrow("缺少 API Key");
  });
});
