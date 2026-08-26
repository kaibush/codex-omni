export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_TOTAL_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_UPLOAD_DIR = ".codex-uploads";
const DRAFT_PERSIST_LIMIT = 1_200_000;

export type ComposerAttachmentKind = "image" | "text" | "file";

export type ComposerAttachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: ComposerAttachmentKind;
  text?: string;
  previewUrl?: string;
  bytes: Uint8Array;
};

export type SerializedComposerAttachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: ComposerAttachmentKind;
  text?: string;
  previewUrl?: string;
  bytesBase64?: string;
};

export type ComposerDraft = {
  v: 1;
  text: string;
  attachments: SerializedComposerAttachment[];
};

export type FileLike = {
  name: string;
  type?: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type QueuedAttachmentMeta = {
  name: string;
  path: string;
  kind: ComposerAttachmentKind;
};

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "html",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ini",
  "csv",
  "log",
  "sh",
  "env",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "sql"
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

export function fileExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "").toLowerCase() : "";
}

export function attachmentKind(name: string, mime = ""): ComposerAttachmentKind {
  const type = mime.toLowerCase();
  const extension = fileExtension(name);
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (type.startsWith("text/") || type.includes("json") || TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return "file";
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function safeAttachmentName(name: string) {
  const base = name.replace(/[/\\]+/g, "_").replace(/^\.+/, "") || "attachment";
  return base.slice(0, 120);
}

export function attachmentUploadPath(name: string, now = Date.now()) {
  return `${ATTACHMENT_UPLOAD_DIR}/${now}-${safeAttachmentName(name)}`;
}

export function estimateComposerContext(input: string, attachments: ComposerAttachment[]) {
  const textChars =
    input.length +
    attachments.reduce((sum, item) => sum + (item.text?.length ?? item.name.length), 0);
  const bytes = attachments.reduce((sum, item) => sum + item.size, 0);
  return {
    chars: textChars,
    tokens: Math.max(0, Math.ceil(textChars / 4)),
    bytes
  };
}

export function formatContextEstimate(input: string, attachments: ComposerAttachment[]) {
  const estimate = estimateComposerContext(input, attachments);
  const parts = [`约 ${estimate.tokens.toLocaleString()} tokens`];
  if (estimate.bytes > 0) parts.push(formatBytes(estimate.bytes));
  return parts.join(" · ");
}

export function buildAttachmentPrompt(
  attachments: Array<{ name: string; path: string; kind: ComposerAttachmentKind; text?: string }>
) {
  if (!attachments.length) return "";
  const lines = ["附件已保存到当前工程，请读取这些文件："];
  for (const item of attachments) {
    const kindLabel = item.kind === "image" ? "图片" : item.kind === "text" ? "文本" : "文件";
    lines.push(`- \`${item.path}\`（${kindLabel} · ${item.name}）`);
  }
  const textFiles = attachments.filter((item) => item.kind === "text" && item.text);
  if (textFiles.length) {
    lines.push("");
    for (const item of textFiles) {
      lines.push(`<file path="${item.path}">\n${item.text?.slice(0, 80_000)}\n</file>`);
    }
  }
  return lines.join("\n");
}

export function sendBlockReason(input: {
  hasSession: boolean;
  hasProvider: boolean;
  hasContent: boolean;
  sending?: boolean;
}) {
  if (input.sending) return "正在处理附件和发送";
  if (!input.hasSession) return "Session 尚未加载完成，请稍后再试";
  if (!input.hasProvider) return "请先选择一个 Provider";
  if (!input.hasContent) return "请输入消息或添加附件";
  return null;
}

export function approvalSummary(pendingApprovals: number) {
  if (pendingApprovals <= 0) return null;
  return `待审批 ${pendingApprovals} 条，处理前不会开始新的 turn；现在发送会加入队列`;
}

export function queueDisplayMessage(item: {
  message: string;
  options?: Record<string, unknown> | null;
}) {
  const display = item.options?.displayMessage;
  return typeof display === "string" && display.trim() ? display : item.message;
}

export function queuePreviewText(item: {
  message: string;
  options?: Record<string, unknown> | null;
}) {
  const compact = queueDisplayMessage(item).replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

export function queuedAttachmentMeta(
  options?: Record<string, unknown> | null
): QueuedAttachmentMeta[] {
  const value = options?.attachments;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.path !== "string") return [];
    const kind =
      record.kind === "image" || record.kind === "text" || record.kind === "file"
        ? record.kind
        : "file";
    return [{ name: record.name, path: record.path, kind }];
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x2000;
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    let part = "";
    for (let offset = 0; offset < slice.length; offset += 1) {
      part += String.fromCharCode(slice[offset]!);
    }
    binary += part;
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export async function readComposerAttachment(
  file: FileLike,
  id: string
): Promise<ComposerAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} 超过 ${formatBytes(MAX_ATTACHMENT_BYTES)} 限制`);
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const kind = attachmentKind(file.name, mime);
  const text = kind === "text" ? decodeText(buffer) : undefined;
  return {
    id,
    name: file.name,
    size: file.size,
    mime,
    kind: kind === "text" && !text ? "file" : kind,
    ...(text ? { text } : {}),
    ...(kind === "image"
      ? { previewUrl: `data:${mime || "image/png"};base64,${bytesToBase64(buffer)}` }
      : {}),
    bytes: buffer
  };
}

export function mergeAttachments(
  current: ComposerAttachment[],
  incoming: ComposerAttachment[]
): { items: ComposerAttachment[]; error?: string } {
  const next = [...current];
  for (const item of incoming) {
    if (next.length >= MAX_ATTACHMENTS) {
      return { items: next, error: `最多添加 ${MAX_ATTACHMENTS} 个附件` };
    }
    const total = next.reduce((sum, file) => sum + file.size, 0) + item.size;
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      return {
        items: next,
        error: `附件总大小不能超过 ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}`
      };
    }
    next.push(item);
  }
  return { items: next };
}

export async function collectComposerAttachments(
  current: ComposerAttachment[],
  files: FileLike[],
  idFactory: () => string
) {
  const incoming: ComposerAttachment[] = [];
  for (const file of files) {
    incoming.push(await readComposerAttachment(file, idFactory()));
  }
  return mergeAttachments(current, incoming);
}

export function filesFromDataTransfer(data: DataTransfer | null | undefined) {
  if (!data) return [];
  return [...data.files].filter((file) => file.size > 0 || file.type);
}

export function filesFromClipboard(data: DataTransfer | null | undefined) {
  return filesFromDataTransfer(data);
}

export function serializeAttachment(item: ComposerAttachment): SerializedComposerAttachment {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    mime: item.mime,
    kind: item.kind,
    ...(item.text ? { text: item.text } : {}),
    ...(item.previewUrl ? { previewUrl: item.previewUrl } : {}),
    bytesBase64: bytesToBase64(item.bytes)
  };
}

export function deserializeAttachment(
  item: SerializedComposerAttachment
): ComposerAttachment | null {
  const bytes = item.bytesBase64
    ? base64ToBytes(item.bytesBase64)
    : item.previewUrl?.includes("base64,")
      ? base64ToBytes(item.previewUrl.slice(item.previewUrl.indexOf("base64,") + 7))
      : item.text
        ? new TextEncoder().encode(item.text)
        : undefined;
  if (!bytes) return null;
  return {
    id: item.id,
    name: item.name,
    size: item.size || bytes.byteLength,
    mime: item.mime,
    kind: item.kind,
    ...(item.text ? { text: item.text } : {}),
    ...(item.previewUrl ? { previewUrl: item.previewUrl } : {}),
    bytes
  };
}

export function parseComposerDraft(raw: string | null): {
  text: string;
  attachments: ComposerAttachment[];
} {
  if (!raw) return { text: "", attachments: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>;
    if (parsed && parsed.v === 1 && typeof parsed.text === "string") {
      const attachments = Array.isArray(parsed.attachments)
        ? parsed.attachments.flatMap((item) => {
            const restored = deserializeAttachment(item);
            return restored ? [restored] : [];
          })
        : [];
      return { text: parsed.text, attachments };
    }
  } catch {
    // Older drafts were stored as plain text.
  }
  return { text: raw, attachments: [] };
}

export function stringifyComposerDraft(text: string, attachments: ComposerAttachment[]) {
  const payload: ComposerDraft = {
    v: 1,
    text,
    attachments: attachments.map(serializeAttachment)
  };
  let json = JSON.stringify(payload);
  if (json.length <= DRAFT_PERSIST_LIMIT) return json;
  payload.attachments = attachments.map((item) => ({
    id: item.id,
    name: item.name,
    size: item.size,
    mime: item.mime,
    kind: item.kind,
    ...(item.text ? { text: item.text } : {})
  }));
  json = JSON.stringify(payload);
  if (json.length <= DRAFT_PERSIST_LIMIT) return json;
  return JSON.stringify({ v: 1, text, attachments: [] } satisfies ComposerDraft);
}
