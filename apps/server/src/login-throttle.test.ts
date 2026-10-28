import { describe, expect, it } from "vitest";
import { LoginThrottle, loginRetryMessage, loginThrottleKeys } from "./login-throttle.js";

describe("login throttle", () => {
  it("locks a key after the last allowed attempt and resets when the lock expires", () => {
    const clock = { now: 0 };
    const throttle = new LoginThrottle({
      maxAttempts: 3,
      windowMs: 1_000,
      lockMs: 5_000,
      now: () => clock.now
    });
    expect(throttle.reserve(["ip:1"])).toBe(0);
    expect(throttle.reserve(["ip:1"])).toBe(0);
    expect(throttle.reserve(["ip:1"])).toBe(0);
    expect(throttle.reserve(["ip:1"])).toBe(5_000);
    clock.now = 5_000;
    expect(throttle.reserve(["ip:1"])).toBe(0);
  });

  it("does not consume other keys when one key is already locked", () => {
    const throttle = new LoginThrottle({
      maxAttempts: 1,
      windowMs: 1_000,
      lockMs: 5_000,
      now: () => 0
    });
    expect(throttle.reserve(["user:admin"])).toBe(0);
    expect(throttle.reserve(["ip:1", "user:admin"])).toBe(5_000);
    expect(throttle.reserve(["ip:1"])).toBe(0);
  });

  it("clears a fresh lock after a successful login", () => {
    const throttle = new LoginThrottle({
      maxAttempts: 2,
      windowMs: 1_000,
      lockMs: 5_000,
      now: () => 0
    });
    expect(throttle.reserve(["user:admin"])).toBe(0);
    expect(throttle.reserve(["user:admin"])).toBe(0);
    throttle.release(["user:admin"]);
    expect(throttle.reserve(["user:admin"])).toBe(0);
  });

  it("starts a new window after quiet time without locking", () => {
    const clock = { now: 0 };
    const throttle = new LoginThrottle({
      maxAttempts: 2,
      windowMs: 1_000,
      lockMs: 5_000,
      now: () => clock.now
    });
    expect(throttle.reserve(["ip:1"])).toBe(0);
    clock.now = 1_000;
    expect(throttle.reserve(["ip:1"])).toBe(0);
    expect(throttle.reserve(["ip:1"])).toBe(0);
    expect(throttle.reserve(["ip:1"])).toBe(5_000);
  });

  it("tracks ip, account, and the pair separately", () => {
    expect(loginThrottleKeys(" 203.0.113.8 ", " Admin ")).toEqual({
      ip: "ip:203.0.113.8",
      account: "user:admin",
      pair: "pair:203.0.113.8|admin"
    });
    expect(loginRetryMessage(1_500)).toBe("尝试次数过多，请 2 秒后再试");
    expect(loginRetryMessage(61_000)).toBe("尝试次数过多，请 2 分钟后再试");
  });
});
