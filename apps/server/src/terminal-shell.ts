import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NON_INTERACTIVE_SHELLS = new Set(["nologin", "false", "sync", "halt", "shutdown"]);
const POSIX_SHELL_FALLBACKS = ["/usr/bin/zsh", "/bin/zsh", "/usr/bin/bash", "/bin/bash", "/bin/sh"];

export type TerminalUser = {
  username: string;
  home: string;
  loginShell: string;
};

export type TerminalShell = {
  shell: string;
  args: string[];
};

export type TerminalRuntime = TerminalUser & TerminalShell;

type ResolveOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  executable?: (file: string) => boolean;
  user?: Partial<TerminalUser>;
};

function isExecutable(file: string) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function shellName(shell: string) {
  return path
    .basename(shell)
    .toLowerCase()
    .replace(/\.exe$/u, "");
}

function isInteractiveShell(shell: string) {
  return Boolean(shell) && !NON_INTERACTIVE_SHELLS.has(shellName(shell));
}

export function loginShellArgs(shell: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") return [];
  const name = shellName(shell);
  if (name === "powershell" || name === "pwsh" || name === "cmd") return [];
  return ["-l"];
}

export function resolveTerminalUser(env: NodeJS.ProcessEnv = process.env): TerminalUser {
  try {
    const info = os.userInfo();
    return {
      username: firstNonEmpty(info.username, env.USER, env.LOGNAME, "root"),
      home: firstNonEmpty(info.homedir, env.HOME, os.homedir()),
      loginShell: firstNonEmpty(info.shell ?? undefined, env.SHELL)
    };
  } catch {
    return {
      username: firstNonEmpty(env.USER, env.LOGNAME, "root"),
      home: firstNonEmpty(env.HOME, os.homedir()),
      loginShell: firstNonEmpty(env.SHELL)
    };
  }
}

export function resolveTerminalShell(options: ResolveOptions = {}): TerminalShell {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executable = options.executable ?? isExecutable;
  const override = env.CODEX_OMNI_SHELL?.trim();
  if (override) return { shell: override, args: loginShellArgs(override, platform) };

  if (platform === "win32") {
    const shell = firstNonEmpty(env.SHELL, env.COMSPEC, "powershell.exe");
    return { shell, args: [] };
  }

  const loginShell = options.user?.loginShell?.trim();
  const envShell = env.SHELL?.trim();
  const candidates = [
    loginShell && isInteractiveShell(loginShell) ? loginShell : "",
    envShell && isInteractiveShell(envShell) ? envShell : "",
    ...POSIX_SHELL_FALLBACKS
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (executable(candidate))
      return { shell: candidate, args: loginShellArgs(candidate, platform) };
  }

  const shell = firstNonEmpty(loginShell, envShell, "/bin/sh");
  return { shell, args: loginShellArgs(shell, platform) };
}

export function resolveTerminalRuntime(options: ResolveOptions = {}): TerminalRuntime {
  const user = {
    ...resolveTerminalUser(options.env),
    ...options.user
  };
  const { shell, args } = resolveTerminalShell({ ...options, user });
  return {
    username: firstNonEmpty(user.username, "root"),
    home: firstNonEmpty(user.home, os.homedir()),
    loginShell: firstNonEmpty(user.loginShell),
    shell,
    args
  };
}

export function buildTerminalEnv(input: {
  env?: NodeJS.ProcessEnv;
  shell: string;
  terminalId: string;
  home?: string;
  username?: string;
}): Record<string, string> {
  const env = input.env ?? process.env;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") next[key] = value;
  }
  const username = firstNonEmpty(input.username, env.USER, env.LOGNAME, "root");
  next.HOME = firstNonEmpty(input.home, env.HOME, os.homedir());
  next.USER = username;
  next.LOGNAME = username;
  next.SHELL = input.shell;
  next.TERM = "xterm-256color";
  next.COLORTERM = "truecolor";
  next.LANG = firstNonEmpty(env.LANG, env.LC_ALL, "C.UTF-8");
  next.CODEX_OMNI_TERMINAL_ID = input.terminalId;
  return next;
}
