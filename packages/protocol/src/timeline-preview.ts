export const TIMELINE_PREVIEW_CHARS = 12_000;
export const TIMELINE_ASSISTANT_PREVIEW_CHARS = 80_000;
export const TIMELINE_JSON_STRING_CHARS = 8_000;

const DUPLICATE_CONTENT_FIELDS = ["text", "output", "message"] as const;
const DIFF_KEYS = new Set(["diff", "patch", "unifiedDiff"]);

export type TextPreview = {
  text: string;
  truncated: boolean;
  originalLength: number;
};

export type TimelinePreviewItem = {
  kind: string;
  text?: string;
  data?: unknown;
  streaming?: boolean;
};

export function previewLimitForKind(kind: string) {
  if (kind === "assistant" || kind === "user" || kind === "reasoning" || kind === "system") {
    return TIMELINE_ASSISTANT_PREVIEW_CHARS;
  }
  return TIMELINE_PREVIEW_CHARS;
}

export function previewText(
  text: string,
  limit: number,
  options?: { tail?: boolean }
): TextPreview {
  const originalLength = text.length;
  if (originalLength <= limit) return { text, truncated: false, originalLength };
  if (options?.tail) {
    let slice = text.slice(-limit);
    const firstNewline = slice.indexOf("\n");
    if (firstNewline >= 0 && firstNewline < Math.floor(limit * 0.4)) {
      slice = slice.slice(firstNewline + 1);
    }
    return { text: slice, truncated: true, originalLength };
  }
  let slice = text.slice(0, limit);
  const lastNewline = slice.lastIndexOf("\n");
  if (lastNewline > Math.floor(limit * 0.6)) slice = slice.slice(0, lastNewline);
  return { text: slice, truncated: true, originalLength };
}

export function compactJsonData(
  value: unknown,
  limit = TIMELINE_JSON_STRING_CHARS,
  options?: { skipKeys?: string[] }
): { value: unknown; truncated: boolean; originalLength: number } {
  const skip = new Set(options?.skipKeys ?? []);
  let truncated = false;
  let originalLength = 0;
  const walk = (input: unknown, key?: string): unknown => {
    if (key && skip.has(key)) return input;
    if (typeof input === "string") {
      if (input.length <= limit) return input;
      truncated = true;
      originalLength = Math.max(originalLength, input.length);
      if (key && DIFF_KEYS.has(key)) return "";
      return previewText(input, limit).text;
    }
    if (Array.isArray(input)) {
      let changed = false;
      const next = input.map((item) => {
        const value = walk(item);
        if (value !== item) changed = true;
        return value;
      });
      return changed ? next : input;
    }
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      let changed = false;
      const output: Record<string, unknown> = {};
      for (const [nextKey, nextValue] of Object.entries(record)) {
        if (nextKey === "outputDelta") {
          changed = true;
          if (typeof nextValue === "string" && nextValue.length) {
            truncated = true;
            originalLength = Math.max(originalLength, nextValue.length);
          }
          continue;
        }
        const value = walk(nextValue, nextKey);
        output[nextKey] = value;
        if (value !== nextValue) changed = true;
      }
      return changed ? output : input;
    }
    return input;
  };
  return { value: walk(value), truncated, originalLength };
}

export function compactTimelineItem<T extends TimelinePreviewItem>(
  item: T,
  options?: { preview?: boolean }
): T {
  if (options?.preview === false) return item;
  const originalText = item.text ?? "";
  let text = originalText;
  let truncated = false;
  let originalLength = originalText.length;
  let data = item.data;
  let dataChanged = false;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    let record = data as Record<string, unknown>;
    let copied = false;
    for (const field of DUPLICATE_CONTENT_FIELDS) {
      if (record[field] !== originalText) continue;
      if (!copied) {
        record = { ...record };
        copied = true;
      }
      delete record[field];
    }
    if (copied) {
      data = record;
      dataChanged = true;
    }
  }

  if (originalText) {
    const preview = previewText(originalText, previewLimitForKind(item.kind), {
      tail: item.streaming === true
    });
    if (preview.truncated) {
      text = preview.text;
      truncated = true;
      originalLength = preview.originalLength;
    }
  }

  if (data !== undefined) {
    const compacted = compactJsonData(data, TIMELINE_JSON_STRING_CHARS, { skipKeys: ["items"] });
    if (compacted.truncated) {
      data = compacted.value;
      dataChanged = true;
      truncated = true;
      originalLength = Math.max(originalLength, compacted.originalLength);
    }
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    let record = data as Record<string, unknown>;
    let copied = dataChanged;
    const ensureCopy = () => {
      if (!copied) {
        record = { ...record };
        copied = true;
      }
    };
    for (const field of DUPLICATE_CONTENT_FIELDS) {
      if (record[field] !== text && record[field] !== originalText) continue;
      ensureCopy();
      delete record[field];
    }
    if (truncated) {
      ensureCopy();
      record.previewTruncated = true;
      record.originalLength = originalLength;
    }
    if (copied) {
      data = record;
      dataChanged = true;
    }
  } else if (truncated) {
    data = { previewTruncated: true, originalLength };
    dataChanged = true;
  }

  if (!truncated && text === originalText && !dataChanged) return item;
  return {
    ...item,
    ...(text !== originalText ? { text } : {}),
    ...(dataChanged ? { data } : {})
  };
}
