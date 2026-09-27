import { describe, expect, it } from "vitest";
import { bridgeRequestSchema } from "@codex-omni/protocol";
import { claudeEnvironment, claudeQueryOptions, parseClaudeMcpServers } from "./configuration.js";

const request = bridgeRequestSchema.parse({
  protocolVersion: 1,
  requestId: "run",
  projectId: "project",
  sessionId: "session",
  clientType: "claude-code",
  cwd: "/tmp",
  codexHome: "/tmp/claude",
  runtimeHome: "/tmp/isolated",
  runtimeKey: "key",
  message: "hello",
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  networkAccessEnabled: true
});

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
    for (const key of [
      "CLAUDECODE",
      "CODEX_HOME",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "CLAUDE_CODE_USE_BEDROCK"
    ])
      expect(env[key]).toBeUndefined();
    expect(inherited.ANTHROPIC_API_KEY).toBe("unrelated-key");
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
