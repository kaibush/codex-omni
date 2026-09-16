export type FileEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink";
  size?: number;
  mtimeMs?: number;
  hidden?: boolean;
};

export type DirectoryResult = { path: string; entries: FileEntry[] };

export type OpenFileRequest = {
  path: string;
  line: number | null;
  nonce: number;
};

export type FilePreview = {
  path: string;
  content: string;
  size: number;
  revision: string;
  writable: boolean;
};

export type FileMeta = {
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  mtimeMs: number;
  writable: boolean;
  revision: string | null;
  text: boolean;
};

export type FileSearchMatch = {
  path: string;
  type: "file" | "directory" | "symlink";
  kind: "name" | "content";
  line?: number;
  text?: string;
};

export type FileSearchResult = {
  query: string;
  truncated: boolean;
  scanned: number;
  matches: FileSearchMatch[];
};

export type EditorMode = "edit" | "preview" | "diff";
export type FileSort = "name" | "type" | "mtime";
export type PreviewKind = "text" | "markdown" | "image" | "pdf" | "audio" | "video" | "binary";

export type LanguageSymbol = {
  name: string;
  kind: string;
  line: number;
  column: number;
  children?: LanguageSymbol[];
};

export type LanguageDiagnostic = {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
};

export type LanguageDefinition = {
  path: string;
  line: number;
  column: number;
};

export type LanguageAnalysis = {
  symbols: LanguageSymbol[];
  diagnostics: LanguageDiagnostic[];
  definition: LanguageDefinition | null;
};

export type EditorTab = {
  path: string;
  content: string;
  draft: string;
  revision: string;
  writable: boolean;
  size: number;
  mode: EditorMode;
  split: boolean;
  line: number | null;
  conflict: { revision: string; content: string } | null;
  previewKind: PreviewKind;
};

export const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;
const CODEX_UPLOADS_MARKER = "/.codex-uploads/";
const SYSTEM_ABSOLUTE_SEGMENTS = new Set([
  "tmp",
  "var",
  "usr",
  "etc",
  "dev",
  "proc",
  "sys",
  "opt",
  "home",
  "private",
  "mnt",
  "media",
  "boot",
  "run",
  "root",
  "users",
  "volumes",
  "workspace",
  "workspaces"
]);
const REPO_RELATIVE_FIRST_SEGMENTS = new Set([
  "apps",
  "packages",
  "src",
  "lib",
  "docs",
  "web",
  "server",
  "client",
  "frontend",
  "backend",
  "services",
  "features",
  "modules",
  "crates",
  "cmd",
  "pkg",
  "internal",
  "tools",
  "scripts",
  "examples",
  "tests",
  "test",
  "shared",
  "components",
  "pages",
  "e2e",
  "fixtures",
  "proto",
  "apis",
  "types",
  "plugins",
  "addons",
  "website",
  "android",
  "ios",
  "desktop",
  "electron",
  "config",
  "configs",
  "public",
  "assets",
  "content",
  "core",
  "common",
  "utils",
  "helpers",
  "hooks",
  "store",
  "stores",
  "ui",
  "infra",
  "deploy"
]);

export function joinProjectPath(directory: string, name: string) {
  const parent = directory.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const base = name.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!base) return parent;
  return parent ? `${parent}/${base}` : base;
}

function toPosixPath(value: string) {
  return value.replace(/\\/g, "/");
}

function positiveInt(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseFileLocation(inputPath: string) {
  let raw = toPosixPath(inputPath).trim().replace(/^['"`]+/, "").replace(/['"`]+$/, "");
  if (/^file:\/\//i.test(raw)) {
    raw = raw.replace(/^file:\/\//i, "");
    if (raw.toLowerCase().startsWith("localhost")) raw = raw.slice("localhost".length);
  }
  raw = raw.replace(/^@/, "");
  let line: number | null = null;
  let column: number | null = null;
  const hashMatch = raw.match(/^(.*)#L(\d+)(?:C(\d+))?$/i);
  if (hashMatch?.[1] != null && hashMatch[2]) {
    raw = hashMatch[1];
    line = positiveInt(hashMatch[2]);
    column = positiveInt(hashMatch[3]);
  } else {
    const colonMatch = raw.match(/^(.*?):(\d+)(?::(\d+))?$/);
    if (colonMatch?.[1] && colonMatch[2] && !/^[A-Za-z]:$/.test(colonMatch[1])) {
      raw = colonMatch[1];
      line = positiveInt(colonMatch[2]);
      column = positiveInt(colonMatch[3]);
    }
  }
  return {
    path: raw.trim(),
    line,
    column
  };
}

export function isFilesystemAbsolutePath(path: string) {
  const raw = toPosixPath(path).trim();
  return raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
}

function stripGitDiffPrefix(raw: string) {
  return raw.replace(/^(?:a|b)\//, "");
}

function normalizeRelativeCandidate(raw: string) {
  return stripGitDiffPrefix(raw.replace(/^\.\//, "")).replace(/\/+$/, "");
}

function relativeUnderRoot(raw: string, root: string) {
  const normalizedRoot = toPosixPath(root).replace(/\/+$/, "");
  if (!normalizedRoot) return null;
  if (raw === normalizedRoot) return null;
  const prefix = `${normalizedRoot}/`;
  if (!raw.startsWith(prefix)) return null;
  return raw.slice(prefix.length).replace(/\/+$/, "") || null;
}

function relativeFromUploads(raw: string) {
  if (raw.startsWith(".codex-uploads/")) return raw.replace(/\/+$/, "");
  const index = raw.indexOf(CODEX_UPLOADS_MARKER);
  if (index === -1) return null;
  return raw.slice(index + 1).replace(/\/+$/, "") || null;
}

function relativeFromWorkspaceMount(raw: string, root: string) {
  const base = toPosixPath(root).replace(/\/+$/, "").split("/").filter(Boolean).at(-1);
  if (!base) return null;
  for (const prefix of [`/workspace/${base}/`, `/workspaces/${base}/`]) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length).replace(/\/+$/, "") || null;
  }
  return null;
}

function firstPathSegment(raw: string) {
  return raw.replace(/^\/+/, "").split("/")[0]?.toLowerCase() ?? "";
}

function looksLikeRepoRelativeAbsolute(raw: string, roots: string[]) {
  if (!raw.startsWith("/")) return false;
  const first = firstPathSegment(raw);
  if (!first || SYSTEM_ABSOLUTE_SEGMENTS.has(first) || !REPO_RELATIVE_FIRST_SEGMENTS.has(first)) {
    return false;
  }
  return !roots.some((root) => firstPathSegment(root) === first);
}

export function toProjectRelativePath(inputPath: string, ...projectRoots: Array<string | null | undefined>) {
  const location = parseFileLocation(inputPath);
  const raw = location.path;
  if (!raw) return null;
  const roots = [
    ...new Set(projectRoots.map((root) => toPosixPath(root ?? "").replace(/\/+$/, "")).filter(Boolean))
  ];
  for (const root of roots) {
    const relative = relativeUnderRoot(raw, root);
    if (relative) return relative;
  }
  for (const root of roots) {
    const relative = relativeFromWorkspaceMount(raw, root);
    if (relative) return relative;
  }
  const uploads = relativeFromUploads(raw);
  if (uploads) return uploads;
  if (!isFilesystemAbsolutePath(raw)) {
    return normalizeRelativeCandidate(raw) || null;
  }
  if (looksLikeRepoRelativeAbsolute(raw, roots)) {
    return normalizeRelativeCandidate(raw.replace(/^\/+/, "")) || null;
  }
  return null;
}

export function resolveOpenableFilePath(
  inputPath: string,
  ...projectRoots: Array<string | null | undefined>
) {
  const location = parseFileLocation(inputPath);
  const raw = location.path;
  if (!raw) return null;
  const relative = toProjectRelativePath(raw, ...projectRoots);
  if (relative) {
    return { path: relative, line: location.line, column: location.column, external: false };
  }
  if (isFilesystemAbsolutePath(raw)) {
    return { path: raw, line: location.line, column: location.column, external: true };
  }
  return null;
}

export function parentProjectPath(relativePath: string) {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function ancestorPaths(relativePath: string) {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return [] as string[];
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function treeFilterPaths(matchedPaths: string[]) {
  const visible = new Set<string>();
  for (const item of matchedPaths) {
    const normalized = item.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalized) continue;
    visible.add(normalized);
    for (const ancestor of ancestorPaths(normalized)) visible.add(ancestor);
  }
  return visible;
}

/** Drop nested paths when a parent folder is already selected. */
export function compactSelectedPaths(paths: Iterable<string>) {
  const normalized = [
    ...new Set(
      [...paths].map((item) => item.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean)
    )
  ].sort();
  const compact: string[] = [];
  for (const path of normalized) {
    if (compact.some((parent) => path.startsWith(`${parent}/`))) continue;
    compact.push(path);
  }
  return compact;
}

export function flattenVisibleFileEntries(
  directories: Record<string, FileEntry[]>,
  options: {
    expanded: Iterable<string>;
    query: string;
    showHidden: boolean;
    sort: FileSort;
    keepPaths?: Set<string> | null;
  }
) {
  const expanded = new Set(options.expanded);
  const result: FileEntry[] = [];
  const walk = (directory: string) => {
    const entries = visibleFileEntries(directories[directory] ?? [], {
      query: options.query,
      showHidden: options.showHidden,
      sort: options.sort,
      keepPaths: options.keepPaths ?? null
    });
    for (const entry of entries) {
      result.push(entry);
      if (entry.type === "directory" && expanded.has(entry.path)) walk(entry.path);
    }
  };
  walk("");
  return result;
}

export function fileName(relativePath: string) {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? relativePath;
}

export function suggestedCopyPath(relativePath: string) {
  const directory = parentProjectPath(relativePath);
  const name = fileName(relativePath);
  const dot = name.includes(".") ? name.lastIndexOf(".") : -1;
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  return joinProjectPath(directory, `${stem} copy${extension}`);
}

export function sortFileEntries(entries: FileEntry[], sort: FileSort) {
  const copy = [...entries];
  copy.sort((left, right) => {
    if (sort === "type" || sort === "name") {
      if (left.type !== right.type) {
        if (left.type === "directory") return -1;
        if (right.type === "directory") return 1;
      }
    }
    if (sort === "mtime") {
      return (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0) || left.name.localeCompare(right.name);
    }
    if (sort === "type" && left.type !== right.type) {
      return left.type.localeCompare(right.type);
    }
    return left.name.localeCompare(right.name);
  });
  return copy;
}

export function visibleFileEntries(
  entries: FileEntry[],
  options: {
    query: string;
    showHidden: boolean;
    sort: FileSort;
    keepPaths?: Set<string> | null;
  }
) {
  const query = options.query.trim().toLowerCase();
  const keepPaths = options.keepPaths;
  return sortFileEntries(
    entries.filter((entry) => {
      if (!options.showHidden && (entry.hidden || entry.name.startsWith("."))) return false;
      if (!query) return true;
      if (keepPaths && keepPaths.size > 0) return keepPaths.has(entry.path);
      return entry.name.toLowerCase().includes(query);
    }),
    options.sort
  );
}

export function isMarkdownFile(name: string) {
  return /\.mdx?$/i.test(name);
}

export function languageFor(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    css: "css",
    scss: "scss",
    html: "markup",
    xml: "markup",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    sql: "sql",
    sh: "bash"
  };
  return (extension && languages[extension]) || "text";
}

type DiffOp = { type: "eq" | "del" | "add"; line: string };

const DIFF_CONTEXT = 3;
const DIFF_LCS_LIMIT = 400_000;
const DIFF_HUNK_LINE_CAP = 4_000;

function commonPrefixLength(previous: string[], next: string[]) {
  const max = Math.min(previous.length, next.length);
  let index = 0;
  while (index < max && previous[index] === next[index]) index += 1;
  return index;
}

function commonSuffixLength(previous: string[], next: string[], prefix: number) {
  let index = 0;
  while (
    index < previous.length - prefix &&
    index < next.length - prefix &&
    previous[previous.length - 1 - index] === next[next.length - 1 - index]
  ) {
    index += 1;
  }
  return index;
}

function lcsOperations(previous: string[], next: string[]): DiffOp[] {
  if (!previous.length) return next.map((line) => ({ type: "add" as const, line }));
  if (!next.length) return previous.map((line) => ({ type: "del" as const, line }));
  if (previous.length * next.length > DIFF_LCS_LIMIT) {
    return [
      ...previous.map((line) => ({ type: "del" as const, line })),
      ...next.map((line) => ({ type: "add" as const, line }))
    ];
  }
  const rows = previous.length + 1;
  const cols = next.length + 1;
  const table = Array.from({ length: rows }, () => new Int32Array(cols));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i]![j] =
        previous[i - 1] === next[j - 1]
          ? (table[i - 1]![j - 1] ?? 0) + 1
          : Math.max(table[i - 1]![j] ?? 0, table[i]![j - 1] ?? 0);
    }
  }
  const operations: DiffOp[] = [];
  let i = previous.length;
  let j = next.length;
  while (i > 0 && j > 0) {
    if (previous[i - 1] === next[j - 1]) {
      operations.push({ type: "eq", line: previous[i - 1] ?? "" });
      i -= 1;
      j -= 1;
    } else if ((table[i - 1]![j] ?? 0) >= (table[i]![j - 1] ?? 0)) {
      operations.push({ type: "del", line: previous[i - 1] ?? "" });
      i -= 1;
    } else {
      operations.push({ type: "add", line: next[j - 1] ?? "" });
      j -= 1;
    }
  }
  while (i > 0) {
    i -= 1;
    operations.push({ type: "del", line: previous[i] ?? "" });
  }
  while (j > 0) {
    j -= 1;
    operations.push({ type: "add", line: next[j] ?? "" });
  }
  operations.reverse();
  return operations;
}

function lineOperations(previous: string[], next: string[]): DiffOp[] {
  const prefix = commonPrefixLength(previous, next);
  const suffix = commonSuffixLength(previous, next, prefix);
  return [
    ...previous.slice(0, prefix).map((line) => ({ type: "eq" as const, line })),
    ...lcsOperations(
      previous.slice(prefix, previous.length - suffix),
      next.slice(prefix, next.length - suffix)
    ),
    ...previous.slice(previous.length - suffix).map((line) => ({ type: "eq" as const, line }))
  ];
}

function emitUnifiedHunks(operations: DiffOp[], context = DIFF_CONTEXT) {
  type Marked = DiffOp & { oldLine: number; newLine: number };
  let oldLine = 1;
  let newLine = 1;
  const marked: Marked[] = operations.map((operation) => {
    const row = { ...operation, oldLine, newLine };
    if (operation.type === "eq") {
      oldLine += 1;
      newLine += 1;
    } else if (operation.type === "del") {
      oldLine += 1;
    } else {
      newLine += 1;
    }
    return row;
  });
  const changeIndexes = marked.flatMap((operation, index) =>
    operation.type === "eq" ? [] : [index]
  );
  if (!changeIndexes.length) return [];

  const hunks: string[] = [];
  let cursor = 0;
  while (cursor < changeIndexes.length) {
    let groupEnd = cursor;
    while (
      groupEnd + 1 < changeIndexes.length &&
      changeIndexes[groupEnd + 1]! - changeIndexes[groupEnd]! - 1 <= context * 2
    ) {
      groupEnd += 1;
    }
    const start = Math.max(0, changeIndexes[cursor]! - context);
    const end = Math.min(marked.length, changeIndexes[groupEnd]! + 1 + context);
    let slice = marked.slice(start, end);
    let truncated = false;
    if (slice.length > DIFF_HUNK_LINE_CAP) {
      slice = slice.slice(0, DIFF_HUNK_LINE_CAP);
      truncated = true;
    }
    const oldCount = slice.filter((operation) => operation.type !== "add").length;
    const newCount = slice.filter((operation) => operation.type !== "del").length;
    const oldStart =
      oldCount === 0 ? 0 : (slice.find((operation) => operation.type !== "add")?.oldLine ?? 0);
    const newStart =
      newCount === 0 ? 0 : (slice.find((operation) => operation.type !== "del")?.newLine ?? 0);
    hunks.push(
      [
        `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${truncated ? " 内容过多，仅显示部分差异" : ""}`,
        ...slice.map((operation) => {
          if (operation.type === "eq") return ` ${operation.line}`;
          if (operation.type === "del") return `-${operation.line}`;
          return `+${operation.line}`;
        })
      ].join("\n")
    );
    cursor = groupEnd + 1;
  }
  return hunks;
}

export function unifiedDiff(before: string, after: string, filePath: string) {
  if (before === after) return "";
  const previous = before.split("\n");
  const next = after.split("\n");
  const hunks = emitUnifiedHunks(lineOperations(previous, next));
  if (!hunks.length) return "";
  return [`--- a/${filePath}`, `+++ b/${filePath}`, ...hunks].join("\n");
}

export function previewKindFor(path: string, text = false): PreviewKind {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"].includes(extension)) {
    return "image";
  }
  if (extension === "pdf") return "pdf";
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(extension)) return "audio";
  if (["mp4", "webm", "mov", "mkv"].includes(extension)) return "video";
  if (["md", "mdx", "markdown"].includes(extension)) return "markdown";
  if (text) return "text";
  return "binary";
}

export function isMediaPreview(kind: PreviewKind) {
  return (
    kind === "image" || kind === "pdf" || kind === "audio" || kind === "video" || kind === "binary"
  );
}

export function tabFromPreview(preview: FilePreview, line: number | null = null): EditorTab {
  const previewKind = previewKindFor(preview.path, true);
  return {
    path: preview.path,
    content: preview.content,
    draft: preview.content,
    revision: preview.revision,
    writable: preview.writable,
    size: preview.size,
    mode: previewKind === "markdown" ? "preview" : "edit",
    split: false,
    line,
    conflict: null,
    previewKind
  };
}

export function tabFromMedia(input: {
  path: string;
  size: number;
  revision: string;
  writable: boolean;
  previewKind: PreviewKind;
}): EditorTab {
  return {
    path: input.path,
    content: "",
    draft: "",
    revision: input.revision,
    writable: input.writable,
    size: input.size,
    mode: "preview",
    split: false,
    line: null,
    conflict: null,
    previewKind: input.previewKind
  };
}
