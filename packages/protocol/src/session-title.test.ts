import { describe, expect, it } from "vitest";
import { nextNumberedTitle, numberedDuplicateTitles } from "./session-title.js";

describe("terminal session titles", () => {
  it("keeps the first title and numbers later duplicates", () => {
    expect(nextNumberedTitle([], "shell 终端")).toBe("shell 终端");
    expect(nextNumberedTitle(["shell 终端"], "shell 终端")).toBe("shell 终端 2");
    expect(nextNumberedTitle(["shell 终端", "shell 终端 2"], "shell 终端")).toBe("shell 终端 3");
    expect(nextNumberedTitle(["shell 终端 2"], "shell 终端")).toBe("shell 终端");
  });

  it("labels existing duplicate titles by created time", () => {
    const labels = numberedDuplicateTitles([
      { id: "b", title: "shell 终端", createdAt: 20 },
      { id: "a", title: "shell 终端", createdAt: 10 },
      { id: "c", title: "codex 终端", createdAt: 15 }
    ]);
    expect(labels.get("a")).toBe("shell 终端 1");
    expect(labels.get("b")).toBe("shell 终端 2");
    expect(labels.get("c")).toBe("codex 终端");
  });
});
