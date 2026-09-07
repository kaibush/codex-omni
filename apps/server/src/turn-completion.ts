export type ContinuationRetryReason = "continuation" | "compaction" | "plan-only";

export function isPlanningOnlyRequest(message: string) {
  return /(?:只|仅|先).{0,12}(?:计划|方案|解释|说明|分析)|(?:不要|别|暂不).{0,6}(?:执行|操作|调用工具|运行命令)|\b(?:plan only|only (?:explain|describe|plan)|do not (?:execute|run)|don't (?:execute|run))\b/i.test(
    message
  );
}

export function isPlanOnlyResponse(assistantText: string) {
  const text = assistantText.trim();
  if (!text || text.length > 1000 || /```|\n\s*(?:[-*]|\d+[.)])\s/.test(text)) return false;
  // Do not turn a result, a question, or a suggestion to the user into a new
  // execution request. This guard deliberately prefers false negatives.
  if (
    /(已完成|已经完成|完成了|无需再做|不需要再做|任务完成|already done|nothing left|\bcompleted\b|[?？]|请(?:你|提供|确认)|你可以|建议你|等待.{0,8}确认|\byou (?:can|should)\b)/i.test(
      text
    )
  )
    return false;
  return /(我会|我将|我先|先看|先读|先核|先检查|现在打开|现在先|正在准备|(?:接下来|下一步).{0,6}(?:我|先)|I'll|I will|let me)/i.test(
    text
  );
}

export function incompleteTurnReason(input: {
  message: string;
  planMode: boolean;
  continuationApplied: boolean;
  assistantText: string;
  latestAssistantText: string;
  hasExecutionEvidence: boolean;
  compactedThisTurn: boolean;
  hasPostCompactionExecution: boolean;
}): ContinuationRetryReason | undefined {
  if (input.planMode || isPlanningOnlyRequest(input.message)) return undefined;
  if (
    input.compactedThisTurn &&
    !input.hasPostCompactionExecution &&
    isPlanOnlyResponse(input.latestAssistantText)
  )
    return "compaction";
  if (input.hasExecutionEvidence) return undefined;
  if (input.continuationApplied && !input.assistantText.trim()) return "continuation";
  if (!isPlanOnlyResponse(input.assistantText)) return undefined;
  return input.continuationApplied ? "continuation" : "plan-only";
}

export function continuationRetryDirective(reason: ContinuationRetryReason) {
  const cause =
    reason === "compaction"
      ? "上一轮在压缩上下文后只回复了下一步计划，没有继续调用工具。"
      : reason === "continuation"
        ? "上一轮继续执行请求没有观察到工具调用或文件变更。"
        : "上一轮只回复了下一步计划，没有观察到工具调用或文件变更。";
  return `自动复核：${cause}请保持原始用户请求的目标、限制和运行权限，调用必要工具取得实际结果，不要再只说明计划。只在原请求要求修改时修改文件；如果工作已经完成，请用工具核实。若需要用户补充信息，请明确提问。`;
}
