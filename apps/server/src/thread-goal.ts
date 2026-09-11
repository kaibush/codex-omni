import Database from "better-sqlite3";
import { readdirSync } from "node:fs";
import path from "node:path";

const GOAL_STATUSES = new Set([
  "active",
  "paused",
  "blocked",
  "usage_limited",
  "budget_limited",
  "complete"
]);

export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usage_limited"
  | "budget_limited"
  | "complete";

export type ThreadGoal = {
  threadId: string;
  goalId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

type GoalRow = {
  thread_id: string;
  goal_id: string;
  objective: string;
  status: string;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  created_at_ms: number;
  updated_at_ms: number;
};

export function isThreadGoalLocked(goal: { status: string } | null | undefined) {
  return goal?.status === "budget_limited" || goal?.status === "usage_limited";
}

export function findGoalsDatabase(codexHome: string) {
  const home = path.resolve(codexHome);
  let names: string[] = [];
  try {
    names = readdirSync(home);
  } catch {
    return "";
  }
  const matches = names
    .map((name) => {
      const match = name.match(/^goals_(\d+)\.sqlite$/);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((item): item is { name: string; version: number } => Boolean(item))
    .sort((a, b) => a.version - b.version);
  const latest = matches.at(-1);
  return latest ? path.join(home, latest.name) : "";
}

function openGoalsDatabase(file: string, readonly: boolean) {
  return new Database(file, {
    readonly,
    fileMustExist: true,
    timeout: 2000
  });
}

function mapGoal(row: GoalRow): ThreadGoal | null {
  if (!row?.thread_id || !row.goal_id || !GOAL_STATUSES.has(row.status)) return null;
  return {
    threadId: row.thread_id,
    goalId: row.goal_id,
    objective: String(row.objective ?? ""),
    status: row.status as ThreadGoalStatus,
    tokenBudget: typeof row.token_budget === "number" ? row.token_budget : null,
    tokensUsed: Number(row.tokens_used ?? 0),
    timeUsedSeconds: Number(row.time_used_seconds ?? 0),
    createdAt: Number(row.created_at_ms ?? 0),
    updatedAt: Number(row.updated_at_ms ?? 0)
  };
}

export function readThreadGoal(codexHome: string, threadId: string | null | undefined) {
  const id = threadId?.trim() ?? "";
  if (!id) return null;
  const file = findGoalsDatabase(codexHome);
  if (!file) return null;
  let db: Database.Database | undefined;
  try {
    db = openGoalsDatabase(file, true);
    const row = db
      .prepare(
        `SELECT thread_id, goal_id, objective, status, token_budget, tokens_used, time_used_seconds, created_at_ms, updated_at_ms
         FROM thread_goals WHERE thread_id = ?`
      )
      .get(id) as GoalRow | undefined;
    return row ? mapGoal(row) : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export function clearThreadGoal(codexHome: string, threadId: string) {
  const id = threadId.trim();
  const file = findGoalsDatabase(codexHome);
  if (!id || !file) return false;
  let db: Database.Database | undefined;
  try {
    db = openGoalsDatabase(file, false);
    db.pragma("foreign_keys = ON");
    const result = db.prepare("DELETE FROM thread_goals WHERE thread_id = ?").run(id);
    return result.changes > 0;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "SQLITE_BUSY") {
      throw Object.assign(new Error("目标数据库正被 Codex 占用，请先停止当前任务再试"), {
        statusCode: 409
      });
    }
    throw error;
  } finally {
    db?.close();
  }
}

function formatTokenCount(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString("zh-CN");
}

export function threadGoalNotice(goal: ThreadGoal) {
  const used = formatTokenCount(goal.tokensUsed);
  const budget = goal.tokenBudget == null ? "未设置" : formatTokenCount(goal.tokenBudget);
  const title = goal.status === "usage_limited" ? "目标用量已达上限" : "目标额度已用尽";
  const reason =
    goal.status === "usage_limited"
      ? "Codex 被要求不要开始新的实质工作，只会收尾总结。"
      : "Codex 已把该线程标记为额度用尽，继续发送也只会收到收尾总结，不会真正执行。";
  const objective = goal.objective.trim();
  const message = [
    reason,
    objective ? `目标：${objective}` : "",
    `已用 ${used} / ${budget} tokens。`,
    "清除该目标后，当前对话才能继续干活。"
  ]
    .filter(Boolean)
    .join("\n");
  return { title, message };
}
