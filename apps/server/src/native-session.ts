import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  utimes
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ClientType } from "@codex-omni/protocol";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missingSession = () =>
  new Error("找不到原生会话文件，无法在当前对话恢复；请检查原供应商目录，或新建续接对话");
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

async function filesUnder(root: string, relative: string): Promise<string[]> {
  const directory = path.join(root, relative);
  const info = await lstat(directory).catch(() => null);
  if (!info) return [];
  if (info.isSymbolicLink()) throw new Error("原生会话目录包含符号链接，无法安全迁移");
  if (!info.isDirectory()) return info.isFile() ? [relative] : [];
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(root, file)));
    else if (entry.isFile() && !entry.name.endsWith(".lock")) result.push(file);
  }
  return result;
}

async function firstRecord(file: string) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const first = buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0]!;
    try {
      return record(JSON.parse(first));
    } catch {
      return undefined;
    }
  } finally {
    await handle.close();
  }
}

async function safeDestination(root: string, relative: string) {
  const destination = path.resolve(root, relative);
  if (!inside(root, destination) || destination === root) throw new Error("原生会话路径无效");
  let current = root;
  for (const part of path
    .relative(root, path.dirname(destination))
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("目标会话目录包含符号链接或非目录文件");
  }
  const existing = await lstat(destination).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new Error("目标原生会话路径不是普通文件");
  return destination;
}

async function copyNativeFile(source: string, target: string, relative: string) {
  const file = path.join(source, relative);
  const info = await lstat(file);
  if (!info.isFile() || !inside(source, await realpath(file))) throw new Error("原生会话路径无效");
  const destination = await safeDestination(target, relative);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(file, temporary);
    await chmod(temporary, 0o600);
    await utimes(temporary, info.atime, info.mtime);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

type NativeTable = { name: string; keys: string[] };
const CODEX_DATABASES: Array<{ pattern: RegExp; tables: NativeTable[] }> = [
  {
    pattern: /^state_\d+\.sqlite$/,
    tables: [
      { name: "threads", keys: ["id"] },
      { name: "thread_dynamic_tools", keys: ["thread_id"] },
      { name: "thread_attachments", keys: ["thread_id"] },
      { name: "thread_spawn_edges", keys: ["parent_thread_id", "child_thread_id"] }
    ]
  },
  {
    pattern: /^goals_\d+\.sqlite$/,
    tables: [
      { name: "thread_goals", keys: ["thread_id"] },
      { name: "thread_goal_continuation_deferrals", keys: ["thread_id"] }
    ]
  },
  {
    pattern: /^thread_history_\d+\.sqlite$/,
    tables: [
      { name: "thread_turns", keys: ["thread_id"] },
      { name: "thread_items", keys: ["thread_id"] },
      { name: "thread_history_projection_state", keys: ["thread_id"] },
      { name: "thread_realtime_items", keys: ["thread_id"] }
    ]
  }
];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const tableColumns = (db: Database.Database, table: string) =>
  db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string; pk: number }>;

// Merge only this conversation's rows. Copying a whole SQLite file would
// overwrite unrelated conversations and can lose data from a live WAL.
function copyCodexDatabase(
  sourceFile: string,
  targetFile: string,
  tables: NativeTable[],
  rollouts: Map<string, string>,
  targetHome: string
) {
  const ids = [...rollouts.keys()];
  const source = new Database(sourceFile, { readonly: true, fileMustExist: true, timeout: 2000 });
  try {
    const target = new Database(targetFile, { timeout: 2000 });
    try {
      const schema = source
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END"
        )
        .all() as Array<{ type: string; name: string; sql: string }>;
      const initialized = Boolean(
        target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get()
      );
      target.transaction(() => {
        if (!initialized) {
          for (const item of schema) target.exec(item.sql);
          target.pragma(
            `user_version = ${Number(source.pragma("user_version", { simple: true }))}`
          );
          if (schema.some((item) => item.name === "_sqlx_migrations")) {
            const columns = tableColumns(source, "_sqlx_migrations").map((column) => column.name);
            const insert = target.prepare(
              `INSERT INTO _sqlx_migrations (${columns.map(quote)}) VALUES (${columns.map(() => "?")})`
            );
            for (const row of source.prepare("SELECT * FROM _sqlx_migrations").all() as Record<
              string,
              unknown
            >[])
              insert.run(...columns.map((column) => row[column]));
          }
        }
        for (const table of tables) {
          const columns = tableColumns(source, table.name);
          if (!columns.length) continue;
          const targetColumns = tableColumns(target, table.name);
          if (
            columns.length !== targetColumns.length ||
            columns.some((column, index) => column.name !== targetColumns[index]?.name)
          )
            throw new Error("Codex 原生状态数据库版本不一致，请升级客户端后重试，或新建续接对话");
          const keys = table.keys.filter((key) => columns.some((column) => column.name === key));
          if (!keys.length) continue;
          const where = keys.map((key) => `${quote(key)} IN (${ids.map(() => "?")})`).join(" OR ");
          const parameters = keys.flatMap(() => ids);
          const rows = source
            .prepare(`SELECT * FROM ${quote(table.name)} WHERE ${where}`)
            .all(...parameters) as Record<string, unknown>[];
          target.prepare(`DELETE FROM ${quote(table.name)} WHERE ${where}`).run(...parameters);
          const names = columns.map((column) => column.name);
          // Plain INSERT deliberately rejects collisions with unrelated native
          // rows instead of replacing their primary keys.
          const insert = target.prepare(
            `INSERT INTO ${quote(table.name)} (${names.map(quote)}) VALUES (${names.map(() => "?")})`
          );
          for (const row of rows) {
            // The stored path may use a symlink alias for CODEX_HOME. Resolve it
            // from the copied thread, so the resumed worker never writes back
            // into a previous provider's home through an old absolute path.
            const rollout = rollouts.get(String(row.id));
            if (table.name === "threads" && rollout && typeof row.rollout_path === "string")
              row.rollout_path = path.join(targetHome, rollout);
            insert.run(...names.map((name) => row[name]));
          }
        }
      })();
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}

async function transferCodex(source: string, target: string, threadId: string) {
  const files = [
    ...(await filesUnder(source, "sessions")),
    ...(await filesUnder(source, "archived_sessions"))
  ];
  const rollouts: Array<{ file: string; id: string; parent?: string }> = [];
  for (const file of files) {
    const match = path.basename(file).match(/^rollout-.*-([0-9a-f-]{36})\.jsonl$/i);
    if (!match || !UUID.test(match[1]!)) continue;
    const metadata = record((await firstRecord(path.join(source, file)))?.payload);
    const origin = record(record(record(metadata?.source)?.subagent)?.thread_spawn);
    rollouts.push({
      file,
      id: match[1]!,
      ...(typeof origin?.parent_thread_id === "string" ? { parent: origin.parent_thread_id } : {})
    });
  }
  if (!rollouts.some((rollout) => rollout.id === threadId)) throw missingSession();
  const ids = new Set([threadId]);
  let previous = 0;
  while (previous !== ids.size) {
    previous = ids.size;
    for (const rollout of rollouts)
      if (rollout.parent && ids.has(rollout.parent)) ids.add(rollout.id);
  }
  const selected = rollouts.filter((rollout) => ids.has(rollout.id));
  const paths = new Map(selected.map((rollout) => [rollout.id, rollout.file]));
  if (paths.size !== selected.length)
    throw new Error("发现多个同 ID 的 Codex 原生会话，无法确定恢复来源，请检查原供应商目录");
  for (const rollout of selected) await copyNativeFile(source, target, rollout.file);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const spec = CODEX_DATABASES.find((item) => item.pattern.test(entry.name));
    if (!spec) continue;
    const destination = await safeDestination(target, entry.name);
    copyCodexDatabase(path.join(source, entry.name), destination, spec.tables, paths, target);
    await chmod(destination, 0o600);
  }
  return selected.length;
}

async function transferClaude(source: string, target: string, threadId: string) {
  const projects = path.join(source, "projects");
  const entries = await readdir(projects, { withFileTypes: true }).catch(() => []);
  const transcripts: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relative = path.join("projects", entry.name, `${threadId}.jsonl`);
    if ((await lstat(path.join(source, relative)).catch(() => null))?.isFile())
      transcripts.push(relative);
  }
  if (!transcripts.length) throw missingSession();
  if (transcripts.length !== 1)
    throw new Error("发现多个同 ID 的 Claude 原生会话，无法确定恢复来源，请检查原供应商目录");
  const transcript = transcripts[0]!;
  const files = new Set([
    transcript,
    ...(await filesUnder(source, transcript.slice(0, -".jsonl".length))),
    ...(await filesUnder(source, path.join("file-history", threadId))),
    ...(await filesUnder(source, path.join("tasks", threadId)))
  ]);
  for (const file of await filesUnder(source, "todos")) {
    const name = path.basename(file);
    if (name.startsWith(`${threadId}-`) && name.endsWith(".json")) files.add(file);
  }
  const lines = createInterface({
    input: createReadStream(path.join(source, transcript)),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    let entry: Record<string, unknown> | undefined;
    try {
      entry = record(JSON.parse(line));
    } catch {
      continue;
    }
    if (typeof entry?.slug === "string" && /^[a-zA-Z0-9_-]+$/.test(entry.slug)) {
      const plan = path.join("plans", `${entry.slug}.md`);
      if ((await lstat(path.join(source, plan)).catch(() => null))?.isFile()) files.add(plan);
    }
  }
  for (const file of files) await copyNativeFile(source, target, file);
  return files.size;
}

/** Preserve the native format and ID while changing only the provider HOME.
 * Authentication, settings, skills and shell environment snapshots stay with
 * their provider. The source is retained; callers advance runtimeHome only
 * after the complete transfer succeeds and before starting the next worker.
 */
export async function transferNativeSession(input: {
  clientType: ClientType;
  threadId: string;
  sourceHome: string;
  targetHome: string;
}) {
  if (!UUID.test(input.threadId)) throw new Error("原生会话 ID 无效，无法迁移；请新建续接对话");
  const source = await realpath(input.sourceHome).catch(() => {
    throw missingSession();
  });
  const target = await realpath(input.targetHome);
  if (source === target) return { files: 0 };
  const files =
    input.clientType === "codex"
      ? await transferCodex(source, target, input.threadId)
      : await transferClaude(source, target, input.threadId);
  return { files };
}
