export function workspacePath(projectId?: string | null, sessionId?: string | null) {
  if (!projectId) return "/";
  const project = `/projects/${encodeURIComponent(projectId)}`;
  if (!sessionId) return project;
  return `${project}/sessions/${encodeURIComponent(sessionId)}`;
}

export function settingsPath(section = "system-info") {
  return `/settings/${encodeURIComponent(section)}`;
}

export function defaultWorkspaceView(_sessionId?: string | null): "chat" | "files" {
  return "chat";
}
