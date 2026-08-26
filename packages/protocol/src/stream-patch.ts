export const MAX_TOOL_OUTPUT_CHARS = 120_000;

export type StreamTextPayload = {
  text?: unknown;
  delta?: unknown;
};

export function textPatch(previous: string, next: string) {
  if (next.startsWith(previous)) return { delta: next.slice(previous.length) };
  return { text: next };
}

export function applyTextPatch(current: string, payload: StreamTextPayload) {
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.delta === "string") return `${current}${payload.delta}`;
  return current;
}

export function truncateToolText(text: string, limit = MAX_TOOL_OUTPUT_CHARS) {
  if (text.length <= limit) return { text, truncated: false as const };
  const omitted = text.length - limit;
  return {
    text: `${text.slice(0, limit)}\n… truncated ${omitted} characters`,
    truncated: true as const
  };
}

export function compactStreamEvent<T extends { type: string; payload?: unknown }>(event: T): T {
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return event;
  const record = payload as Record<string, unknown>;
  if (
    (event.type === "assistant.delta" || event.type === "reasoning.delta") &&
    typeof record.delta === "string" &&
    record.text != null
  ) {
    const rest = { ...record };
    delete rest.text;
    return { ...event, payload: rest };
  }
  if (
    event.type === "tool.output" &&
    typeof record.outputDelta === "string" &&
    record.output != null
  ) {
    const rest = { ...record };
    delete rest.output;
    return { ...event, payload: rest };
  }
  return event;
}
