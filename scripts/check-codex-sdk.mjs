import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePkg = JSON.parse(
  await readFile(path.join(root, "packages/codex-runtime/package.json"), "utf8")
);
const pin = String(runtimePkg.dependencies?.["@openai/codex-sdk"] ?? "").trim();
if (!/^\d+\.\d+\.\d+$/.test(pin)) {
  throw new Error(`@openai/codex-sdk 必须钉死稳定版，当前是 ${pin || "空"}`);
}

try {
  const sdkPkg = JSON.parse(
    await readFile(
      path.join(root, "packages/codex-runtime/node_modules/@openai/codex-sdk/package.json"),
      "utf8"
    )
  );
  const cliDep = String(sdkPkg.dependencies?.["@openai/codex"] ?? "").trim();
  if (cliDep && cliDep !== pin) {
    throw new Error(`@openai/codex-sdk@${pin} 依赖 @openai/codex@${cliDep}，必须同版本`);
  }
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    console.warn("check-codex-sdk: 未安装 @openai/codex-sdk，跳过 CLI 同版本检查");
  } else {
    throw error;
  }
}

const response = await fetch("https://registry.npmjs.org/@openai/codex-sdk/latest", {
  headers: { Accept: "application/json", "User-Agent": "CodexOmni" },
  signal: AbortSignal.timeout(10_000)
});
if (!response.ok) {
  console.warn(`check-codex-sdk: npm registry HTTP ${response.status}，跳过最新版本比较`);
  process.exit(0);
}
const payload = await response.json();
const latest = String(payload.version ?? "").trim();
if (!latest || latest.includes("-")) {
  console.warn(`check-codex-sdk: npm latest 不是稳定版（${latest || "空"}），跳过`);
  process.exit(0);
}

const parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};
const current = parse(pin);
const remote = parse(latest);
if (!current || !remote) {
  throw new Error(`无法比较 Codex SDK 版本：pin=${pin} latest=${latest}`);
}

const majorDiff = remote.major !== current.major;
const minorDiff = Math.abs(remote.minor - current.minor);
console.log(`Codex SDK pin ${pin} · npm latest ${latest}`);
if (majorDiff || minorDiff >= 2) {
  throw new Error(
    `@openai/codex-sdk 落后过多：当前 ${pin}，npm 最新稳定版 ${latest}。请升级并保持 @openai/codex 同版本。`
  );
}
if (pin !== latest) {
  console.warn(`Codex SDK 有新稳定版 ${latest}，当前钉死 ${pin}。`);
}
