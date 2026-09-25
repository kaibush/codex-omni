import Database from "better-sqlite3";
import { readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SQLITE_CLEANUP: Array<{
  pattern: RegExp;
  tables: Array<{ table: string; columns: string[] }>;
}> = [
  {
    pattern: /^thread_history_\d+\.sqlite$/,
    tables: [
      { table: "thread_turns", columns: ["thread_id"] },
      { table: "thread_items", columns: ["thread_id"] },
      { table: "thread_history_projection_state", columns: ["thread_id"] },
      { table: "thread_realtime_items", columns: ["thread_id"] }
    ]
  },
  {
    pattern: /^state_\d+\.sqlite$/,
    tables: [
      { table: "thread_dynamic_tools", columns: ["thread_id"] },
      { table: "thread_attachments", columns: ["thread_id"] },
      { table: "thread_spawn_edges", columns: ["parent_thread_id", "child_thread_id"] },
      { table: "threads", columns: ["id"] }
    ]
  },
  {
    pattern: /^goals_\d+\.sqlite$/,
    tables: [
      { table: "thread_goals", columns: ["thread_id"] },
      { table: "thread_goal_continuation_deferrals", columns: ["thread_id"] }
    ]
  },
  {
    pattern: /^memories_\d+\.sqlite$/,
    tables: [{ table: "stage1_outputs", columns: ["thread_id"] }]
  },
  {
    pattern: /^queue_\d+\.sqlite$/,
    tables: [
      { table: "queued_items", columns: ["thread_id"] },
      { table: "queued_thread_revisions", columns: ["thread_id"] }
    ]
  }
];

export function isCodexThreadId(value: string) {
  return THREAD_ID.test(value);
}

function insideRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

async function fileSize(file: string) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function safeUnlink(root: string, file: string) {
  let real = "";
  try {
    real = await realpath(file);
  } catch {
    return -1;
  }
  if (!insideRoot(root, real)) return -1;
  const size = await fileSize(real);
  await rm(real, { force: true });
  return size;
}

async function walkFiles(dir: string, visit: (file: string, name: string) => void | Promise<void>) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, visit);
    else if (entry.isFile()) await visit(full, entry.name);
  }
}

function quoteIdent(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Invalid SQL identifier");
  return value;
}

function rolloutThreadId(name: string) {
  if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) return "";
  const stem = name.slice(0, -".jsonl".length);
  const id = stem.slice(-36);
  return stem.endsWith(`-${id}`) && isCodexThreadId(id) ? id : "";
}

function snapshotThreadId(name: string) {
  const id = name.slice(0, 36);
  return name.startsWith(`${id}.`) && name.endsWith(".sh") && isCodexThreadId(id) ? id : "";
}

function purgeSqlite(file: string, threadIds: string[]) {
  const db = new Database(file, { fileMustExist: true, timeout: 800 });
  let changed = 0;
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    );
    const plan = SQLITE_CLEANUP.find((item) => item.pattern.test(path.basename(file)));
    if (!plan) return 0;
    const removeRows = db.transaction((ids: string[]) => {
      let count = 0;
      for (const spec of plan.tables) {
        if (!tables.has(spec.table)) continue;
        const columns = new Set(
          (db.prepare(`PRAGMA table_info(${quoteIdent(spec.table)})`).all() as Array<{ name: string }>).map(
            (row) => row.name
          )
        );
        const usable = spec.columns.filter((column) => columns.has(column));
        if (!usable.length) continue;
        const where = usable.map((column) => `${quoteIdent(column)}=?`).join(" OR ");
        const statement = db.prepare(`DELETE FROM ${quoteIdent(spec.table)} WHERE ${where}`);
        for (const id of ids) count += statement.run(...usable.map(() => id)).changes;
      }
      return count;
    });
    changed = removeRows(threadIds);
    if (!changed) return 0;
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // The provider may still have the database open.
    }
    try {
      db.exec("VACUUM");
    } catch {
      // Exclusive lock is optional; deleted rows still stop the data from being reused.
    }
    return changed;
  } finally {
    db.close();
  }
}

export async function purgeProviderThreads(codexHome: string, threadIds: string[]) {
  const ids = new Set(threadIds.filter(isCodexThreadId));
  if (!ids.size) return { files: 0, bytes: 0 };
  let root = "";
  try {
    root = await realpath(codexHome);
  } catch {
    return { files: 0, bytes: 0 };
  }
  let files = 0;
  let bytes = 0;
  const removeFile = async (file: string) => {
    const size = await safeUnlink(root, file);
    if (size < 0) return;
    files += 1;
    bytes += size;
  };
  for (const dirName of ["sessions", "archived_sessions"]) {
    await walkFiles(path.join(root, dirName), async (file, name) => {
      const threadId = rolloutThreadId(name);
      if (threadId && ids.has(threadId)) await removeFile(file);
    });
  }
  await walkFiles(path.join(root, "shell_snapshots"), async (file, name) => {
    const threadId = snapshotThreadId(name);
    if (threadId && ids.has(threadId)) await removeFile(file);
  });
  let lockNames: string[] = [];
  try {
    lockNames = await readdir(path.join(root, "thread-writer-locks"));
  } catch {
    lockNames = [];
  }
  for (const name of lockNames) {
    const threadId = name.slice(0, 36);
    if (name === `${threadId}.lock` && ids.has(threadId)) {
      await removeFile(path.join(root, "thread-writer-locks", name));
    }
  }
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!SQLITE_CLEANUP.some((item) => item.pattern.test(name))) continue;
    const file = path.join(root, name);
    const before = (await fileSize(file)) + (await fileSize(`${file}-wal`)) + (await fileSize(`${file}-shm`));
    try {
      const changed = purgeSqlite(file, [...ids]);
      if (!changed) continue;
      const after = (await fileSize(file)) + (await fileSize(`${file}-wal`)) + (await fileSize(`${file}-shm`));
      const saved = Math.max(0, before - after);
      if (saved > 0) {
        files += 1;
        bytes += saved;
      }
    } catch {
      // Ignore locked or unreadable provider databases.
    }
  }
  return { files, bytes };
}

export async function purgeProviderThread(codexHome: string, threadId: string) {
  return purgeProviderThreads(codexHome, [threadId]);
}
