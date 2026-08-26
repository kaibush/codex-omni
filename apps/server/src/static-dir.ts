import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveStaticDir(
  here = path.dirname(fileURLToPath(import.meta.url)),
  env = process.env
) {
  const configured = env.CODEX_OMNI_STATIC?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    return existsSync(path.join(resolved, "index.html")) ? resolved : "";
  }
  const candidates = [
    path.resolve(here, "../public"),
    path.resolve(here, "../../web/dist")
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "index.html"))) ?? "";
}
