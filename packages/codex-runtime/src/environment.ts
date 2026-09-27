import type { BridgeRequest } from "@codex-omni/protocol";

export function workerEnvironment(request: BridgeRequest) {
  const keep = [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "WINDIR",
    "PATHEXT"
  ];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.CODEX_HOME = request.runtimeHome;
  for (const [key, value] of Object.entries(request.messageEnvVars ?? {})) {
    if (
      typeof value === "string" &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
      !["CODEX_HOME", "CLAUDE_CONFIG_DIR", "HOME"].includes(key)
    ) {
      env[key] = value;
    }
  }
  return env;
}
