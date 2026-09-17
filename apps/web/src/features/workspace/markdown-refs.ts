import { parseFileLocation } from "./file-workspace";

export const FILE_PATH_PATTERN =
  String.raw`(?:\./)?(?:/?(?:[\w.-]+/)+[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,9}|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|vue|py|go|rs|java|kt|rb|php|yml|yaml|toml|xml|svg|png|jpg|jpeg|gif|webp|pdf|sh|bash|zsh|sql|txt|lock|map))`;

export const FILE_REF_PATTERN = new RegExp(
  String.raw`(^|[^A-Za-z0-9_./%~-])@?(${FILE_PATH_PATTERN})(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?)?\b`,
  "g"
);

const FENCE_PATTERN = /```[\s\S]*?```/g;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\([^)]*\)/g;
const INLINE_CODE_PATTERN = /(`+)([^`]*?)\1/g;
const SKIP_HREF_PATTERN = /^(?:https?:|mailto:|javascript:|#)/i;
const INLINE_CODE_FILE_PATTERN = new RegExp("`@?(" + FILE_PATH_PATTERN + ")(?::(\\d+)(?::\\d+)?|#L(\\d+)(?:C\\d+)?)?`", "g");

const LANGUAGE_EXT: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  javascript: "js",
  js: "js",
  tsx: "tsx",
  jsx: "jsx",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  json: "json",
  css: "css",
  html: "html",
  xml: "xml",
  markdown: "md",
  md: "md",
  yaml: "yml",
  yml: "yml",
  go: "go",
  sql: "sql",
  diff: "diff",
  txt: "txt"
};

function protectSegments(text: string, pattern: RegExp, store: string[]) {
  pattern.lastIndex = 0;
  return text.replace(pattern, (block) => {
    const token = `\0P${store.length}\0`;
    store.push(block);
    return token;
  });
}

function restoreSegments(text: string, store: string[]) {
  return text.replace(/\0P(\d+)\0/g, (_match, index: string) => store[Number(index)] ?? "");
}

export function sanitizeFileRef(path: string) {
  let value = path.trim();
  if (!value) return "";
  value = value.replace(/^['"`]+/, "").replace(/['"`]+$/, "");
  value = value.replace(/^<+/, "").replace(/>+$/, "");
  if (/^file:\/\//i.test(value)) {
    value = value.replace(/^file:\/\//i, "");
    if (value.toLowerCase().startsWith("localhost")) {
      value = value.slice("localhost".length);
    }
  }
  value = value.replace(/^@/, "");
  value = value.replace(/[),.;]+$/g, "");
  return value.trim();
}

function firstPathSegment(path: string) {
  return path.replace(/^\.\//, "").replace(/^\/+/, "").split("/")[0] ?? "";
}

function looksLikeHostedPath(path: string) {
  if (!path.includes("/")) return false;
  const first = firstPathSegment(path);
  return /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(first);
}

function looksLikeHomeOrDotRootPath(path: string) {
  return path.startsWith("~") || path.startsWith("/.");
}

export function looksLikeProjectFilePath(path: string) {
  const value = sanitizeFileRef(path).replace(/\\/g, "/");
  if (!value || value.includes("://") || value.startsWith("#")) return false;
  if (looksLikeHomeOrDotRootPath(value)) return false;
  if (looksLikeHostedPath(value)) return false;
  const pattern = new RegExp(`^(?:${FILE_PATH_PATTERN})$`);
  return pattern.test(value);
}

function fileRefHref(path: string, line?: string | number | null) {
  const lineNumber = typeof line === "number" ? line : Number(line);
  if (Number.isFinite(lineNumber) && lineNumber > 0) {
    return `codex-file:${encodeURIComponent(path)}?line=${lineNumber}`;
  }
  return `codex-file:${encodeURIComponent(path)}`;
}

function fileRefMarkdown(path: string, line?: string | number | null) {
  const lineNumber = typeof line === "number" ? line : Number(line);
  const label = Number.isFinite(lineNumber) && lineNumber > 0 ? `${path}:${lineNumber}` : path;
  return `[${label}](${fileRefHref(path, lineNumber)})`;
}

function convertInlineCodeFileRefs(block: string) {
  return block.replace(
    INLINE_CODE_FILE_PATTERN,
    (match, path: string, colonLine?: string, hashLine?: string) =>
      looksLikeProjectFilePath(path) ? fileRefMarkdown(path, colonLine || hashLine) : match
  );
}

export function linkFileRefs(text: string) {
  const protectedBlocks: string[] = [];
  let working = protectSegments(text, FENCE_PATTERN, protectedBlocks);
  working = protectSegments(working, MARKDOWN_LINK_PATTERN, protectedBlocks);
  working = working.replace(INLINE_CODE_PATTERN, (block) => {
    const converted = convertInlineCodeFileRefs(block);
    if (converted !== block) return converted;
    const token = `\0P${protectedBlocks.length}\0`;
    protectedBlocks.push(block);
    return token;
  });
  working = protectSegments(working, MARKDOWN_LINK_PATTERN, protectedBlocks);
  working = working.replace(
    FILE_REF_PATTERN,
    (match, prefix: string, path: string, colonLine: string | undefined, hashLine: string | undefined, offset: number) => {
      const start = offset + prefix.length;
      const before = working.slice(Math.max(0, start - 12), start);
      if (/[a-z]+:\/\/$/i.test(before)) return match;
      if (prefix === "~" || !looksLikeProjectFilePath(path)) return match;
      return `${prefix}${fileRefMarkdown(path, colonLine || hashLine)}`;
    }
  );
  return restoreSegments(working, protectedBlocks);
}

export function parseCodexFileHref(href: string | undefined) {
  if (!href?.startsWith("codex-file:")) return null;
  const body = href.slice("codex-file:".length);
  const [rawPath, query = ""] = body.split("?");
  if (!rawPath) return null;
  const path = sanitizeFileRef(decodeURIComponent(rawPath));
  if (!path) return null;
  const line = Number(new URLSearchParams(query).get("line"));
  return {
    path,
    line: Number.isFinite(line) && line > 0 ? line : null
  };
}

export function parseProjectFileHref(href: string | undefined) {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  const fromCodex = parseCodexFileHref(trimmed);
  if (fromCodex) return fromCodex;
  if (SKIP_HREF_PATTERN.test(trimmed)) return null;

  const located = parseFileLocation(trimmed);
  const raw = located.path.replace(/\\/g, "/");
  if (!raw) return null;
  if (!looksLikeProjectFilePath(raw) && !looksLikeRelativeOpenPath(raw) && !raw.startsWith("/")) return null;
  return {
    path: raw,
    line: located.line
  };
}

function looksLikeRelativeOpenPath(path: string) {
  if (!path || path.includes("://") || path.startsWith("#") || /\s/.test(path)) return false;
  if (looksLikeHostedPath(path)) return false;
  return /^(?:\.\/)?\/?(?:[\w.-]+\/)+[\w.-]+$/.test(path);
}

export function snippetFileName(language: string) {
  const key = language.trim().toLowerCase();
  const ext = LANGUAGE_EXT[key] ?? (key && key !== "代码" ? key.replace(/[^a-z0-9]+/g, "") : "txt");
  return `snippet.${ext || "txt"}`;
}

export function quoteMarkdown(text: string) {
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return "";
  return trimmed
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
