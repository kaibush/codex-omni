import { describe, expect, it } from "vitest";
import { defaultTerminalProfileId, terminalProfileCommandLabel } from "./terminal-profiles";

describe("terminal profiles", () => {
  it("prefers the shell profile, then the first remaining item", () => {
    expect(defaultTerminalProfileId([])).toBe("");
    expect(
      defaultTerminalProfileId([
        { id: "codex" },
        { id: "claude-code" },
        { id: "shell" }
      ])
    ).toBe("shell");
    expect(defaultTerminalProfileId([{ id: "codex" }, { id: "claude-code" }])).toBe("codex");
  });

  it("labels empty commands as a login shell", () => {
    expect(terminalProfileCommandLabel("")).toBe("登录 Shell");
    expect(terminalProfileCommandLabel("   ")).toBe("登录 Shell");
    expect(
      terminalProfileCommandLabel(
        "IS_SANDBOX=1 claude --dangerously-skip-permissions --settings ~/.claude/settings.grok.json"
      )
    ).toBe("IS_SANDBOX=1 claude --dangerously-skip-permissions --settings ~/.claude/settings.grok.json");
  });
});
