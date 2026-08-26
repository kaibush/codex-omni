export const PLAN_PROMPT = `请先制定可执行计划，不要修改文件，也不要运行会改写工作区的命令。
用中文输出以下结构：
## 目标
## 步骤
## 风险
## 任务
- [ ] 任务标题
等待用户确认后再执行。`;

export function applyPlanMode(message: string) {
  const trimmed = message.trim();
  if (trimmed.includes("请先制定可执行计划")) return trimmed;
  return `${PLAN_PROMPT}\n\n用户请求：\n${trimmed}`;
}

export function applyProjectRules(
  message: string,
  rules: Array<{ title: string; content: string }>
) {
  const enabled = rules
    .map((rule) => ({ title: rule.title.trim(), content: rule.content.trim() }))
    .filter((rule) => rule.title && rule.content);
  if (!enabled.length) return message;
  const block = enabled.map((rule) => `## ${rule.title}\n${rule.content}`).join("\n\n");
  const prefix = `<project-rules>\n${block}\n</project-rules>`;
  const trimmed = message.trim();
  return trimmed ? `${prefix}\n\n${trimmed}` : prefix;
}

export function parsePlanTasks(text: string) {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(/^(?:[-*+]\s*)?\[[ xX]\]\s+(.+)$/) || line.match(/^\d+[.)]\s+(.+)$/);
    if (!match) continue;
    const title = match[1]!.replace(/\s+/g, " ").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title.slice(0, 200));
    if (titles.length >= 40) break;
  }
  return titles;
}

export function summarizeRuns(
  runs: Array<{
    status: string;
    startedAt: number;
    endedAt: number | null;
    usageJson: string | null;
  }>
) {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let durationMs = 0;
  for (const run of runs) {
    durationMs += Math.max(0, (run.endedAt ?? run.startedAt) - run.startedAt);
    if (!run.usageJson) continue;
    try {
      const usage = JSON.parse(run.usageJson) as Record<string, number>;
      inputTokens += Number(usage.input_tokens ?? usage.inputTokens ?? 0);
      outputTokens += Number(usage.output_tokens ?? usage.outputTokens ?? 0);
      totalTokens += Number(usage.total_tokens ?? usage.totalTokens ?? 0);
    } catch {
      // Ignore malformed usage payloads.
    }
  }
  return {
    turns: runs.length,
    completed: runs.filter((run) => run.status === "completed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    cancelled: runs.filter((run) => run.status === "cancelled").length,
    interrupted: runs.filter((run) => run.status === "interrupted").length,
    durationMs,
    inputTokens,
    outputTokens,
    totalTokens,
    lastRunAt: runs[0]?.startedAt ?? null
  };
}
