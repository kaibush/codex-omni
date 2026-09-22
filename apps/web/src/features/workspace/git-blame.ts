export type GitBlameLine = {
  hash: string;
  shortHash: string;
  author: string;
  time: number;
  summary: string;
  committed: boolean;
};

export type GitBlameResult = {
  path: string;
  available: boolean;
  message: string;
  lines: GitBlameLine[];
};

const BLAME_STORAGE_KEY = "codex-omni-editor-blame";

export function readBlameEnabled() {
  try {
    return localStorage.getItem(BLAME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBlameEnabled(enabled: boolean) {
  try {
    localStorage.setItem(BLAME_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage can be unavailable in private browsing.
  }
}

export function gitTextLineCount(value: string) {
  if (!value) return 0;
  const parts = value.split("\n");
  return value.endsWith("\n") ? parts.length - 1 : parts.length;
}

export function blameHue(hash: string) {
  let value = 0;
  for (let index = 0; index < hash.length; index += 1) {
    value = (value * 33 + hash.charCodeAt(index)) >>> 0;
  }
  return value % 360;
}

function shorten(value: string, max: number) {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function blameDate(time: number, now = Date.now()) {
  if (!time) return "";
  const date = new Date(time * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const current = new Date(now);
  if (date.getFullYear() === current.getFullYear()) return `${month}-${day}`;
  return `${date.getFullYear()}-${month}-${day}`;
}

export function blameLabel(line: GitBlameLine, now = Date.now()) {
  if (!line.committed) return "未提交";
  return [shorten(line.author || "未知", 12), blameDate(line.time, now), shorten(line.summary, 28)]
    .filter(Boolean)
    .join("  ");
}

export function blameTooltip(line: GitBlameLine) {
  if (!line.committed) return "未提交的本地修改";
  const date = line.time ? new Date(line.time * 1000).toLocaleString() : "";
  return [line.shortHash, line.author, date, line.summary, "点击在 Git 历史中打开"]
    .filter(Boolean)
    .join("\n");
}

export function blameMatchesDocument(content: string, lines: readonly GitBlameLine[]) {
  return gitTextLineCount(content) === lines.length;
}
