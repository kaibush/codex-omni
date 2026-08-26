export type DiffLine = {
  kind: "meta" | "hunk" | "add" | "del" | "ctx" | "note";
  text: string;
  hunkIndex: number | null;
  oldLine: number | null;
  newLine: number | null;
};

export function parseHunkHeader(header: string) {
  const match = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
  return {
    oldStart: match ? Number(match[1]) : 1,
    newStart: match ? Number(match[2]) : 1
  };
}

export function parseDiffView(diff: string): DiffLine[] {
  const rows: DiffLine[] = [];
  let hunkIndex = -1;
  let oldLine = 0;
  let newLine = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("@@ ")) {
      hunkIndex += 1;
      const header = parseHunkHeader(text);
      oldLine = header.oldStart;
      newLine = header.newStart;
      rows.push({ kind: "hunk", text, hunkIndex, oldLine, newLine });
      continue;
    }
    if (hunkIndex < 0) {
      rows.push({ kind: "meta", text, hunkIndex: null, oldLine: null, newLine: null });
      continue;
    }
    if (text.startsWith("+")) {
      rows.push({ kind: "add", text, hunkIndex, oldLine: null, newLine });
      newLine += 1;
      continue;
    }
    if (text.startsWith("-")) {
      rows.push({ kind: "del", text, hunkIndex, oldLine, newLine: null });
      oldLine += 1;
      continue;
    }
    if (text.startsWith("\\")) {
      rows.push({ kind: "note", text, hunkIndex, oldLine: null, newLine: null });
      continue;
    }
    rows.push({ kind: "ctx", text, hunkIndex, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }
  return rows;
}

export function hunkCount(diff: string) {
  return parseDiffView(diff).filter((row) => row.kind === "hunk").length;
}

export function firstOpenLine(diff: string) {
  const rows = parseDiffView(diff);
  const added = rows.find((row) => row.kind === "add" && row.newLine);
  if (added?.newLine) return added.newLine;
  const context = rows.find((row) => row.kind === "ctx" && row.newLine);
  if (context?.newLine) return context.newLine;
  const hunk = rows.find((row) => row.kind === "hunk");
  return hunk?.newLine ?? 1;
}

export const DIFF_VIEW_HUNK_HEADER_RE =
  /^@@(?:@+)?\s+-(\d+)(?:,(\d+))?(?:\s+-(\d+)(?:,(\d+))?)?\s+\+(\d+)(?:,(\d+))?\s*@@/;

function isHunkBodyLine(line: string) {
  return (
    line.startsWith(" ") ||
    line.startsWith("+") ||
    line.startsWith("-") ||
    line.startsWith("\\") ||
    line === ""
  );
}

export function normalizeDiffForView(diff: string, path = "file") {
  const lines = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const hunks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("@@")) continue;
    const match = line.match(DIFF_VIEW_HUNK_HEADER_RE);
    const body: string[] = [];
    index += 1;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (
        current.startsWith("@@") ||
        current.startsWith("diff --git") ||
        current.startsWith("*** ")
      ) {
        index -= 1;
        break;
      }
      if (/^(--- |\+\+\+ )(?:[ab]\/|\/dev\/null)/.test(current)) break;
      if (!isHunkBodyLine(current)) break;
      body.push(current === "" ? " " : current);
      index += 1;
    }
    if (!body.length && !match) continue;
    const oldCount = body.filter((row) => row.startsWith(" ") || row.startsWith("-")).length;
    const newCount = body.filter((row) => row.startsWith(" ") || row.startsWith("+")).length;
    if (oldCount + newCount === 0) continue;
    const oldStart = match ? Number(match[1]) : 1;
    const newStart = match ? Number(match[5] ?? "1") : 1;
    hunks.push(
      [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body].join("\n")
    );
  }
  if (!hunks.length) return [];
  return [[`--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n")];
}

export function diffViewHunks(diff: string, path = "file") {
  return normalizeDiffForView(diff, path);
}

export function hasTextHunks(diff: string, path = "file") {
  return diffViewHunks(diff, path).length > 0;
}

export function commitDiffPath(path: string) {
  if (!path.includes("\t")) return path;
  return path.split("\t").filter(Boolean).at(-1) ?? path;
}

export function commitDiffLabel(file: { status: string; path: string; previousPath?: string }) {
  if (file.previousPath) return `${file.previousPath} → ${file.path}`;
  if (file.path.includes("\t")) {
    const [from, to] = file.path.split("\t");
    return to ? `${from} → ${to}` : file.path;
  }
  return file.path;
}

export const GIT_DIFF_MOBILE_BREAKPOINT = 768;

export function preferredDiffMode(width: number): "split" | "unified" {
  return width < GIT_DIFF_MOBILE_BREAKPOINT ? "unified" : "split";
}
