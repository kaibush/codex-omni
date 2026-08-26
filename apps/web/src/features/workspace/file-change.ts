export type FileChangeEntry = {
  path: string;
  kind: string;
  diff: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function fileChangeKind(value: unknown) {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "a" || raw === "add" || raw === "added") return "add";
  if (raw === "d" || raw === "delete" || raw === "deleted" || raw === "removed") return "delete";
  return "modified";
}

export function ensureUnifiedDiff(path: string, diff: string) {
  const trimmed = diff.replace(/\n$/, "");
  if (!trimmed) return "";
  if (trimmed.includes("@@ ")) {
    if (trimmed.includes("--- ")) return `${trimmed}\n`;
    return `--- a/${path}\n+++ b/${path}\n${trimmed}\n`;
  }
  if (trimmed.startsWith("diff --git")) return `${trimmed}\n`;
  const lines = trimmed.split("\n");
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${Math.max(lines.length, 1)} +1,${Math.max(lines.length, 1)} @@`,
    ...lines.map((line) =>
      line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") ? line : ` ${line}`
    )
  ].join("\n");
}

export function fileChangeEntries(data: unknown, text = ""): FileChangeEntry[] {
  const payload = asRecord(data) ?? {};
  const rawChanges = Array.isArray(payload.changes)
    ? payload.changes
    : Array.isArray(payload.files)
      ? payload.files
      : [];
  const entries: FileChangeEntry[] = [];
  for (const item of rawChanges) {
    const row = asRecord(item);
    if (!row) continue;
    const path = String(row.path ?? row.filePath ?? row.file_path ?? "");
    if (!path) continue;
    const diff = String(row.diff ?? row.patch ?? "");
    entries.push({
      path,
      kind: fileChangeKind(row.kind ?? row.status),
      diff: ensureUnifiedDiff(path, diff)
    });
  }
  if (!entries.length) {
    const path = String(payload.path ?? payload.filePath ?? "change.diff");
    const diff = String(payload.diff ?? payload.patch ?? text);
    if (diff.includes("@@ ") || diff.includes("diff --git")) {
      entries.push({
        path,
        kind: fileChangeKind(payload.kind ?? payload.status),
        diff: ensureUnifiedDiff(path, diff)
      });
    }
  }
  return entries;
}
