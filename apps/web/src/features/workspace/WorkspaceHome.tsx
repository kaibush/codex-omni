import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clientName } from "@codex-omni/protocol";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  LoaderCircle,
  MessageSquareText,
  Search
} from "lucide-react";
import { SessionIcon } from "@/components/SessionIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatCompactDateTime, formatDateTime } from "@/lib/utils";
import type { Project, RecentRun } from "@/types";
import { recentRunStatusLabel } from "./RecentSessionsSwitcher";

export function WorkspaceHome({
  projects,
  projectsPending,
  onOpenProject,
  onOpenSession,
  onNewProject
}: {
  projects: Project[];
  projectsPending: boolean;
  onOpenProject: (id: string) => void;
  onOpenSession: (session: RecentRun) => void;
  onNewProject: () => void;
}) {
  const [search, setSearch] = useState("");
  const recent = useQuery({
    queryKey: ["recent-run-sessions"],
    queryFn: () => api<RecentRun[]>("/api/runs/recent-sessions"),
    refetchInterval: 10_000
  });
  const sessions = recent.data ?? [];
  const query = search.trim().toLocaleLowerCase();
  const visible = sessions.filter((session) =>
    [
      session.sessionTitle,
      session.projectName,
      session.providerName,
      clientName(session.clientType)
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query)
  );

  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 sm:py-8"
      aria-labelledby="workspace-home-title"
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id="workspace-home-title" className="text-lg font-semibold">
              最近对话
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">选择一个对话继续。</p>
          </div>
          <Button variant="outline" className="h-8 shrink-0 rounded-lg" onClick={onNewProject}>
            <FolderPlus className="size-4" />
            打开工程
          </Button>
        </div>
        {sessions.length > 0 && (
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
            <Input
              type="search"
              aria-label="搜索最近对话"
              placeholder="搜索对话、工程或供应商"
              className="h-8 rounded-lg pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}
        {recent.isPending ? (
          <p
            className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin" /> 正在读取最近对话
          </p>
        ) : recent.isError ? (
          <div className="rounded-lg border border-border p-6 text-center" role="alert">
            <p className="text-sm text-muted-foreground">最近对话加载失败，请重试。</p>
            <Button
              variant="outline"
              className="mt-3 h-8 rounded-lg"
              onClick={() => void recent.refetch()}
            >
              重新加载
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-4 py-8 text-center">
            <MessageSquareText className="mx-auto size-6 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">暂无最近对话</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {projectsPending
                ? "正在读取工程…"
                : projects.length
                  ? "选择一个工程，开始新的对话。"
                  : "打开工程后即可开始对话。"}
            </p>
            {projects.length > 0 && (
              <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{project.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {project.displayPath}
                      </span>
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground" role="status">
            没有匹配的最近对话
          </p>
        ) : (
          <ul
            className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
            aria-label="最近对话列表"
          >
            {visible.map((session) => (
              <li key={session.sessionId}>
                <button
                  type="button"
                  onClick={() => onOpenSession(session)}
                  title={`${session.sessionTitle} · ${session.projectName}`}
                  className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                    <SessionIcon session={session} className="size-4" labelled />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {session.sessionTitle}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {[session.projectName, session.providerName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">
                    <span className={`timeline-recent-badge is-${session.status}`}>
                      {recentRunStatusLabel[session.status]}
                    </span>
                    <time
                      dateTime={new Date(session.startedAt).toISOString()}
                      title={formatDateTime(session.startedAt)}
                    >
                      {formatCompactDateTime(session.startedAt)}
                    </time>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
