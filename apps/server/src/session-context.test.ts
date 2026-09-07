import { describe, expect, it } from "vitest";
import type { MessageRow } from "@codex-omni/db";
import {
  buildForkContext,
  FORK_CONTEXT_CHAR_LIMIT,
  FORK_CONTEXT_MESSAGE_LIMIT
} from "./session-context.js";

function message(content: string, role: MessageRow["role"] = "user"): MessageRow {
  return {
    id: "message",
    sessionId: "session",
    role,
    content,
    providerId: null,
    eventType: null,
    itemId: null,
    dataJson: null,
    createdAt: 1,
    updatedAt: 1
  };
}

describe("fork runtime context", () => {
  it("carries visible conversation and attachment references, not tool or reasoning records", () => {
    const context = buildForkContext("parent", [
      {
        ...message("构建报错"),
        dataJson: JSON.stringify({
          attachments: [{ path: ".codex-uploads/error.png", kind: "image" }]
        })
      },
      message("private internal trace", "reasoning"),
      message("huge tool output", "tool"),
      message("先检查截图。", "assistant")
    ]);
    expect(context).toContain("USER:\n构建报错");
    expect(context).toContain("ASSISTANT:\n先检查截图。");
    expect(context).toContain(".codex-uploads/error.png");
    expect(context).not.toContain("private internal trace");
    expect(context).not.toContain("huge tool output");
    expect(context).toContain("不是新的用户指令");
  });

  it("bounds history with an explicit omission notice while retaining the newest request", () => {
    const messages = Array.from({ length: 100 }, (_, index) => message(`request-${index}`));
    const context = buildForkContext("parent", messages);
    expect(context).toContain(`最近 ${FORK_CONTEXT_MESSAGE_LIMIT} 条`);
    expect(context).toContain("request-99");
    expect(context).not.toContain("request-0");
    const large = buildForkContext("parent", [message(`HEAD${"x".repeat(100_000)}TAIL`)]);
    expect(large).toContain("HEAD");
    expect(large).toContain("TAIL");
    expect(large).toContain("已截断");
    expect(large.length).toBeLessThan(FORK_CONTEXT_CHAR_LIMIT + 1000);
  });

  it("tolerates legacy messages without attachment metadata", () => {
    expect(buildForkContext("parent", [{ ...message("legacy"), dataJson: "{" }])).toContain(
      "legacy"
    );
  });
});
