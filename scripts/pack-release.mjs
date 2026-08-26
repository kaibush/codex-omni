import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "release", "codex-omni");

const serverPkg = JSON.parse(await readFile(path.join(root, "apps/server/package.json"), "utf8"));
const runtimePkg = JSON.parse(await readFile(path.join(root, "packages/codex-runtime/package.json"), "utf8"));
const dbPkg = JSON.parse(await readFile(path.join(root, "packages/db/package.json"), "utf8"));
const protocolPkg = JSON.parse(await readFile(path.join(root, "packages/protocol/package.json"), "utf8"));
const rootPkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function productionDeps(...pkgs) {
  const deps = {};
  for (const pkg of pkgs) {
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      if (name.startsWith("@codex-omni/") || name === "typescript") continue;
      deps[name] = version;
    }
  }
  return deps;
}

function skipTestArtifacts(src) {
  return !/\.test\.(js|d\.ts|js\.map)$/.test(src);
}

function vendorManifest(pkg, extraDeps = {}) {
  return {
    name: pkg.name,
    version: pkg.version,
    type: "module",
    main: pkg.main,
    types: pkg.types,
    dependencies: extraDeps
  };
}

console.log("building workspace packages...");
execSync(
  "pnpm --filter @codex-omni/protocol --filter @codex-omni/db --filter @codex-omni/codex-runtime --filter @codex-omni/server --filter @codex-omni/web build",
  { cwd: root, stdio: "inherit" }
);

const required = [
  path.join(root, "apps/server/dist/cli/codex-omni.js"),
  path.join(root, "apps/web/dist/index.html"),
  path.join(root, "packages/codex-runtime/dist/worker-entry.js")
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`missing build output: ${file}`);
}

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "vendor/protocol/dist"), { recursive: true, filter: skipTestArtifacts });
await mkdir(path.join(out, "vendor/db/dist"), { recursive: true, filter: skipTestArtifacts });
await mkdir(path.join(out, "vendor/codex-runtime/dist"), { recursive: true, filter: skipTestArtifacts });

await cp(path.join(root, "packages/protocol/dist"), path.join(out, "vendor/protocol/dist"), { recursive: true });
await cp(path.join(root, "packages/db/dist"), path.join(out, "vendor/db/dist"), { recursive: true });
await cp(path.join(root, "packages/codex-runtime/dist"), path.join(out, "vendor/codex-runtime/dist"), {
  recursive: true
});
await cp(path.join(root, "apps/server/dist"), path.join(out, "dist"), { recursive: true, filter: skipTestArtifacts });
await cp(path.join(root, "apps/web/dist"), path.join(out, "public"), { recursive: true });

await writeFile(
  path.join(out, "vendor/protocol/package.json"),
  `${JSON.stringify(vendorManifest(protocolPkg, { zod: protocolPkg.dependencies.zod }), null, 2)}\n`
);
await writeFile(
  path.join(out, "vendor/db/package.json"),
  `${JSON.stringify(
    vendorManifest(dbPkg, {
      "better-sqlite3": dbPkg.dependencies["better-sqlite3"],
      nanoid: dbPkg.dependencies.nanoid
    }),
    null,
    2
  )}\n`
);
await writeFile(
  path.join(out, "vendor/codex-runtime/package.json"),
  `${JSON.stringify(
    vendorManifest(runtimePkg, {
      "@codex-omni/protocol": "file:../protocol",
      "@openai/codex-sdk": runtimePkg.dependencies["@openai/codex-sdk"],
      nanoid: runtimePkg.dependencies.nanoid,
      zod: runtimePkg.dependencies.zod
    }),
    null,
    2
  )}\n`
);

const packed = {
  name: "@kaibush/codex-omni",
  version: rootPkg.version ?? serverPkg.version,
  description: "Codex Omni 远程工作台：一条命令安装并启动服务",
  type: "module",
  bin: {
    "codex-omni": "dist/cli/codex-omni.js"
  },
  files: ["dist", "public", "vendor", "README.md"],
  engines: { node: ">=20" },
  publishConfig: {
    access: "public"
  },
  dependencies: {
    ...productionDeps(serverPkg, runtimePkg, dbPkg, protocolPkg),
    "@codex-omni/protocol": "file:./vendor/protocol",
    "@codex-omni/db": "file:./vendor/db",
    "@codex-omni/codex-runtime": "file:./vendor/codex-runtime"
  }
};

await writeFile(path.join(out, "package.json"), `${JSON.stringify(packed, null, 2)}\n`);
await writeFile(
  path.join(out, "README.md"),
  `# Codex Omni

\`\`\`bash
npm i -g @kaibush/codex-omni
codex-omni
\`\`\`

浏览器打开 http://localhost:8790
`
);

execSync("chmod +x dist/cli/codex-omni.js", { cwd: out });
execSync("npm pack --pack-destination ..", { cwd: out, stdio: "inherit" });
const npmTarball = path.join(
  root,
  "release",
  `${packed.name.replace(/^@/, "").replace("/", "-")}-${packed.version}.tgz`
);
const tarball = path.join(root, "release", `codex-omni-${packed.version}.tgz`);
if (!existsSync(npmTarball)) throw new Error(`missing packed tarball: ${npmTarball}`);
await rm(tarball, { force: true });
await rename(npmTarball, tarball);
console.log(`\npacked: release/codex-omni-${packed.version}.tgz`);
console.log("npm:     npm i -g @kaibush/codex-omni");
console.log(`install: npm i -g ./release/codex-omni-${packed.version}.tgz`);
console.log("start:   codex-omni");
