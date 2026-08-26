import { describe, expect, it } from "vitest";
import type { MessageRow } from "@codex-omni/db";
import { compactMessageForClient } from "./session-history.js";

const message = (dataJson: string | null): MessageRow => ({
  id: "message-1",
  sessionId: "session-1",
  role: "tool",
  content: "large output",
  providerId: null,
  eventType: "tool.output",
  itemId: "request-1:item-1",
  dataJson,
  createdAt: 1,
  updatedAt: 1
});

describe("compactMessageForClient", () => {
  it("removes duplicated text while preserving structured tool metadata", () => {
    const result = compactMessageForClient(
      message(
        JSON.stringify({
          tool: "command",
          command: "pnpm test",
          output: "large output",
          status: "completed"
        })
      )
    );
    expect(JSON.parse(result.dataJson ?? "{}")).toEqual({
      tool: "command",
      command: "pnpm test",
      status: "completed"
    });
    expect(result.content).toBe("large output");
  });

  it("retains malformed or non-duplicated payloads", () => {
    expect(compactMessageForClient(message("not-json")).dataJson).toBe("not-json");
    const dataJson = JSON.stringify({ output: "different output" });
    expect(compactMessageForClient(message(dataJson)).dataJson).toBe(dataJson);
  });
});
