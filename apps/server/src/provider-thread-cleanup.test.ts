import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { isCodexThreadId, purgeProviderThread } from "./provider-thread-cleanup.js";

const threadId = "01a01cc4-aed9-7b30-9079-7e3db56ee881";
const otherId = "01a02453-e30b-7181-b605-d8113d24af0c";
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("provider thread cleanup", () => {
  it("rejects thread ids that are not Codex rollout ids", () => {
    expect(isCodexThreadId(threadId)).toBe(true);
    expect(isCodexThreadId("../secrets")).toBe(false);
    expect(isCodexThreadId("")).toBe(false);
  });

  it("removes only the selected thread rollout, snapshot, and history rows", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "codex-thread-"));
    temps.push(home);
    const outside = await mkdtemp(path.join(os.tmpdir(), "codex-outside-"));
    temps.push(outside);
    const rolloutDir = path.join(home, "sessions", "2026", "09", "25");
    await mkdir(rolloutDir, { recursive: true });
    await mkdir(path.join(home, "shell_snapshots"), { recursive: true });
    await mkdir(path.join(home, "thread-writer-locks"), { recursive: true });
    const rollout = path.join(rolloutDir, `rollout-2026-09-25T00-00-00-${threadId}.jsonl`);
    const other = path.join(rolloutDir, `rollout-2026-09-25T00-00-01-${otherId}.jsonl`);
    const snapshot = path.join(home, "shell_snapshots", `${threadId}.123.sh`);
    const otherSnapshot = path.join(home, "shell_snapshots", `${otherId}.123.sh`);
    const lock = path.join(home, "thread-writer-locks", `${threadId}.lock`);
    const otherLock = path.join(home, "thread-writer-locks", `${otherId}.lock`);
    await writeFile(rollout, "rollout");
    await writeFile(other, "keep");
    await writeFile(snapshot, "snap");
    await writeFile(otherSnapshot, "keep-snap");
    await writeFile(lock, "lock");
    await writeFile(otherLock, "keep-lock");
    const outsideFile = path.join(outside, "secret.txt");
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, path.join(rolloutDir, `rollout-link-${threadId}.jsonl`));

    const history = path.join(home, "thread_history_1.sqlite");
    const db = new Database(history);
    db.exec("CREATE TABLE thread_items (thread_id TEXT, item_json TEXT)");
    db.prepare("INSERT INTO thread_items(thread_id, item_json) VALUES(?, ?)").run(threadId, "x".repeat(2000));
    db.prepare("INSERT INTO thread_items(thread_id, item_json) VALUES(?, ?)").run(otherId, "keep");
    db.close();

    const state = path.join(home, "state_5.sqlite");
    const stateDb = new Database(state);
    stateDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)");
    stateDb.prepare("INSERT INTO threads(id, title) VALUES(?, ?)").run(threadId, "gone");
    stateDb.prepare("INSERT INTO threads(id, title) VALUES(?, ?)").run(otherId, "keep");
    stateDb.close();

    const result = await purgeProviderThread(home, threadId);
    expect(result.files).toBeGreaterThanOrEqual(2);
    expect(result.bytes).toBeGreaterThan(0);
    await expect(access(rollout)).rejects.toThrow();
    await expect(access(snapshot)).rejects.toThrow();
    await expect(access(lock)).rejects.toThrow();
    expect(await (await import("node:fs/promises")).readFile(other, "utf8")).toBe("keep");
    expect(await (await import("node:fs/promises")).readFile(otherSnapshot, "utf8")).toBe("keep-snap");
    expect(await (await import("node:fs/promises")).readFile(otherLock, "utf8")).toBe("keep-lock");
    expect(await (await import("node:fs/promises")).readFile(outsideFile, "utf8")).toBe("secret");
    const check = new Database(history, { readonly: true });
    const rows = check.prepare("SELECT thread_id FROM thread_items ORDER BY thread_id").all() as Array<{
      thread_id: string;
    }>;
    check.close();
    expect(rows.map((row) => row.thread_id)).toEqual([otherId]);
    const stateCheck = new Database(state, { readonly: true });
    const threads = stateCheck.prepare("SELECT id FROM threads ORDER BY id").all() as Array<{ id: string }>;
    stateCheck.close();
    expect(threads.map((row) => row.id)).toEqual([otherId]);
  });
});
