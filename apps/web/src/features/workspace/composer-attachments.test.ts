import { describe, expect, it } from "vitest";
import {
  attachmentUploadPath,
  buildAttachmentPrompt,
  collectComposerAttachments,
  estimateComposerContext,
  formatContextEstimate,
  mergeAttachments,
  parseComposerDraft,
  queueDisplayMessage,
  queuePreviewText,
  queuedAttachmentMeta,
  sendBlockReason,
  stringifyComposerDraft,
  approvalSummary,
  type ComposerAttachment
} from "./composer-attachments";

function attachment(
  partial: Partial<ComposerAttachment> & Pick<ComposerAttachment, "id" | "name">
): ComposerAttachment {
  const text = partial.text;
  const bytes = partial.bytes ?? new TextEncoder().encode(text ?? partial.name);
  return {
    size: bytes.byteLength,
    mime: "text/plain",
    kind: "text",
    bytes,
    ...partial
  };
}

describe("composer attachments", () => {
  it("builds upload paths, prompts and context estimates", () => {
    expect(attachmentUploadPath("notes.md", 1700000000000)).toBe(
      ".codex-uploads/1700000000000-notes.md"
    );
    const prompt = buildAttachmentPrompt([
      { name: "notes.md", path: ".codex-uploads/1-notes.md", kind: "text", text: "hello" },
      { name: "shot.png", path: ".codex-uploads/1-shot.png", kind: "image" }
    ]);
    expect(prompt).toContain("`.codex-uploads/1-notes.md`");
    expect(prompt).toContain('<file path=".codex-uploads/1-notes.md">');
    expect(
      formatContextEstimate("abcd", [attachment({ id: "1", name: "a.txt", text: "hello" })])
    ).toContain("tokens");
    expect(estimateComposerContext("abcd", []).tokens).toBe(1);
  });

  it("merges attachments with count and size limits", async () => {
    const first = await collectComposerAttachments(
      [],
      [
        {
          name: "a.txt",
          type: "text/plain",
          size: 5,
          arrayBuffer: async () => new TextEncoder().encode("hello").buffer
        }
      ],
      () => "att-1"
    );
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.kind).toBe("text");
    const overflow = mergeAttachments(
      Array.from({ length: 8 }, (_, index) =>
        attachment({ id: String(index), name: `${index}.txt` })
      ),
      [attachment({ id: "x", name: "more.txt" })]
    );
    expect(overflow.error).toContain("最多添加");
    expect(overflow.items).toHaveLength(8);
  });

  it("round-trips drafts and queue previews", () => {
    const item = attachment({ id: "1", name: "note.txt", text: "saved" });
    const raw = stringifyComposerDraft("draft text", [item]);
    const parsed = parseComposerDraft(raw);
    expect(parsed.text).toBe("draft text");
    expect(parsed.attachments[0]?.text).toBe("saved");
    expect(parseComposerDraft("plain draft").text).toBe("plain draft");
    expect(
      queuePreviewText({
        message: "expanded file contents ".repeat(20),
        options: { displayMessage: "please review this" }
      })
    ).toBe("please review this");
    expect(queueDisplayMessage({ message: "fallback" })).toBe("fallback");
    expect(
      queuedAttachmentMeta({
        attachments: [{ name: "a.png", path: ".codex-uploads/a.png", kind: "image" }]
      })
    ).toEqual([{ name: "a.png", path: ".codex-uploads/a.png", kind: "image" }]);
  });

  it("explains send blocks and pending approvals without blocking the composer", () => {
    expect(sendBlockReason({ hasSession: false, hasProvider: true, hasContent: true })).toContain(
      "Session"
    );
    expect(sendBlockReason({ hasSession: true, hasProvider: false, hasContent: true })).toContain(
      "Provider"
    );
    expect(sendBlockReason({ hasSession: true, hasProvider: true, hasContent: false })).toContain(
      "附件"
    );
    expect(sendBlockReason({ hasSession: true, hasProvider: true, hasContent: true })).toBeNull();
    expect(approvalSummary(0)).toBeNull();
    expect(approvalSummary(2)).toContain("待审批 2 条");
  });
});
