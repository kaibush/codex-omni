import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TITLE,
  isPlaceholderSessionTitle,
  listHistoricalSessions,
  resolveSessionTitle,
  sessionListTime,
  sortSessions,
  sortSessionsByLatest,
  titleFromFirstMessage
} from "./session-title";

describe("session title", () => {
  it("uses a Chinese default and treats legacy English titles as placeholders", () => {
    expect(DEFAULT_SESSION_TITLE).toBe("新对话");
    expect(isPlaceholderSessionTitle("New session")).toBe(true);
    expect(isPlaceholderSessionTitle("新对话")).toBe(true);
    expect(isPlaceholderSessionTitle("修复登录")).toBe(false);
  });

  it("names a session from the first sentence", () => {
    expect(titleFromFirstMessage("帮我看看登录页面。然后再改 websocket")).toBe("帮我看看登录页面");
    expect(titleFromFirstMessage("Fix the websocket crash now")).toBe(
      "Fix the websocket crash now"
    );
    expect(titleFromFirstMessage("Fix the websocket crash now!")).toBe(
      "Fix the websocket crash now"
    );
    expect(titleFromFirstMessage("   ")).toBe("新对话");
  });

  it("resolves placeholder titles from the first user message", () => {
    expect(resolveSessionTitle("新对话", "打开这个项目目录。谢谢")).toBe("打开这个项目目录");
    expect(resolveSessionTitle("已命名", "忽略这句话")).toBe("已命名");
  });
});

describe("listHistoricalSessions", () => {
  it("keeps named conversations and drops empty placeholders", () => {
    expect(
      listHistoricalSessions([
        { id: "1", title: "新对话" },
        { id: "2", title: "修复登录" },
        { id: "3", title: "New session" }
      ])
    ).toEqual([{ id: "2", title: "修复登录" }]);
  });
});

describe("sortSessionsByLatest", () => {
  it("puts the newest session first", () => {
    expect(
      sortSessionsByLatest([
        { id: "old", createdAt: 1, updatedAt: 1 },
        { id: "new", createdAt: 2, updatedAt: 2 },
        { id: "active", createdAt: 1, updatedAt: 1, lastMessageAt: 9 }
      ]).map((session) => session.id)
    ).toEqual(["active", "new", "old"]);
  });
});

describe("sortSessions", () => {
  const sessions = [
    { id: "older", createdAt: 10, updatedAt: 50, lastMessageAt: 40 },
    { id: "newer", createdAt: 30, updatedAt: 30, lastMessageAt: 30 },
    { id: "touched", createdAt: 20, updatedAt: 20, lastMessageAt: 80 }
  ];

  it("defaults the visible order to creation time", () => {
    expect(sortSessions(sessions, "created").map((session) => session.id)).toEqual([
      "newer",
      "touched",
      "older"
    ]);
    expect(sessionListTime(sessions[0]!, "created")).toBe(10);
  });

  it("can switch back to update time", () => {
    expect(sortSessions(sessions, "updated").map((session) => session.id)).toEqual([
      "touched",
      "older",
      "newer"
    ]);
    expect(sessionListTime(sessions[2]!, "updated")).toBe(80);
  });
});
