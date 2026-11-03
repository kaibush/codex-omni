import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { sortSessions, type SessionListSort } from "@/lib/session-title";
import type { Session } from "@/types";

export function projectSessionsQuery(projectId: string) {
  return queryOptions({
    queryKey: ["sessions", projectId],
    queryFn: ({ signal }) =>
      api<Session[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions?archived=true`, {
        signal
      }),
    staleTime: 15_000
  });
}

export function groupProjectSessions(
  sessions: Session[],
  sort: SessionListSort,
  showArchived: boolean
) {
  const ordered = sortSessions(sessions, sort);
  return [
    {
      key: "pinned",
      label: "置顶",
      items: ordered.filter((session) => session.pinnedAt && !session.archivedAt)
    },
    {
      key: "recent",
      label: "最近",
      items: ordered.filter((session) => !session.pinnedAt && !session.archivedAt)
    },
    ...(showArchived
      ? [
          {
            key: "archived",
            label: "已归档",
            items: ordered.filter((session) => session.archivedAt)
          }
        ]
      : [])
  ].filter((group) => group.key === "archived" || group.items.length > 0);
}
