export const DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS = 30;
export const DEFAULT_FAILURE_RETRY_DELAY_MS = 15_000;
export const FAILURE_RETRY_USER_MESSAGE = "自动重试：继续执行";

const RETRYABLE_FAILURE =
  /rate\s*limit|ratelimit|too many requests|\b429\b|overloaded|capacity|temporar(?:y|ily) unavailable|\b503\b|\b502\b|\b504\b|bad gateway|gateway timeout|timed?\s*out|etimedout|econnreset|econnrefused|socket hang up|network error|fetch failed|stream disconnected|stream closed|stream retries exhausted|turn-timeout|service unavailable|codex 流在 turn\.completed 前结束/i;

const NOT_RETRYABLE_FAILURE =
  /unauthori[sz]ed|\b401\b|invalid\s+api\s*key|forbidden|\b403\b|payment required|billing|insufficient\s+(?:quota|credits)|model\s+(?:not\s+found|does\s+not\s+exist)|invalid\s+(?:model|request|parameter)|bad request|\b400\b/i;

export function isRetryableTurnFailure(reason: unknown) {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return false;
  if (NOT_RETRYABLE_FAILURE.test(text)) return false;
  return RETRYABLE_FAILURE.test(text);
}

export function failureRetryDelayMs(attempt: number, baseMs = DEFAULT_FAILURE_RETRY_DELAY_MS) {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;
  const safeAttempt = Math.max(1, Math.trunc(attempt) || 1);
  return Math.min(180_000, Math.trunc(baseMs) * 2 ** (safeAttempt - 1));
}

export function failureRetryLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

export function failureRetryBaseDelayMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FAILURE_RETRY_DELAY_MS;
  return Math.min(180_000, Math.max(0, Math.trunc(parsed)));
}

function shortFailureReason(reason: string) {
  const text = reason.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export function failureRetryingNotice(input: {
  reason: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}) {
  const reason = shortFailureReason(input.reason);
  const prefix = reason ? `遇到可恢复错误：${reason}。` : "遇到可恢复错误。";
  if (input.delayMs > 0) {
    const seconds = Math.max(1, Math.round(input.delayMs / 1000));
    return `${prefix}将在 ${seconds} 秒后自动继续执行（第 ${input.attempt}/${input.maxAttempts} 次）。`;
  }
  return `${prefix}正在自动继续执行（第 ${input.attempt}/${input.maxAttempts} 次）。`;
}

export function failureRetryExhaustedNotice(input: { reason: string; maxAttempts: number }) {
  const reason = shortFailureReason(input.reason);
  return `已自动重试 ${input.maxAttempts} 次仍未成功${reason ? `：${reason}` : ""}。请手动发送「继续」或稍后再试。`;
}
