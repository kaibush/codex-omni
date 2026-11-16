export {
  DEFAULT_FAILURE_RETRY_DELAY_MS,
  DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS,
  DEFAULT_FAILURE_RETRY_MAX_DELAY_MS,
  FAILURE_RETRY_HARD_MAX_DELAY_MS,
  failureRetryBaseDelayMs,
  failureRetryDelayMs,
  failureRetryLimit,
  failureRetryMaxDelayMs,
  isRetryableTurnFailure
} from "@codex-omni/protocol";

export const FAILURE_RETRY_USER_MESSAGE = "自动重试：继续执行";

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
  const prefix = reason ? `错误命中自动重试规则：${reason}。` : "错误命中自动重试规则。";
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
