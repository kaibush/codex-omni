import { describe, expect, it } from "vitest";
import {
  parseMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  upsertMcpServer
} from "./config-toml.js";

const sample = `
model = "gpt-5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.github.env]
GITHUB_TOKEN = "secret"
`;

describe("mcp config toml", () => {
  it("parses command, args and env", () => {
    expect(parseMcpServers(sample)).toEqual([
      expect.objectContaining({
        name: "github",
        enabled: true,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "secret" }
      })
    ]);
  });

  it("disables, updates and removes servers", () => {
    const disabled = setMcpServerEnabled(sample, "github", false);
    expect(parseMcpServers(disabled)[0]?.enabled).toBe(false);
    expect(disabled).toContain("[mcp_servers_disabled.github]");
    const updated = upsertMcpServer(disabled, {
      name: "docs",
      enabled: true,
      command: "npx",
      args: ["-y", "docs-mcp"],
      url: null,
      env: {},
      extra: {}
    });
    expect(parseMcpServers(updated).map((item) => item.name)).toEqual(["docs", "github"]);
    expect(parseMcpServers(removeMcpServer(updated, "github")).map((item) => item.name)).toEqual([
      "docs"
    ]);
  });
});
