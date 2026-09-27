import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { ClientType } from "@codex-omni/protocol";

/** Native history belongs to a client, never to a provider. */
export function clientRuntimeHome(
  client: ClientType,
  runtimeRoot: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const configured = client === "codex" ? env.CODEX_OMNI_CODEX_HOME : env.CODEX_OMNI_CLAUDE_HOME;
  if (configured?.trim()) {
    if (!path.isAbsolute(configured.trim())) throw new Error("客户端 HOME 必须是绝对路径");
    return path.resolve(configured.trim());
  }
  return path.resolve(runtimeRoot, "clients", client);
}

export async function ensureClientHome(client: ClientType, runtimeRoot: string) {
  const home = clientRuntimeHome(client, runtimeRoot);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return realpath(home);
}
