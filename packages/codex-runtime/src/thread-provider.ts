import Database from "better-sqlite3";
import { closeSync, openSync, readFileSync, readdirSync, readSync } from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { findRolloutFile } from "./collab-rollout.js";

export function nativeCodexConfig(home: string): Record<string, unknown> {
  try {
    return parse(readFileSync(path.join(home, "config.toml"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    // Parser diagnostics may contain credentials from the source line.
    throw new Error("无法读取客户端 config.toml，请检查文件权限和 TOML 格式");
  }
}

function stateFiles(home: string, config: Record<string, unknown>) {
  const sqliteHome =
    typeof config.sqlite_home === "string" ? path.resolve(home, config.sqlite_home) : home;
  let files: string[] = [];
  try {
    files = readdirSync(sqliteHome)
      .filter((file) => /^state_\d+\.sqlite$/.test(file))
      .sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]))
      .map((file) => path.join(sqliteHome, file));
  } catch {
    // Legacy/imported sessions may only have a rollout file.
  }
  return files;
}

export function migrateThreadModelProvider(
  home: string,
  threadId: string,
  config: Record<string, unknown>,
  previous: string,
  next: string
) {
  // The user selected a different route in Omni. Codex 0.166 requires its
  // persisted provider identity to match before it will resume that thread.
  // Change only this metadata; transcripts and native config/auth stay intact.
  for (const file of stateFiles(home, config)) {
    const db = new Database(file, { fileMustExist: true, timeout: 1000 });
    try {
      const row = db.prepare("SELECT model_provider FROM threads WHERE id = ?").get(threadId) as
        { model_provider: string } | undefined;
      if (!row) continue;
      if (row.model_provider === next) return;
      if (row.model_provider !== previous) break;
      const changed = db
        .prepare("UPDATE threads SET model_provider = ? WHERE id = ? AND model_provider = ?")
        .run(next, threadId, previous);
      if (changed.changes === 1) return;
      break;
    } finally {
      db.close();
    }
  }
  throw new Error("无法更新 Codex 会话的供应商标识，请确认会话未被其他客户端修改后重试");
}

export function threadModelProvider(
  home: string,
  threadId: string | undefined,
  config: Record<string, unknown>
): string | undefined {
  if (!threadId) return undefined;
  for (const file of stateFiles(home, config)) {
    const db = new Database(file, {
      readonly: true,
      fileMustExist: true,
      timeout: 1000
    });
    try {
      // This is the latest provider, which can differ from the rollout's
      // original session_meta after a pre-0.166 provider switch.
      const row = db.prepare("SELECT model_provider FROM threads WHERE id = ?").get(threadId) as
        { model_provider?: unknown } | undefined;
      if (typeof row?.model_provider === "string" && row.model_provider.trim()) {
        return row.model_provider.trim();
      }
    } finally {
      db.close();
    }
  }
  const file = findRolloutFile(home, threadId);
  if (!file) return undefined;
  const fd = openSync(file, "r");
  try {
    const chunks: Buffer[] = [];
    for (let size = 0; size < 1024 * 1024;) {
      const buffer = Buffer.alloc(16 * 1024);
      const length = readSync(fd, buffer);
      if (!length) break;
      const newline = buffer.subarray(0, length).indexOf(10);
      chunks.push(buffer.subarray(0, newline < 0 ? length : newline));
      size += length;
      if (newline >= 0) {
        const record = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const provider =
          record.type === "session_meta" && record.payload?.id === threadId
            ? record.payload.model_provider
            : undefined;
        return typeof provider === "string" && provider.trim() ? provider.trim() : undefined;
      }
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}
