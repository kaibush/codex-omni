import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import {
  boundOutboundCommands,
  MAX_OUTBOUND_COMMAND_BYTES,
  MAX_OUTBOUND_COMMANDS,
  timelineMessageId,
  type QueuedCommand
} from "./workspace-model";

const command = (id: number, size: number): QueuedCommand => ({
  id: String(id),
  sessionId: "session",
  data: "d".repeat(size),
  message: ""
});

describe("outbound command bounds", () => {
  it("keeps the newest commands within the count limit", () => {
    const result = boundOutboundCommands(
      Array.from({ length: MAX_OUTBOUND_COMMANDS + 8 }, (_, index) => command(index, 10))
    );

    expect(result).toHaveLength(MAX_OUTBOUND_COMMANDS);
    expect(result[0]?.id).toBe("8");
    expect(result.at(-1)?.id).toBe(String(MAX_OUTBOUND_COMMANDS + 7));
  });

  it("keeps queued command data within the byte budget", () => {
    const size = Math.floor(MAX_OUTBOUND_COMMAND_BYTES / 2);
    const result = boundOutboundCommands([command(1, size), command(2, size), command(3, size)]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("3");
  });
});

describe("timeline message ids", () => {
  it("keeps steered user cards on the persisted message id", () => {
    const message: Message = {
      id: "msg-steer",
      sessionId: "s",
      role: "user",
      content: "还有西安的",
      providerId: "p",
      eventType: "user.message",
      itemId: "steer:client-1",
      dataJson: JSON.stringify({ steer: true }),
      createdAt: 1,
      updatedAt: 1
    };
    expect(timelineMessageId(message)).toBe("msg-steer");
  });

  it("keeps namespaced assistant cards unique after a steered continuation", () => {
    const message: Message = {
      id: "msg-asst",
      sessionId: "s",
      role: "assistant",
      content: "西安也下雨。",
      providerId: "p",
      eventType: "assistant.completed",
      itemId: "run-1:s1:m1",
      dataJson: null,
      createdAt: 2,
      updatedAt: 2
    };
    expect(timelineMessageId(message)).toBe("assistant-run-1-s1:m1");
  });
});
