import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export function claudeRuntimeInfo() {
  const entry = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
  const pkg = JSON.parse(readFileSync(path.join(path.dirname(entry), "package.json"), "utf8")) as {
    version: string;
    claudeCodeVersion?: string;
  };
  return { sdkVersion: pkg.version, bundledCliVersion: pkg.claudeCodeVersion ?? null };
}
