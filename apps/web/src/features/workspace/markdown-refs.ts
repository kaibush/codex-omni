export const FILE_REF_PATTERN = /(^|[\s`])@?((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+):(\d+)\b/g;

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

export function linkFileRefs(text: string) {
  return text.replace(
    FILE_REF_PATTERN,
    (_match, prefix: string, path: string, line: string) =>
      `${prefix}[${path}:${line}](codex-file:${encodeURIComponent(path)}?line=${line})`
  );
}

export function parseCodexFileHref(href: string | undefined) {
  if (!href?.startsWith("codex-file:")) return null;
  const body = href.slice("codex-file:".length);
  const [rawPath, query = ""] = body.split("?");
  if (!rawPath) return null;
  const line = Number(new URLSearchParams(query).get("line"));
  return {
    path: decodeURIComponent(rawPath),
    line: Number.isFinite(line) && line > 0 ? line : null
  };
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
