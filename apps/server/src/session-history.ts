import type { MessageRow } from "@codex-omni/db";
import { compactTimelineItem } from "@codex-omni/protocol";

function parseData(dataJson: string | null) {
  if (!dataJson) return undefined;
  try {
    return JSON.parse(dataJson) as unknown;
  } catch {
    return undefined;
  }
}

export function compactMessageForClient(
  message: MessageRow,
  options?: { preview?: boolean }
): MessageRow {
  const parsed = parseData(message.dataJson);
  const malformed = Boolean(message.dataJson) && parsed === undefined;
  const compacted = compactTimelineItem(
    {
      kind: message.role,
      text: message.content,
      ...(parsed === undefined ? {} : { data: parsed })
    },
    options
  );
  if (compacted.text === message.content && compacted.data === parsed) return message;
  let dataJson = message.dataJson;
  if (!malformed) {
    dataJson = compacted.data == null ? null : JSON.stringify(compacted.data);
  }
  return {
    ...message,
    content: compacted.text ?? "",
    dataJson
  };
}
