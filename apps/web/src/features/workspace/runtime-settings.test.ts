import { describe, expect, it } from "vitest";
import {
  clampRetryAttempts,
  msFromSeconds,
  secondsFromMs
} from "./runtime-settings";

describe("runtime retry delay helpers", () => {
  it("converts seconds and milliseconds", () => {
    expect(secondsFromMs(15_000, 15)).toBe(15);
    expect(secondsFromMs(undefined, 90)).toBe(90);
    expect(msFromSeconds(15)).toBe(15_000);
    expect(msFromSeconds(90)).toBe(90_000);
    expect(msFromSeconds(800)).toBe(600_000);
    expect(msFromSeconds(-3)).toBe(0);
  });

  it("clamps retry attempts", () => {
    expect(clampRetryAttempts(30)).toBe(30);
    expect(clampRetryAttempts(0)).toBe(1);
    expect(clampRetryAttempts(240)).toBe(100);
    expect(clampRetryAttempts("nope")).toBe(30);
  });
});
