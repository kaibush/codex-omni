import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";
import { messageRetryPayload } from "./message-retry";

const attachments = [{ name: "shot.png", path: ".codex-uploads/shot.png", kind: "image" }];

describe("message retry input", () => {
  it("retains image metadata from a live user event", async () => {
    const load = vi.fn();
    expect(
      await messageRetryPayload(
        {
          id: "user",
          kind: "user",
          text: "inspect",
          data: { attachments }
        },
        load
      )
    ).toEqual({ message: "inspect", attachments });
    expect(load).not.toHaveBeenCalled();
  });

  it("loads full text and persisted attachments after a page reload", async () => {
    const fullText = "full request ".repeat(4000);
    const stored: Message = {
      id: "message",
      sessionId: "s",
      role: "user",
      content: fullText,
      providerId: "p",
      eventType: "user.message",
      itemId: null,
      dataJson: JSON.stringify({ attachments }),
      createdAt: 1,
      updatedAt: 1
    };
    const load = vi.fn(async () => stored);
    expect(
      await messageRetryPayload(
        {
          id: "user",
          messageId: stored.id,
          kind: "user",
          text: "preview",
          data: { previewTruncated: true }
        },
        load
      )
    ).toEqual({ message: fullText, attachments });
    expect(load).toHaveBeenCalledWith(stored.id);
  });

  it("does not silently send a text-only retry if loading the original fails", async () => {
    await expect(
      messageRetryPayload(
        { id: "user", messageId: "missing", kind: "user", text: "preview" },
        async () => {
          throw new Error("message not found");
        }
      )
    ).rejects.toThrow("message not found");
  });

  it("keeps plain text retries compatible and rejects corrupt attachment metadata", async () => {
    expect(await messageRetryPayload({ id: "user", kind: "user", text: "hello" }, vi.fn())).toEqual(
      { message: "hello", attachments: [] }
    );
    await expect(
      messageRetryPayload(
        {
          id: "user",
          kind: "user",
          text: "inspect",
          data: { attachments: [{ name: "broken" }] }
        },
        vi.fn()
      )
    ).rejects.toThrow();
  });
});
