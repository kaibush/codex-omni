import { useLayoutEffect } from "react";
import { isPlaceholderSessionTitle } from "./session-title";

export const DEFAULT_DOCUMENT_TITLE = "Codex Omni";

export type DocumentTitleView = "chat" | "files" | "git" | "terminal" | "terminal-chat";

const VIEW_LABEL: Partial<Record<DocumentTitleView, string>> = {
  files: "文件",
  git: "Git",
  terminal: "终端",
  "terminal-chat": "终端对话"
};

const PART_MAX_LENGTH = 48;

function cleanTitlePart(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function truncateTitlePart(value: string) {
  if (value.length <= PART_MAX_LENGTH) return value;
  return `${value.slice(0, PART_MAX_LENGTH).trim()}…`;
}

export function joinDocumentTitle(parts: Array<string | null | undefined>) {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const part of [...parts, DEFAULT_DOCUMENT_TITLE]) {
    const text = truncateTitlePart(cleanTitlePart(part));
    if (!text || seen.has(text)) continue;
    seen.add(text);
    cleaned.push(text);
  }
  return cleaned.join(" · ") || DEFAULT_DOCUMENT_TITLE;
}

export function workspaceDocumentTitle(input: {
  projectName?: string | null | undefined;
  sessionTitle?: string | null | undefined;
  view?: DocumentTitleView | null | undefined;
}) {
  const projectName = truncateTitlePart(cleanTitlePart(input.projectName));
  if (!projectName) return DEFAULT_DOCUMENT_TITLE;

  const sessionTitle = cleanTitlePart(input.sessionTitle);
  const namedSession =
    sessionTitle && !isPlaceholderSessionTitle(sessionTitle) ? truncateTitlePart(sessionTitle) : "";
  const view = input.view ?? "chat";

  let detail = "";
  if (view === "files" || view === "git" || view === "terminal") {
    detail = VIEW_LABEL[view] ?? "";
  } else if (view === "terminal-chat") {
    detail = namedSession || VIEW_LABEL[view] || "";
  } else {
    detail = namedSession;
  }

  return detail ? `${projectName} - ${detail}` : projectName;
}

export function useDocumentTitle(title: string) {
  useLayoutEffect(() => {
    document.title = title;
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [title]);
}
