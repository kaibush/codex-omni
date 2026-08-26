import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createId,
  formatCompactDateTime,
  formatDataSize,
  formatDateTime,
  formatMessageTime,
  formatUptime,
  isScrolledToBottom
} from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createId", () => {
  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    expect(createId()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(7);
        return bytes;
      }
    });
    expect(createId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe("isScrolledToBottom", () => {
  it("treats the viewport as sticky near the bottom", () => {
    expect(isScrolledToBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 }, 96)).toBe(
      true
    );
    expect(isScrolledToBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 100 }, 96)).toBe(
      false
    );
  });

  it("supports a tight threshold for wheel scrolling", () => {
    expect(isScrolledToBottom({ scrollHeight: 1000, scrollTop: 885, clientHeight: 100 }, 12)).toBe(
      false
    );
    expect(isScrolledToBottom({ scrollHeight: 1000, scrollTop: 895, clientHeight: 100 }, 12)).toBe(
      true
    );
  });
});

describe("formatDateTime", () => {
  it("formats timestamps in zh-CN", () => {
    expect(formatDateTime(Date.UTC(2026, 2, 12, 6, 20))).toMatch(/2026/);
    expect(formatDateTime(null)).toBe("");
  });

  it("omits the year for compact dates in the current year", () => {
    const now = new Date();
    const stamp = new Date(now.getFullYear(), 2, 12, 14, 20).getTime();
    expect(formatCompactDateTime(stamp)).not.toContain(String(now.getFullYear()));
    expect(formatCompactDateTime(stamp)).toMatch(/03/);
  });
});

describe("formatMessageTime", () => {
  it("shows hours and minutes for timestamps on the same day", () => {
    const now = new Date();
    const stamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 5).getTime();
    expect(formatMessageTime(stamp)).toBe("14:05");
    expect(formatMessageTime(null)).toBe("");
  });

  it("falls back to compact dates for other days", () => {
    const stamp = new Date(2024, 0, 2, 9, 8).getTime();
    expect(formatMessageTime(stamp)).toBe(formatCompactDateTime(stamp));
  });
});

describe("formatDataSize", () => {
  it("formats bytes into readable units", () => {
    expect(formatDataSize(512)).toBe("512 B");
    expect(formatDataSize(10 * 1024 * 1024 * 1024)).toBe("10 GB");
    expect(formatDataSize(8.2 * 1024 * 1024 * 1024, true)).toBe("8.2G");
  });
});

describe("formatUptime", () => {
  it("summarizes seconds into days or hours", () => {
    expect(formatUptime(90)).toBe("1 分钟");
    expect(formatUptime(3700)).toBe("1 小时 1 分钟");
    expect(formatUptime(90000)).toBe("1 天 1 小时");
  });
});
