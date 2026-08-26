import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "0.1.0";

function readPackageVersion(here = path.dirname(fileURLToPath(import.meta.url))) {
  const candidates = [
    path.resolve(here, "../package.json"),
    path.resolve(here, "../../../package.json")
  ];
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
      const version = pkg.version?.trim();
      if (version) return version;
    } catch {
      continue;
    }
  }
  return "";
}

export function normalizeVersion(value: string) {
  const version = String(value ?? "").trim();
  if (!version) return "";
  if (version.toLowerCase() === "dev") return "dev";
  return version.toLowerCase().startsWith("v") ? version : `v${version}`;
}

export function resolveAppVersion(env: NodeJS.Dict<string> = process.env) {
  const injected = env.CODEX_OMNI_VERSION?.trim();
  if (injected) return injected;
  return readPackageVersion() || FALLBACK_VERSION;
}

export function currentAppVersion(env: NodeJS.Dict<string> = process.env) {
  return normalizeVersion(resolveAppVersion(env)) || normalizeVersion(FALLBACK_VERSION);
}
