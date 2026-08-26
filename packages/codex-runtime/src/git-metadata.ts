import { spawnSync } from "node:child_process";
import path from "node:path";

export function gitMetadataWritableRoots(cwd: string) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const result = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
    {
      cwd,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"]
    }
  );
  if (result.status !== 0 || result.error) return [];
  return [
    ...new Set(
      result.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => path.resolve(cwd, value))
    )
  ];
}
