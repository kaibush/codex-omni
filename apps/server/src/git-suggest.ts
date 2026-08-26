import type { GitCommitSummary } from "./project-git.js";

export type GitNameStatus = { status: string; path: string };

export function parseNameStatus(text: string): GitNameStatus[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split(/\s+/);
      const path = parts[parts.length - 1] ?? "";
      return { status: status || "M", path };
    })
    .filter((item) => item.path);
}

function inferType(files: GitNameStatus[]) {
  if (!files.length) return "chore";
  const paths = files.map((file) => file.path.toLowerCase());
  if (paths.every((path) => path.startsWith("docs/") || path.endsWith(".md"))) return "docs";
  if (
    paths.every(
      (path) => /(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(path) || /\.(test|spec)\./.test(path)
    )
  )
    return "test";
  if (files.every((file) => file.status.startsWith("A"))) return "feat";
  if (files.every((file) => file.status.startsWith("D"))) return "chore";
  if (paths.some((path) => /fix|bug|hotfix/.test(path))) return "fix";
  return files.some((file) => file.status.startsWith("A")) ? "feat" : "fix";
}

function fileLabel(file: GitNameStatus) {
  if (file.status.startsWith("A")) return `新增 ${file.path}`;
  if (file.status.startsWith("D")) return `删除 ${file.path}`;
  if (file.status.startsWith("R")) return `重命名 ${file.path}`;
  return `修改 ${file.path}`;
}

function inferSubject(files: GitNameStatus[]) {
  if (files.length === 1) return fileLabel(files[0]!).replace(/^(新增|删除|重命名|修改) /, "");
  const roots = [...new Set(files.map((file) => file.path.split("/")[0] ?? file.path))];
  if (roots.length === 1) return `更新 ${roots[0]}`;
  return `更新 ${files.length} 个文件`;
}

export function buildCommitSuggestion(input: {
  nameStatus: string;
  stat?: string;
  kind: "commit" | "summary";
}) {
  const files = parseNameStatus(input.nameStatus);
  if (!files.length) return "";
  const type = inferType(files);
  const subject = inferSubject(files);
  const body = files
    .slice(0, 16)
    .map((file) => `- ${fileLabel(file)}`)
    .join("\n");
  const extra = files.length > 16 ? `\n- 另有 ${files.length - 16} 个文件` : "";
  if (input.kind === "commit") return `${type}: ${subject}\n\n${body}${extra}`.trim();
  const stat = input.stat?.trim();
  return [`${type}: ${subject}`, "", body + extra, stat ? `\n${stat}` : ""]
    .filter((part) => part !== undefined)
    .join("\n")
    .trim();
}

export function buildReleaseNotes(commits: GitCommitSummary[]) {
  if (!commits.length) return "";
  const lines = commits.slice(0, 20).map((commit) => `- ${commit.shortHash} ${commit.subject}`);
  return `## 发布说明\n\n${lines.join("\n")}`;
}
