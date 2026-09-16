import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64"
};

type PackageJson = {
  name?: string;
  version?: string;
};

type ResolvedPackage = {
  root: string;
  pkgPath: string;
  pkg: PackageJson;
};

function readPackageJson(filePath: string): PackageJson | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as PackageJson;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function findPackageRoot(startFile: string, packageName: string): ResolvedPackage | null {
  let dir = path.dirname(startFile);
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    const pkg = existsSync(pkgPath) ? readPackageJson(pkgPath) : null;
    if (pkg?.name === packageName) return { root: dir, pkgPath, pkg };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveFromAncestors(packageName: string, fromFile: string): ResolvedPackage | null {
  let dir = path.dirname(fromFile);
  const parts = packageName.split("/");
  while (true) {
    const pkgPath = path.join(dir, "node_modules", ...parts, "package.json");
    const pkg = existsSync(pkgPath) ? readPackageJson(pkgPath) : null;
    if (pkg?.name === packageName) return { root: path.dirname(pkgPath), pkgPath, pkg };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function bundledSdkPackage(): ResolvedPackage | null {
  const fromFile = fileURLToPath(import.meta.url);
  const resolvedPath = (() => {
    try {
      const resolved = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
      return existsSync(resolved) ? resolved : "";
    } catch {
      return "";
    }
  })();
  return (
    (resolvedPath ? findPackageRoot(resolvedPath, "@openai/codex-sdk") : null) ??
    resolveFromAncestors("@openai/codex-sdk", fromFile) ??
    resolveFromAncestors("@openai/codex-sdk", path.join(process.cwd(), "package.json"))
  );
}

function bundledCliPackage(sdkPkgPath: string): ResolvedPackage | null {
  try {
    const cliPkgPath = createRequire(sdkPkgPath).resolve("@openai/codex/package.json");
    const pkg = readPackageJson(cliPkgPath);
    if (!pkg) return null;
    return { root: path.dirname(cliPkgPath), pkgPath: cliPkgPath, pkg };
  } catch {
    return null;
  }
}

function targetTriple() {
  const { platform, arch } = process;
  if (platform === "linux" || platform === "android") {
    if (arch === "x64") return "x86_64-unknown-linux-musl";
    if (arch === "arm64") return "aarch64-unknown-linux-musl";
  }
  if (platform === "darwin") {
    if (arch === "x64") return "x86_64-apple-darwin";
    if (arch === "arm64") return "aarch64-apple-darwin";
  }
  if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc";
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
  }
  return "";
}

export type BundledCodexVersions = {
  sdkVersion: string;
  cliVersion: string;
};

export function bundledCodexVersions(): BundledCodexVersions {
  const sdk = bundledSdkPackage();
  const cli = sdk ? bundledCliPackage(sdk.pkgPath) : null;
  const sdkVersion = sdk?.pkg.version?.trim() ?? "";
  const cliVersion = cli?.pkg.version?.trim() || sdkVersion;
  return { sdkVersion, cliVersion };
}

export function bundledCodexCliPath() {
  const triple = targetTriple();
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple];
  const sdk = bundledSdkPackage();
  if (!triple || !platformPackage || !sdk) return "";
  const cli = bundledCliPackage(sdk.pkgPath);
  if (!cli) return "";
  try {
    const platformPackageJsonPath = createRequire(cli.pkgPath).resolve(
      `${platformPackage}/package.json`
    );
    const vendorRoot = path.join(path.dirname(platformPackageJsonPath), "vendor");
    const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
    const current = path.join(vendorRoot, triple, "bin", binaryName);
    if (existsSync(current)) return current;
    const legacy = path.join(vendorRoot, triple, "codex", binaryName);
    return existsSync(legacy) ? legacy : "";
  } catch {
    return "";
  }
}
