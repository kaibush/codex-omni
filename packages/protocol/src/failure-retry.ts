import { z } from "zod/v3";

export const DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS = 30;
export const DEFAULT_FAILURE_RETRY_DELAY_MS = 15_000;
export const DEFAULT_FAILURE_RETRY_MAX_DELAY_MS = 90_000;
export const FAILURE_RETRY_HARD_MAX_DELAY_MS = 600_000;

export const FAILURE_RETRY_KEYWORDS_MAX_LENGTH = 8_000;
export const RESOURCE_MISMATCH_RETRY_KEYWORD = "The requested item was created under a different";

export const failureRetrySettingsSchema = z.object({
  failureRetryEnabled: z.boolean(),
  failureRetryMaxAttempts: z.number().int().min(1).max(100),
  failureRetryDelayMs: z.number().int().min(0).max(FAILURE_RETRY_HARD_MAX_DELAY_MS),
  failureRetryMaxDelayMs: z.number().int().min(0).max(FAILURE_RETRY_HARD_MAX_DELAY_MS),
  failureRetryMode: z.enum(["builtin", "custom", "all"]),
  failureRetryBackoff: z.enum(["exponential", "fixed", "linear"]),
  failureRetryIncludeKeywords: z.string().max(FAILURE_RETRY_KEYWORDS_MAX_LENGTH),
  failureRetryExcludeKeywords: z.string().max(FAILURE_RETRY_KEYWORDS_MAX_LENGTH)
});

export type FailureRetrySettings = z.infer<typeof failureRetrySettingsSchema>;
type FailureRetryOptions = {
  [K in keyof FailureRetrySettings]?: FailureRetrySettings[K] | undefined;
};

// New options preserve legacy behavior when absent from stored settings.
export const defaultFailureRetrySettings: FailureRetrySettings = {
  failureRetryEnabled: false,
  failureRetryMaxAttempts: DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS,
  failureRetryDelayMs: DEFAULT_FAILURE_RETRY_DELAY_MS,
  failureRetryMaxDelayMs: DEFAULT_FAILURE_RETRY_MAX_DELAY_MS,
  failureRetryMode: "builtin",
  failureRetryBackoff: "exponential",
  failureRetryIncludeKeywords: "",
  failureRetryExcludeKeywords: ""
};

const RETRYABLE_FAILURE =
  /rate\s*limit|ratelimit|too many requests|\b429\b|overloaded|capacity|temporar(?:y|ily) unavailable|\b503\b|\b502\b|\b504\b|bad gateway|gateway timeout|timed?\s*out|etimedout|econnreset|econnrefused|socket hang up|network error|fetch failed|stream disconnected|stream closed|stream retries exhausted|turn-timeout|service unavailable|codex 流在 turn\.completed 前结束/i;

const NOT_RETRYABLE_FAILURE =
  /unauthori[sz]ed|\b401\b|\b402\b|invalid\s+api\s*key|forbidden|\b403\b|payment required|billing|insufficient\s+(?:quota|credits)|model\s+(?:not\s+found|does\s+not\s+exist)|invalid\s+(?:model|request|parameter)|bad request|\b400\b/i;

export function failureRetryKeywords(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ];
}

export type FailureRetryMatch = {
  retry: boolean;
  source: "empty" | "exclude" | "include" | "all" | "builtin-excluded" | "builtin" | "unmatched";
  keyword?: string;
};

// Custom exclusions always win. Explicit inclusions can override the legacy
// 400/auth exclusions, which some gateways use for transient upstream failures.
export function matchFailureRetry(
  reason: unknown,
  settings: FailureRetryOptions = {}
): FailureRetryMatch {
  const text = typeof reason === "string" ? reason.trim() : "";
  const normalized = text.toLowerCase();
  const findKeyword = (value: unknown) =>
    failureRetryKeywords(value).find((keyword) => normalized.includes(keyword.toLowerCase()));
  const excluded = findKeyword(settings.failureRetryExcludeKeywords);
  if (excluded) return { retry: false, source: "exclude", keyword: excluded };
  const included = findKeyword(settings.failureRetryIncludeKeywords);
  if (included) return { retry: true, source: "include", keyword: included };
  if (settings.failureRetryMode === "all") return { retry: true, source: "all" };
  if (!text) return { retry: false, source: "empty" };
  if (settings.failureRetryMode === "custom") return { retry: false, source: "unmatched" };
  if (NOT_RETRYABLE_FAILURE.test(text)) return { retry: false, source: "builtin-excluded" };
  if (RETRYABLE_FAILURE.test(text)) return { retry: true, source: "builtin" };
  return { retry: false, source: "unmatched" };
}

export function isRetryableTurnFailure(reason: unknown, settings: FailureRetryOptions = {}) {
  return matchFailureRetry(reason, settings).retry;
}

export function failureRetryDelayMs(
  attempt: number,
  baseMs = DEFAULT_FAILURE_RETRY_DELAY_MS,
  maxMs = DEFAULT_FAILURE_RETRY_MAX_DELAY_MS,
  backoff: FailureRetrySettings["failureRetryBackoff"] = "exponential"
) {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
  const cap = failureRetryMaxDelayMs(maxMs);
  const base = Math.trunc(baseMs);
  if (base === 0) return 0;
  const multiplier =
    backoff === "fixed" ? 1 : backoff === "linear" ? safeAttempt : 2 ** (safeAttempt - 1);
  return Math.min(cap, base * multiplier);
}

export function failureRetryLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

export function failureRetryBaseDelayMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FAILURE_RETRY_DELAY_MS;
  return Math.min(FAILURE_RETRY_HARD_MAX_DELAY_MS, Math.max(0, Math.trunc(parsed)));
}

export function failureRetryMaxDelayMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FAILURE_RETRY_MAX_DELAY_MS;
  return Math.min(FAILURE_RETRY_HARD_MAX_DELAY_MS, Math.max(0, Math.trunc(parsed)));
}
