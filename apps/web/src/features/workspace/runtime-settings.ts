export const DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS = 30;
export const DEFAULT_FAILURE_RETRY_DELAY_SECONDS = 15;
export const DEFAULT_FAILURE_RETRY_MAX_DELAY_SECONDS = 90;
export const FAILURE_RETRY_HARD_MAX_DELAY_SECONDS = 600;

export function secondsFromMs(ms: unknown, fallback: number) {
  const parsed = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed / 1000));
}

export function msFromSeconds(seconds: unknown) {
  const parsed = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(parsed)) return 0;
  return (
    Math.min(FAILURE_RETRY_HARD_MAX_DELAY_SECONDS, Math.max(0, Math.trunc(parsed))) * 1000
  );
}

export function clampRetryAttempts(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FAILURE_RETRY_MAX_ATTEMPTS;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}
