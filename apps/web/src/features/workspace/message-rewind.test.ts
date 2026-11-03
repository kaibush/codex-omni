import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import { messageRewindDraft } from "./message-rewind";
import { parseComposerDraft, stringifyComposerDraft } from "./composer-attachments";

describe("rewind drafts", () => {
  it("restores the full editable text and saved attachments through a page reload", () => {
    const text = "完整原文".repeat(20_000);
    const attachment = { name: "photo.png", path: ".codex-uploads/photo.png", kind: "image" };
    const message: Message = {
      id: "message",
      sessionId: "session",
      role: "user",
      content: `${text}\n附件说明`,
      dataJson: JSON.stringify({
        displayMessage: text,
        turnOptions: { attachments: [attachment] }
      }),
      itemId: null,
      providerId: null,
      eventType: null,
      createdAt: 1,
      updatedAt: 1
    };
    const draft = messageRewindDraft(message);
    expect(draft.text).toBe(text);
    expect(draft.attachments).toMatchObject([
      { name: attachment.name, existingPath: attachment.path, kind: "image" }
    ]);
    expect(parseComposerDraft(stringifyComposerDraft(draft.text, draft.attachments))).toEqual(
      draft
    );
  });
  it("starts with an empty draft after an assistant response", () => {
    expect(messageRewindDraft(null)).toEqual({ text: "", attachments: [] });
  });
});
