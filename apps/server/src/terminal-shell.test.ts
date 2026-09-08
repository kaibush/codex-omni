import { describe, expect, it } from "vitest";
import {
  buildTerminalEnv,
  loginShellArgs,
  resolveTerminalShell,
  resolveTerminalUser
} from "./terminal-shell.js";

const files = new Set(["/usr/bin/zsh", "/bin/bash", "/bin/sh", "/usr/bin/fish"]);
const executable = (file: string) => files.has(file);

describe("resolveTerminalShell", () => {
  it("uses CODEX_OMNI_SHELL before the login shell", () => {
    expect(
      resolveTerminalShell({
        env: { CODEX_OMNI_SHELL: "/usr/bin/fish", SHELL: "/bin/sh" },
        user: { loginShell: "/usr/bin/zsh", username: "root", home: "/root" },
        executable
      })
    ).toEqual({ shell: "/usr/bin/fish", args: ["-l"] });
  });

  it("prefers the account login shell when systemd did not set SHELL", () => {
    expect(
      resolveTerminalShell({
        env: {},
        user: { loginShell: "/usr/bin/zsh", username: "root", home: "/root" },
        executable
      })
    ).toEqual({ shell: "/usr/bin/zsh", args: ["-l"] });
  });

  it("ignores nologin shells and keeps looking for zsh/bash", () => {
    expect(
      resolveTerminalShell({
        env: { SHELL: "/usr/sbin/nologin" },
        user: { loginShell: "/usr/sbin/nologin", username: "app", home: "/home/app" },
        executable
      })
    ).toEqual({ shell: "/usr/bin/zsh", args: ["-l"] });
  });

  it("falls back through common interactive shells", () => {
    expect(
      resolveTerminalShell({
        env: {},
        user: { loginShell: "", username: "root", home: "/root" },
        executable: (file) => file === "/bin/bash"
      })
    ).toEqual({ shell: "/bin/bash", args: ["-l"] });
  });

  it("does not pass login args to Windows shells", () => {
    expect(loginShellArgs("powershell.exe", "win32")).toEqual([]);
    expect(
      resolveTerminalShell({
        platform: "win32",
        env: { COMSPEC: "powershell.exe" }
      })
    ).toEqual({ shell: "powershell.exe", args: [] });
  });
});

describe("resolveTerminalUser", () => {
  it("reads the current account home and login shell", () => {
    const user = resolveTerminalUser();
    expect(user.home.length).toBeGreaterThan(0);
    expect(user.username.length).toBeGreaterThan(0);
  });
});

describe("buildTerminalEnv", () => {
  it("restores HOME and SHELL for PTY children started by systemd", () => {
    expect(
      buildTerminalEnv({
        env: { PATH: "/usr/bin", CODEX_OMNI_PORT: "8791" },
        shell: "/usr/bin/zsh",
        terminalId: "term-1",
        home: "/root",
        username: "root"
      })
    ).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/root",
      USER: "root",
      LOGNAME: "root",
      SHELL: "/usr/bin/zsh",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "C.UTF-8",
      CODEX_OMNI_TERMINAL_ID: "term-1"
    });
  });
});
