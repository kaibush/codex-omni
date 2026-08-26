import { listGitBranches, listGitLog } from "./project-git.js";
import { searchProjectFiles } from "./project-file.js";
import type { Store } from "@codex-omni/db";

export type WorkspaceSearchHit = {
  type: "project" | "session" | "message" | "file" | "branch" | "commit";
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  path?: string;
  line?: number | null;
  hash?: string;
};

export const WORKSPACE_SEARCH_SCOPES = [
  "all",
  "project",
  "session",
  "message",
  "file",
  "git"
] as const;

export type WorkspaceSearchScope = (typeof WORKSPACE_SEARCH_SCOPES)[number];

const wants = (scope: WorkspaceSearchScope, type: WorkspaceSearchHit["type"] | "git") => {
  if (scope === "all") return true;
  if (scope === "git") return type === "git" || type === "branch" || type === "commit";
  return scope === type;
};

const SESSION_STATUS_LABEL: Record<string, string> = {
  idle: "空闲",
  running: "进行中",
  failed: "异常",
  cancelled: "已取消",
  interrupted: "已中断"
};

export async function searchWorkspace(input: {
  store: Store;
  query: string;
  projectId?: string;
  rootPath?: string;
  scope?: WorkspaceSearchScope;
  status?: "idle" | "running" | "failed" | "cancelled" | "interrupted" | "";
}): Promise<{ query: string; hits: WorkspaceSearchHit[] }> {
  const query = input.query.trim();
  if (!query) return { query, hits: [] };
  const scope = input.scope ?? "all";
  const hits: WorkspaceSearchHit[] = [];
  const projectId = input.projectId;
  const limit = scope === "all" ? 8 : 24;

  if (wants(scope, "project") && (!projectId || scope === "project")) {
    for (const project of input.store.listProjects()) {
      const hay = `${project.name} ${project.displayPath}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) continue;
      hits.push({
        type: "project",
        id: `project:${project.id}`,
        title: project.name,
        subtitle: project.displayPath,
        projectId: project.id
      });
      if (hits.filter((hit) => hit.type === "project").length >= limit) break;
    }
  }

  if (wants(scope, "session")) {
    for (const session of input.store.searchSessions(query, {
      ...(projectId ? { projectId } : {}),
      limit,
      ...(input.status ? { status: input.status } : {})
    })) {
      hits.push({
        type: "session",
        id: `session:${session.id}`,
        title: session.title,
        subtitle: `${session.projectName} · ${SESSION_STATUS_LABEL[session.status] ?? session.status}`,
        snippet: session.snippet,
        projectId: session.projectId,
        sessionId: session.id
      });
    }
  }

  if (wants(scope, "message")) {
    for (const message of input.store.searchMessages(query, { ...(projectId ? { projectId } : {}), limit })) {
      hits.push({
        type: "message",
        id: `message:${message.id}`,
        title: message.sessionTitle,
        subtitle: `${message.projectName} · ${message.role === "user" ? "用户" : "助手"}`,
        snippet: message.snippet,
        projectId: message.projectId,
        sessionId: message.sessionId,
        messageId: message.id
      });
    }
  }

  if (input.rootPath && projectId && wants(scope, "file")) {
    try {
      const files = await searchProjectFiles({
        rootPath: input.rootPath,
        query,
        content: scope === "file" && query.length >= 2
      });
      for (const match of files.matches.slice(0, limit)) {
        hits.push({
          type: "file",
          id: `file:${match.path}:${match.line ?? 0}`,
          title: match.path,
          subtitle: match.kind === "content" ? `第 ${match.line} 行` : "文件",
          snippet: match.text ?? "",
          projectId,
          path: match.path,
          line: match.line ?? null
        });
      }
    } catch {
      // ignore missing directories
    }
  }

  if (input.rootPath && projectId && wants(scope, "git")) {
    try {
      const needle = query.toLowerCase();
      const branches = await listGitBranches(input.rootPath);
      for (const branch of branches) {
        if (!branch.name.toLowerCase().includes(needle)) continue;
        hits.push({
          type: "branch",
          id: `branch:${branch.name}`,
          title: branch.name,
          subtitle: branch.current ? "当前分支" : branch.remote ? "远程分支" : "本地分支",
          projectId
        });
        if (hits.filter((hit) => hit.type === "branch").length >= Math.min(limit, 12)) break;
      }
      const commits = await listGitLog(input.rootPath, scope === "git" ? 80 : 40);
      for (const commit of commits) {
        const hay = `${commit.subject} ${commit.shortHash} ${commit.hash}`.toLowerCase();
        if (!hay.includes(needle)) continue;
        hits.push({
          type: "commit",
          id: `commit:${commit.hash}`,
          title: commit.subject,
          subtitle: `${commit.shortHash} · ${commit.author}`,
          projectId,
          hash: commit.hash
        });
        if (hits.filter((hit) => hit.type === "commit").length >= Math.min(limit, 12)) break;
      }
    } catch {
      // not a git repository
    }
  }

  return { query, hits };
}
