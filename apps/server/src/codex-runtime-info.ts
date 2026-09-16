import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bundledCodexVersions } from "@codex-omni/codex-runtime";
import { ReleaseVersion } from "./update-check.js";

const execFileAsync = promisify(execFile);
const NPM_PACKAGE = "@openai/codex-sdk";
const NPM_LATEST_URL = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`;
const NPM_CACHE_MS = 60 * 60 * 1000;
const PATH_CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

export type CodexRuntimeInfo = {
  sdkVersion: string;
  bundledCliVersion: string;
  pathCliVersion: string | null;
  npmLatestVersion: string | null;
  npmLatestCheckedAt: string | null;
  warnings: string[];
};

type VersionParts = { major: number; minor: number; patch: number };

let pathCache: { at: number; version: string | null } | undefined;
let npmCache: { at: number; version: string | null; checkedAt: string } | undefined;

function parseCodexCliVersion(output: string) {
  const match = output.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match?.[1] ?? "";
}

function parseVersionParts(value: string | null | undefined): VersionParts | null {
  if (!value?.trim()) return null;
  try {
    const parsed = ReleaseVersion.parse(value);
    return { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
  } catch {
    return null;
  }
}

export function isLargeCodexVersionDrift(left: string | null, right: string | null) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  if (!a || !b) return false;
  if (a.major !== b.major) return true;
  return Math.abs(a.minor - b.minor) >= 2;
}

export function buildCodexVersionWarnings(input: {
  sdkVersion: string;
  bundledCliVersion: string;
  pathCliVersion: string | null;
  npmLatestVersion: string | null;
}) {
  const warnings: string[] = [];
  if (input.sdkVersion && input.bundledCliVersion && input.sdkVersion !== input.bundledCliVersion) {
    warnings.push(
      `内置 Codex SDK ${input.sdkVersion} 与内置 CLI ${input.bundledCliVersion} 不一致，子 agent 可能异常。`
    );
  }
  if (
    input.pathCliVersion &&
    isLargeCodexVersionDrift(input.bundledCliVersion, input.pathCliVersion)
  ) {
    warnings.push(
      `PATH 上的 codex 是 ${input.pathCliVersion}，工作台内置 CLI 是 ${input.bundledCliVersion}。对话实际使用内置 CLI；版本差过大时请升级工作台或不要依赖 PATH 上的旧 CLI。`
    );
  }
  if (
    input.npmLatestVersion &&
    isLargeCodexVersionDrift(input.sdkVersion, input.npmLatestVersion)
  ) {
    warnings.push(
      `npm 最新稳定版 @openai/codex-sdk 是 ${input.npmLatestVersion}，当前内置 ${input.sdkVersion}。差异较大时建议升级工作台依赖。`
    );
  }
  return warnings;
}

async function readPathCodexVersion() {
  const now = Date.now();
  if (pathCache && now - pathCache.at < PATH_CACHE_MS) return pathCache.version;
  try {
    const result = await execFileAsync("codex", ["--version"], {
      timeout: 3_000,
      encoding: "utf8"
    });
    const version = parseCodexCliVersion(`${result.stdout}\n${result.stderr}`) || null;
    pathCache = { at: now, version };
    return version;
  } catch {
    pathCache = { at: now, version: null };
    return null;
  }
}

async function readNpmLatestVersion() {
  const now = Date.now();
  if (npmCache && now - npmCache.at < NPM_CACHE_MS) {
    return { version: npmCache.version, checkedAt: npmCache.checkedAt };
  }
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(NPM_LATEST_URL, {
      headers: { Accept: "application/json", "User-Agent": "CodexOmni" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { version?: unknown };
    const version = typeof payload.version === "string" ? payload.version.trim() : "";
    const stable = version && !version.includes("-") ? version : null;
    npmCache = { at: now, version: stable, checkedAt };
    return { version: stable, checkedAt };
  } catch {
    if (npmCache) return { version: npmCache.version, checkedAt: npmCache.checkedAt };
    return { version: null, checkedAt };
  }
}

export async function collectCodexRuntimeInfo(): Promise<CodexRuntimeInfo> {
  const bundled = bundledCodexVersions();
  const [pathCliVersion, npmLatest] = await Promise.all([
    readPathCodexVersion(),
    readNpmLatestVersion()
  ]);
  const info = {
    sdkVersion: bundled.sdkVersion,
    bundledCliVersion: bundled.cliVersion,
    pathCliVersion,
    npmLatestVersion: npmLatest.version,
    npmLatestCheckedAt: npmLatest.checkedAt,
    warnings: [] as string[]
  };
  info.warnings = buildCodexVersionWarnings(info);
  return info;
}
