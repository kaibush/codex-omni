import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BridgeRequest } from "@codex-omni/protocol";

export async function materializeProviderHome(
  root: string,
  providerId: string,
  configToml: string | null,
  authJson: string | null
) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(providerId) || providerId.includes(".."))
    throw new Error("Invalid provider id");
  const home = path.join(root, providerId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (configToml?.trim()) {
    await writeFile(path.join(home, "config.toml"), configToml, { mode: 0o600 });
    await chmod(path.join(home, "config.toml"), 0o600);
  }
  if (authJson?.trim()) {
    JSON.parse(authJson);
    await writeFile(path.join(home, "auth.json"), authJson, { mode: 0o600 });
    await chmod(path.join(home, "auth.json"), 0o600);
  }
  return home;
}

export async function assertExternalCodexHome(value: string | null | undefined) {
  const home = value?.trim() ?? "";
  if (!home) throw new Error("请填写已有 CODEX_HOME 路径");
  if (!path.isAbsolute(home)) throw new Error("CODEX_HOME 必须是绝对路径");
  if (home.includes("\0") || home.split(path.sep).includes(".."))
    throw new Error("CODEX_HOME 路径无效");
  const info = await stat(home).catch(() => null);
  if (!info?.isDirectory()) throw new Error("CODEX_HOME 目录不存在");
  return path.resolve(home);
}

export async function resolveProviderHome(input: {
  providersRoot: string;
  providerId: string;
  homeMode?: string | null;
  codexHomePath?: string | null;
  configToml?: string | null;
  authJson?: string | null;
}) {
  if (input.homeMode === "external") return assertExternalCodexHome(input.codexHomePath);
  return materializeProviderHome(
    input.providersRoot,
    input.providerId,
    input.configToml ?? null,
    input.authJson ?? null
  );
}

export function runtimeKey(projectId: string, providerId: string) {
  return `codex::${projectId}::${providerId}`;
}
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
  env.CODEX_HOME = request.codexHome;
  for (const [key, value] of Object.entries(request.messageEnvVars ?? {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && key !== "CODEX_HOME") env[key] = value;
  }
  return env;
}
