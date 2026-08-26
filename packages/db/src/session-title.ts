export const DEFAULT_SESSION_TITLE = "新对话";
const PLACEHOLDERS = new Set([DEFAULT_SESSION_TITLE, "New session"]);

export function isPlaceholderSessionTitle(title: string) {
  return PLACEHOLDERS.has(title.trim()) || title.trim() === "";
}

export function titleFromFirstMessage(content: string, maxLength = 36) {
  const firstLine = content.replace(/\r/g, "").split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!firstLine) return DEFAULT_SESSION_TITLE;
  const sentenceMatch = firstLine.match(/.*?[。！？.!?]/);
  const first = (sentenceMatch?.[0] ?? firstLine).replace(/[。！？.!?]+$/g, "").trim();
  const title = first || firstLine;
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength).trim()}…`;
}

export function resolveSessionTitle(title: string, firstUserMessage?: string | null) {
  if (firstUserMessage && isPlaceholderSessionTitle(title)) {
    return titleFromFirstMessage(firstUserMessage);
  }
  return title.trim() || DEFAULT_SESSION_TITLE;
}
