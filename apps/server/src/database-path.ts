import { existsSync } from "node:fs";
import path from "node:path";

export const DEFAULT_DATABASE_FILE = "data/codex-omni.db";
const LEGACY_DATABASE_FILE = "data/codex-web.db";

export function resolveDatabasePath(cwd = process.cwd(), env: NodeJS.Dict<string> = process.env) {
  const configured = env.CODEX_OMNI_DATABASE?.trim();
  if (configured) return path.resolve(configured);
  const next = path.resolve(cwd, DEFAULT_DATABASE_FILE);
  const previous = path.resolve(cwd, LEGACY_DATABASE_FILE);
  if (!existsSync(next) && existsSync(previous)) return previous;
  return next;
}
