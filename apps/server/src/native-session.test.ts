import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transferNativeSession } from "./native-session.js";

let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});
async function fixture() {
  directory = await mkdtemp(path.join(os.tmpdir(), "omni-native-transfer-"));
  const sourceHome = path.join(directory, "provider-a");
  const targetHome = path.join(directory, "provider-b");
  await mkdir(sourceHome);
  await mkdir(targetHome);
  return { sourceHome, targetHome, threadId: randomUUID() };
}
async function write(home: string, file: string, content: string) {
  await mkdir(path.dirname(path.join(home, file)), { recursive: true });
  await writeFile(path.join(home, file), content);
}
const rollout = (id: string) => `sessions/2026/09/27/rollout-2026-09-27T10-00-00-${id}.jsonl`;
const metadata = (id: string, parent?: string) =>
  JSON.stringify({
    type: "session_meta",
    payload: {
      id,
      source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : "exec"
    }
  }) + "\n";
function state(home: string) {
  const db = new Database(path.join(home, "state_5.sqlite"));
  db.exec(
    "CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,rollout_path TEXT NOT NULL); CREATE TABLE IF NOT EXISTS thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT,PRIMARY KEY(parent_thread_id,child_thread_id))"
  );
  return db;
}

describe("native session migration between isolated provider homes", () => {
  it("copies complete Codex rollouts, descendants and goal rows without replacing other conversations or credentials", async () => {
    const input = await fixture();
    const { sourceHome, targetHome, threadId } = input;
    const childId = randomUUID();
    const unrelated = randomUUID();
    const history =
      metadata(threadId) +
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "tool-1",
          output: "native-tool-output-" + "x".repeat(60000)
        }
      }) +
      "\n";
    await write(sourceHome, rollout(threadId), history);
    await write(sourceHome, rollout(childId), metadata(childId, threadId));
    await write(sourceHome, rollout(unrelated), metadata(unrelated));
    await write(sourceHome, "auth.json", "source-credential");
    await write(targetHome, "auth.json", "target-credential");
    await write(targetHome, "config.toml", "target-configuration");
    const sourceState = state(sourceHome);
    for (const id of [threadId, childId, unrelated])
      sourceState
        .prepare("INSERT INTO threads VALUES(?,?)")
        .run(id, path.join(sourceHome, rollout(id)));
    sourceState.prepare("INSERT INTO thread_spawn_edges VALUES(?,?)").run(threadId, childId);
    sourceState.close();
    const targetState = state(targetHome);
    targetState.prepare("INSERT INTO threads VALUES(?,?)").run(unrelated, "keep-target-thread");
    targetState.close();
    // Leave this database open in WAL mode: copying just the .sqlite file
    // would miss the committed goal and corrupt resumption.
    const goals = new Database(path.join(sourceHome, "goals_1.sqlite"));
    goals.pragma("journal_mode = WAL");
    goals.exec(
      "CREATE TABLE thread_goals(thread_id TEXT PRIMARY KEY,objective TEXT,status TEXT); CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY,checksum BLOB)"
    );
    goals
      .prepare("INSERT INTO thread_goals VALUES(?,?,?)")
      .run(threadId, "Finish the implementation", "active");
    goals
      .prepare("INSERT INTO thread_goals VALUES(?,?,?)")
      .run(unrelated, "Unrelated goal", "complete");
    goals.prepare("INSERT INTO _sqlx_migrations VALUES(?,?)").run(1, Buffer.from("checksum"));
    try {
      await transferNativeSession({ ...input, clientType: "codex" });
    } finally {
      goals.close();
    }
    expect(await readFile(path.join(targetHome, rollout(threadId)), "utf8")).toBe(history);
    expect(await readFile(path.join(sourceHome, rollout(threadId)), "utf8")).toBe(history);
    expect(await readFile(path.join(targetHome, rollout(childId)), "utf8")).toBe(
      metadata(childId, threadId)
    );
    expect(await readFile(path.join(targetHome, "auth.json"), "utf8")).toBe("target-credential");
    expect(await readFile(path.join(targetHome, "config.toml"), "utf8")).toBe(
      "target-configuration"
    );
    const merged = state(targetHome);
    expect(merged.prepare("SELECT rollout_path FROM threads WHERE id=?").get(threadId)).toEqual({
      rollout_path: path.join(targetHome, rollout(threadId))
    });
    expect(merged.prepare("SELECT rollout_path FROM threads WHERE id=?").get(unrelated)).toEqual({
      rollout_path: "keep-target-thread"
    });
    expect(merged.prepare("SELECT * FROM thread_spawn_edges").all()).toEqual([
      { parent_thread_id: threadId, child_thread_id: childId }
    ]);
    merged.close();
    const copiedGoals = new Database(path.join(targetHome, "goals_1.sqlite"));
    expect(copiedGoals.prepare("SELECT * FROM thread_goals").all()).toEqual([
      { thread_id: threadId, objective: "Finish the implementation", status: "active" }
    ]);
    expect(copiedGoals.prepare("SELECT checksum FROM _sqlx_migrations").get()).toEqual({
      checksum: Buffer.from("checksum")
    });
    copiedGoals.close();
    await appendFile(path.join(targetHome, rollout(threadId)), "native-provider-b-turn\n");
    await transferNativeSession({
      ...input,
      clientType: "codex",
      sourceHome: targetHome,
      targetHome: sourceHome
    });
    expect(await readFile(path.join(sourceHome, rollout(threadId)), "utf8")).toBe(
      history + "native-provider-b-turn\n"
    );
  });

  it.skipIf(process.platform === "win32")(
    "rewrites Codex rollout paths when an external home uses a directory alias",
    async () => {
      const input = await fixture();
      const alias = path.join(directory, "external-codex-alias");
      await symlink(input.sourceHome, alias, "dir");
      await write(input.sourceHome, rollout(input.threadId), metadata(input.threadId));
      const source = state(input.sourceHome);
      source
        .prepare("INSERT INTO threads VALUES(?,?)")
        .run(input.threadId, path.join(alias, rollout(input.threadId)));
      source.close();
      await transferNativeSession({ ...input, sourceHome: alias, clientType: "codex" });
      const target = state(input.targetHome);
      expect(
        target.prepare("SELECT rollout_path FROM threads WHERE id=?").get(input.threadId)
      ).toEqual({ rollout_path: path.join(input.targetHome, rollout(input.threadId)) });
      target.close();
    }
  );

  it("preserves Claude tool blocks, subagents, plans, tasks and file checkpoints across A/B/A switches", async () => {
    const input = await fixture();
    const { sourceHome, targetHome, threadId } = input;
    const transcript = `projects/-tmp-project/${threadId}.jsonl`;
    const history =
      JSON.stringify({
        type: "assistant",
        sessionId: threadId,
        slug: "review-plan",
        message: {
          content: [
            {
              type: "tool_use",
              id: "read-1",
              name: "Read",
              input: { file_path: "/tmp/project/README.md" }
            }
          ]
        }
      }) + "\n";
    const artifacts = [
      `projects/-tmp-project/${threadId}/subagents/agent-one.jsonl`,
      `tasks/${threadId}/1.json`,
      `file-history/${threadId}/backup@v1`,
      `todos/${threadId}-agent-one.json`,
      "plans/review-plan.md"
    ];
    await write(sourceHome, transcript, history);
    for (const file of artifacts) await write(sourceHome, file, file);
    await write(sourceHome, ".credentials.json", "source-login");
    await write(sourceHome, "settings.json", "source-settings");
    await write(sourceHome, "projects/-other/other-session.jsonl", "private-other-conversation");
    await write(targetHome, "settings.json", "target-settings");
    await transferNativeSession({ ...input, clientType: "claude-code" });
    expect(await readFile(path.join(targetHome, transcript), "utf8")).toBe(history);
    for (const file of artifacts)
      expect(await readFile(path.join(targetHome, file), "utf8")).toBe(file);
    expect(await readFile(path.join(targetHome, "settings.json"), "utf8")).toBe("target-settings");
    expect(await readdir(targetHome)).not.toContain(".credentials.json");
    expect(await readdir(path.join(targetHome, "projects"))).toEqual(["-tmp-project"]);
    await appendFile(
      path.join(targetHome, transcript),
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "read-1", content: "native-result" }]
        }
      }) + "\n"
    );
    await transferNativeSession({
      ...input,
      clientType: "claude-code",
      sourceHome: targetHome,
      targetHome: sourceHome
    });
    expect(await readFile(path.join(sourceHome, transcript), "utf8")).toContain('"tool_result"');
  });

  it("fails without inventing history when native files are missing or belong to another client", async () => {
    const input = await fixture();
    await write(input.sourceHome, `projects/-tmp-project/${input.threadId}.jsonl`, "claude-native");
    await expect(transferNativeSession({ ...input, clientType: "codex" })).rejects.toThrow(
      "找不到原生会话"
    );
    await expect(
      transferNativeSession({ ...input, clientType: "claude-code", threadId: "../../auth" })
    ).rejects.toThrow("ID 无效");
    expect(await readdir(input.targetHome)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "rejects destination links without overwriting their targets",
    async () => {
      const input = await fixture();
      await write(input.sourceHome, rollout(input.threadId), metadata(input.threadId));
      const outside = path.join(directory, "outside");
      await mkdir(outside);
      await symlink(outside, path.join(input.targetHome, "sessions"), "dir");
      await expect(transferNativeSession({ ...input, clientType: "codex" })).rejects.toThrow(
        "符号链接"
      );
      expect(await readdir(outside)).toEqual([]);
    }
  );
});
