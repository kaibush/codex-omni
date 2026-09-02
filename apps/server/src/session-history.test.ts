import { describe, expect, it } from "vitest";
import type { MessageRow } from "@codex-omni/db";
import { compactMessageForClient } from "./session-history.js";

const message = (dataJson: string | null, content = "large output"): MessageRow => ({
  id: "message-1",
  sessionId: "session-1",
  role: "tool",
  content,
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

  it("truncates oversized tool output for list payloads", () => {
    const output = `${"line\n".repeat(4000)}tail`;
    const result = compactMessageForClient(
      message(JSON.stringify({ tool: "command", output, status: "completed" }), output)
    );
    const data = JSON.parse(result.dataJson ?? "{}");
    expect(result.content.length).toBeLessThan(output.length);
    expect(result.content).not.toContain("tail");
    expect(data.previewTruncated).toBe(true);
    expect(data.originalLength).toBe(output.length);
    expect(data.output).toBeUndefined();
  });

  it("truncates nested tool payloads when content itself is short", () => {
    const output = "x".repeat(20_000);
    const result = compactMessageForClient(
      message(JSON.stringify({ tool: "command", output, status: "completed" }))
    );
    const data = JSON.parse(result.dataJson ?? "{}");
    expect(result.content).toBe("large output");
    expect(data.previewTruncated).toBe(true);
    expect(String(data.output).length).toBeLessThan(output.length);
  });

  it("can skip preview truncation when loading a single message", () => {
    const output = "x".repeat(20_000);
    const result = compactMessageForClient(
      message(JSON.stringify({ tool: "command", output })),
      { preview: false }
    );
    expect(result.content).toBe("large output");
    expect(JSON.parse(result.dataJson ?? "{}")).toEqual({ tool: "command", output });
  });
});
