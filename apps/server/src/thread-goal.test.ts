import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearThreadGoal,
  findGoalsDatabase,
  isThreadGoalLocked,
  readThreadGoal,
  threadGoalNotice
} from "./thread-goal.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createHome() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codex-omni-thread-goal-"));
  tempDirs.push(dir);
  return dir;
}

function createGoalsDb(home: string, version = 1) {
  const file = path.join(home, `goals_${version}.sqlite`);
  const db = new Database(file);
  db.exec(`
    CREATE TABLE thread_goals (
      thread_id TEXT PRIMARY KEY NOT NULL,
      goal_id TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      token_budget INTEGER,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      time_used_seconds INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE thread_goal_continuation_deferrals (
      thread_id TEXT PRIMARY KEY NOT NULL REFERENCES thread_goals(thread_id) ON DELETE CASCADE
    );
  `);
  db.close();
  return file;
}

function insertGoal(
  file: string,
  input: {
    threadId: string;
    status: string;
    objective?: string;
    tokenBudget?: number | null;
    tokensUsed?: number;
  }
) {
  const db = new Database(file);
  db.prepare(
    `INSERT INTO thread_goals(thread_id, goal_id, objective, status, token_budget, tokens_used, time_used_seconds, created_at_ms, updated_at_ms)
     VALUES(?, ?, ?, ?, ?, ?, 0, 1, 2)`
  ).run(
    input.threadId,
    "goal-1",
    input.objective ?? "完成前端改动",
    input.status,
    input.tokenBudget ?? 80_000,
    input.tokensUsed ?? 2_352_069
  );
  db.prepare("INSERT INTO thread_goal_continuation_deferrals(thread_id) VALUES(?)").run(
    input.threadId
  );
  db.close();
}

describe("thread-goal", () => {
  it("picks the highest goals sqlite version", () => {
    const home = createHome();
    writeFileSync(path.join(home, "goals_1.sqlite"), "");
    writeFileSync(path.join(home, "goals_2.sqlite"), "");
    writeFileSync(path.join(home, "goals_2.sqlite-wal"), "");
    expect(findGoalsDatabase(home)).toBe(path.join(home, "goals_2.sqlite"));
  });

  it("returns null when the home or thread is missing", () => {
    expect(readThreadGoal("/tmp/does-not-exist-codex-home", "thread-1")).toBeNull();
    const home = createHome();
    expect(readThreadGoal(home, "thread-1")).toBeNull();
    createGoalsDb(home);
    expect(readThreadGoal(home, "")).toBeNull();
    expect(readThreadGoal(home, "missing")).toBeNull();
  });

  it("reads a budget-limited goal and formats the notice", () => {
    const home = createHome();
    const file = createGoalsDb(home);
    insertGoal(file, {
      threadId: "01thread",
      status: "budget_limited",
      objective: "在思考备选页增加可持久化的缺思考换号记录表",
      tokenBudget: 80_000,
      tokensUsed: 2_352_069
    });
    const goal = readThreadGoal(home, "01thread");
    expect(goal).toMatchObject({
      threadId: "01thread",
      status: "budget_limited",
      tokenBudget: 80_000,
      tokensUsed: 2_352_069
    });
    expect(isThreadGoalLocked(goal)).toBe(true);
    expect(isThreadGoalLocked({ status: "active" })).toBe(false);
    const notice = threadGoalNotice(goal!);
    expect(notice.title).toBe("目标额度已用尽");
    expect(notice.message).toContain("2,352,069");
    expect(notice.message).toContain("80,000");
    expect(notice.message).toContain("收尾总结");
  });

  it("clears the goal row and cascaded deferrals", () => {
    const home = createHome();
    const file = createGoalsDb(home);
    insertGoal(file, { threadId: "01thread", status: "budget_limited" });
    expect(clearThreadGoal(home, "01thread")).toBe(true);
    expect(readThreadGoal(home, "01thread")).toBeNull();
    const db = new Database(file, { readonly: true });
    expect(
      db.prepare("SELECT COUNT(*) as n FROM thread_goal_continuation_deferrals").get() as {
        n: number;
      }
    ).toEqual({ n: 0 });
    db.close();
    expect(clearThreadGoal(home, "01thread")).toBe(false);
  });

  it("ignores unrelated files in CODEX_HOME", () => {
    const home = createHome();
    mkdirSync(path.join(home, "sessions"));
    writeFileSync(path.join(home, "config.toml"), "");
    expect(findGoalsDatabase(home)).toBe("");
  });
});
