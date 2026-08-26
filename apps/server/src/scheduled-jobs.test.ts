import { describe, expect, it } from "vitest";
import { nextRunAt } from "./scheduled-jobs.js";

describe("scheduled job cadence", () => {
  it("advances interval and daily times", () => {
    const from = Date.parse("2026-08-22T01:00:00Z");
    expect(nextRunAt({ cadence: "interval", intervalMinutes: 30, from })).toBe(from + 30 * 60_000);
    const daily = nextRunAt({ cadence: "daily", dailyAt: "09:00", from });
    expect(daily).toBeGreaterThan(from);
  });
});
