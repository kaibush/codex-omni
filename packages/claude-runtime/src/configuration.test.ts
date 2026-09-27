import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeRequestSchema } from "@codex-omni/protocol";
import { claudeEnvironment, claudeQueryOptions, parseClaudeMcpServers } from "./configuration.js";

const request = bridgeRequestSchema.parse({
  protocolVersion: 1,
  requestId: "run",
  projectId: "project",
  sessionId: "session",
  clientType: "claude-code",
  cwd: "/tmp",
  runtimeHome: "/tmp/isolated",
  runtimeKey: "key",
  message: "hello",
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  networkAccessEnabled: true
});

afterEach(() => vi.restoreAllMocks());

describe("Claude SDK configuration", () => {
  it("isolates credentials, endpoints, nesting markers and model mappings", () => {
    const inherited = {
      HOME: "/home/test",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "unrelated-key",
      ANTHROPIC_BASE_URL: "https://wrong.invalid",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "wrong-model",
      CLAUDE_CODE_OAUTH_TOKEN: "unrelated-login",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDECODE: "1",
      CODEX_HOME: "/tmp/codex"
    };
    const env = claudeEnvironment(
      {
        ...request,
        apiKey: "provider-key",
        baseUrl: "https://provider.invalid",
        messageEnvVars: { CUSTOM: "yes" }
      },
      inherited
    );
    expect(env).toMatchObject({
      HOME: "/home/test",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "provider-key",
      ANTHROPIC_BASE_URL: "https://provider.invalid",
      CLAUDE_CONFIG_DIR: "/tmp/isolated",
      CUSTOM: "yes"
    });
    for (const key of ["CLAUDECODE", "CODEX_HOME"]) expect(env[key]).toBeUndefined();
    for (const key of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "CLAUDE_CODE_USE_BEDROCK"
    ])
      expect(env[key]).toBe("");
    expect(inherited.ANTHROPIC_API_KEY).toBe("unrelated-key");
  });

  it("keeps provider settings and message env from redirecting native session storage", () => {
    const options = claudeQueryOptions({
      ...request,
      settingsJson: '{"env":{"CLAUDE_CONFIG_DIR":"/tmp/wrong-settings"}}',
      messageEnvVars: { CLAUDE_CONFIG_DIR: "/tmp/wrong-env" }
    });
    expect(options.env?.CLAUDE_CONFIG_DIR).toBe("/tmp/isolated");
    expect(options.settings).toMatchObject({ env: { CLAUDE_CONFIG_DIR: "/tmp/isolated" } });
  });

  describe.skipIf(typeof process.getuid !== "function")("root permission compatibility", () => {
    const unixProcess = process as NodeJS.Process & { getuid: () => number };

    it("marks explicitly requested bypass mode in both the startup environment and settings", () => {
      vi.spyOn(unixProcess, "getuid").mockReturnValue(0);
      const options = claudeQueryOptions({
        ...request,
        claude: { permissionMode: "bypassPermissions" }
      });
      expect(options.permissionMode).toBe("bypassPermissions");
      expect(options.allowDangerouslySkipPermissions).toBe(true);
      expect(options.env?.IS_SANDBOX).toBe("1");
      expect(options.settings).toMatchObject({ env: { IS_SANDBOX: "1" } });
    });

    it("only adds the marker for root execution in bypass mode", () => {
      const uid = vi.spyOn(unixProcess, "getuid").mockReturnValue(0);
      const bypass = { ...request, claude: { permissionMode: "bypassPermissions" as const } };
      expect(claudeEnvironment(request, {}).IS_SANDBOX).toBeUndefined();
      expect(claudeEnvironment({ ...bypass, mode: "plan" }, {}).IS_SANDBOX).toBeUndefined();
      uid.mockReturnValue(1000);
      expect(claudeEnvironment(bypass, {}).IS_SANDBOX).toBeUndefined();
    });

    it("preserves explicit provider and message sandbox markers", () => {
      vi.spyOn(unixProcess, "getuid").mockReturnValue(0);
      const configured = {
        ...request,
        claude: { permissionMode: "bypassPermissions" as const },
        settingsJson: '{"env":{"IS_SANDBOX":"0"}}'
      };
      expect(claudeEnvironment(configured, {}).IS_SANDBOX).toBe("0");
      expect(
        claudeEnvironment(
          {
            ...configured,
            messageEnvVars: { IS_SANDBOX: "1" }
          },
          {}
        ).IS_SANDBOX
      ).toBe("1");
    });
  });

  it("uses native planning, resume, project settings, budget and subagent options", () => {
    const options = claudeQueryOptions({
      ...request,
      threadId: "native-thread",
      mode: "plan",
      claude: {
        permissionMode: "acceptEdits",
        effort: "high",
        maxTurns: 12,
        maxBudgetUsd: 2,
        agents: { reviewer: { description: "Review", prompt: "Find bugs", tools: ["Read"] } }
      },
      mcpServersJson: '{"a":{"command":"node"},"b":{"type":"http","url":"https://mcp.invalid"}}',
      settingsJson: '{"disabledMcpServers":["b"]}'
    });
    expect(options).toMatchObject({
      resume: "native-thread",
      permissionMode: "plan",
      effort: "high",
      maxTurns: 12,
      maxBudgetUsd: 2,
      settingSources: ["user", "project", "local"],
      agents: { reviewer: { tools: ["Read"] } }
    });
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(Object.keys(options.mcpServers!)).toEqual(["a"]);
    expect(() =>
      parseClaudeMcpServers('{"bad":{"url":"file:///etc/passwd","type":"http"}}')
    ).toThrow();
  });
});
