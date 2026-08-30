export type ContextUsage = {
  totalTokens: number;
  contextWindow: number;
  percent: number;
  label: string;
  title: string;
};

const TOTAL_KEYS = ["total_tokens", "totalTokens"] as const;
const INPUT_KEYS = ["input_tokens", "inputTokens"] as const;
const OUTPUT_KEYS = ["output_tokens", "outputTokens"] as const;
const WINDOW_KEYS = [
  "model_context_window",
  "modelContextWindow",
  "context_window",
  "contextWindow"
] as const;

function readNumber(usage: Record<string, number>, keys: readonly string[]) {
  for (const key of keys) {
    const value = Number(usage[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function formatTokens(value: number) {
  if (value < 1000) return value.toLocaleString();
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
}

export function parseContextUsage(
  usage: Record<string, number> | null | undefined
): ContextUsage | null {
  if (!usage) return null;
  const contextWindow = readNumber(usage, WINDOW_KEYS);
  if (contextWindow == null || contextWindow <= 0) return null;
  const totalTokens =
    readNumber(usage, TOTAL_KEYS) ??
    (readNumber(usage, INPUT_KEYS) ?? 0) + (readNumber(usage, OUTPUT_KEYS) ?? 0);
  const percent = Math.min(100, Math.round((totalTokens / contextWindow) * 100));
  return {
    totalTokens,
    contextWindow,
    percent,
    label: `${formatTokens(totalTokens)} / ${formatTokens(contextWindow)}`,
    title: `上下文 ${totalTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
  };
}
