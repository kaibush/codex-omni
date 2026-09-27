import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "release", "codex-omni");

const serverPkg = JSON.parse(await readFile(path.join(root, "apps/server/package.json"), "utf8"));
const workspacePackages = await Promise.all(
  ["protocol", "db", "agent-runtime", "codex-runtime", "claude-runtime"].map(async (directory) => ({
    directory,
    manifest: JSON.parse(
      await readFile(path.join(root, "packages", directory, "package.json"), "utf8")
    )
  }))
);
const rootPkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function productionDeps(...pkgs) {
  const deps = {};
  for (const pkg of pkgs) {
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      if (name.startsWith("@codex-omni/")) continue;
      if (deps[name] && deps[name] !== version)
        throw new Error(
          `production dependency ${name} has conflicting versions: ${deps[name]} / ${version}`
        );
      deps[name] = version;
    }
  }
  return deps;
}

function skipTestArtifacts(src) {
  return !/\.test\.(js|d\.ts|js\.map)$/.test(src);
}

function bundledManifest(pkg) {
  return {
    name: pkg.name,
    version: pkg.version,
    type: "module",
    main: pkg.main,
    types: pkg.types,
    dependencies: Object.fromEntries(
      Object.entries(pkg.dependencies ?? {}).map(([name, version]) => {
        const internal = workspacePackages.find((item) => item.manifest.name === name);
        return [name, internal ? internal.manifest.version : version];
      })
    )
  };
}

console.log("building workspace packages...");
execSync("pnpm --filter @codex-omni/server... --filter @codex-omni/web... build", {
  cwd: root,
  stdio: "inherit"
});

const required = [
  path.join(root, "apps/server/dist/cli/codex-omni.js"),
  path.join(root, "apps/web/dist/index.html"),
  path.join(root, "packages/codex-runtime/dist/worker-entry.js"),
  path.join(root, "packages/claude-runtime/dist/worker-entry.js"),
  path.join(root, "packages/agent-runtime/dist/index.js")
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`missing build output: ${file}`);
}

await rm(out, { recursive: true, force: true });
for (const { directory, manifest } of workspacePackages) {
  const destination = path.join(out, "node_modules", manifest.name);
  await mkdir(destination, { recursive: true });
  await cp(path.join(root, "packages", directory, "dist"), path.join(destination, "dist"), {
    recursive: true,
    filter: skipTestArtifacts
  });
  await writeFile(
    path.join(destination, "package.json"),
    `${JSON.stringify(bundledManifest(manifest), null, 2)}\n`
  );
}
await cp(path.join(root, "apps/server/dist"), path.join(out, "dist"), {
  recursive: true,
  filter: skipTestArtifacts
});
await cp(path.join(root, "apps/web/dist"), path.join(out, "public"), { recursive: true });

const packed = {
  name: "@kaibush/codex-omni",
  version: rootPkg.version ?? serverPkg.version,
  description: "Codex 与 Claude Code 多客户端远程工作台：一条命令安装并启动服务",
  type: "module",
  bin: {
    "codex-omni": "dist/cli/codex-omni.js"
  },
  files: ["dist", "public", "README.md"],
  bundleDependencies: workspacePackages.map(({ manifest }) => manifest.name),
  engines: { node: ">=20" },
  publishConfig: {
    access: "public"
  },
  dependencies: {
    // npm treats bundled internal packages as already installed, so their
    // external dependencies must also be declared by the published package.
    ...productionDeps(serverPkg, ...workspacePackages.map(({ manifest }) => manifest)),
    ...Object.fromEntries(
      workspacePackages.map(({ manifest }) => [manifest.name, manifest.version])
    )
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
