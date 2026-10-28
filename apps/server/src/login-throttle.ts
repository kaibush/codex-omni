type Bucket = {
  hits: number;
  windowStart: number;
  lockedUntil: number;
};

const MAX_BUCKETS = 20_000;

export class LoginThrottle {
  private readonly buckets = new Map<string, Bucket>();
  private operations = 0;

  constructor(
    private readonly options: {
      maxAttempts: number;
      windowMs: number;
      lockMs: number;
      now?: () => number;
    }
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  retryAfter(keys: readonly string[]) {
    if (this.buckets.size >= MAX_BUCKETS) this.prune();
    return this.blockedFor(keys, this.now());
  }

  reserve(keys: readonly string[]) {
    this.operations += 1;
    if (this.operations % 64 === 0 || this.buckets.size >= MAX_BUCKETS) this.prune();
    const now = this.now();
    const wait = this.blockedFor(keys, now);
    if (wait > 0) return wait;
    if (this.buckets.size >= MAX_BUCKETS && keys.some((key) => !this.buckets.has(key))) {
      return this.options.lockMs;
    }
    for (const key of keys) this.increment(key, now);
    return 0;
  }

  release(keys: readonly string[]) {
    for (const key of keys) this.buckets.delete(key);
  }

  private blockedFor(keys: readonly string[], now: number) {
    let wait = 0;
    for (const key of keys) {
      const bucket = this.usable(key, now);
      if (bucket && bucket.lockedUntil > now) wait = Math.max(wait, bucket.lockedUntil - now);
    }
    return wait;
  }

  private usable(key: string, now: number) {
    const bucket = this.buckets.get(key);
    if (!bucket) return undefined;
    if (bucket.lockedUntil > now) return bucket;
    if (bucket.lockedUntil > 0 || now - bucket.windowStart >= this.options.windowMs) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private increment(key: string, now: number) {
    const bucket = this.usable(key, now) ?? { hits: 0, windowStart: now, lockedUntil: 0 };
    bucket.hits += 1;
    if (bucket.hits >= this.options.maxAttempts) bucket.lockedUntil = now + this.options.lockMs;
    this.buckets.set(key, bucket);
  }

  private prune() {
    const now = this.now();
    for (const key of this.buckets.keys()) this.usable(key, now);
  }
}

export function loginThrottleKeys(ip: string, username: string) {
  const address = ip.trim().slice(0, 128) || "unknown";
  const name = username.trim().toLowerCase().slice(0, 256) || "-";
  return {
    ip: `ip:${address}`,
    account: `user:${name}`,
    pair: `pair:${address}|${name}`
  };
}

export function loginRetryMessage(retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (seconds < 60) return `尝试次数过多，请 ${seconds} 秒后再试`;
  const minutes = Math.ceil(seconds / 60);
  return `尝试次数过多，请 ${minutes} 分钟后再试`;
}
