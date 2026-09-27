import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

type Resource = {
  name: string;
  description: string;
  path: string;
  source: "project" | "provider";
  kind: "agent" | "command";
};

export async function listClaudeResources(projectRoot: string, configHome: string) {
  const resources: Resource[] = [];
  for (const [root, source] of [
    [path.join(projectRoot, ".claude"), "project"],
    [configHome, "provider"]
  ] as const) {
    for (const [folder, kind] of [
      ["agents", "agent"],
      ["commands", "command"]
    ] as const) {
      const visit = async (directory: string, prefix = "", depth = 0) => {
        if (depth > 4 || resources.length >= 200) return;
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (resources.length >= 200) break;
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(target, `${prefix}${entry.name}:`, depth + 1);
          else if (entry.isFile() && entry.name.endsWith(".md")) {
            if ((await stat(target)).size > 200_000) continue;
            const content = await readFile(target, "utf8").catch(() => "");
            resources.push({
              name: prefix + entry.name.slice(0, -3),
              description: content.match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim() ?? "",
              path: target,
              source,
              kind
            });
          }
        }
      };
      await visit(path.join(root, folder));
    }
  }
  return resources;
}
