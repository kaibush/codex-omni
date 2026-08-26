import { api } from "@/lib/api";

export type SystemVersionStatus =
  "idle" | "checking" | "update_available" | "up_to_date" | "no_release" | "error";

export type SystemVersionInfo = {
  status: SystemVersionStatus;
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  checkedAt: string;
  error: string;
};

export const SYSTEM_VERSION_QUERY_KEY = ["system-version"] as const;

export const SYSTEM_UPDATE_NPM_COMMAND = "npm i -g @kaibush/codex-omni";

export const SYSTEM_UPDATE_GITHUB_COMMAND =
  "npm i -g https://github.com/kaibush/codex-omni/releases/latest/download/codex-omni.tgz";

export const SYSTEM_UPDATE_DOCKER_COMMANDS = ["docker compose pull", "docker compose up -d"].join(
  "\n"
);

export const SYSTEM_UPDATE_COMMANDS = [
  SYSTEM_UPDATE_NPM_COMMAND,
  "",
  "# 或从 GitHub Release 安装",
  SYSTEM_UPDATE_GITHUB_COMMAND,
  "",
  "# 或使用 Docker",
  SYSTEM_UPDATE_DOCKER_COMMANDS
].join("\n");

export const SYSTEM_UPDATE_DISMISS_KEY = "codex-omni:dismissed-update-version";
export const SYSTEM_UPDATE_PREVIEW_EVENT = "codex-omni:system-update-preview";
export const SYSTEM_UPDATE_CHECK_EVENT = "codex-omni:system-update-check";

export type DismissedUpdate = {
  version: string;
  date: string;
};

export function fetchSystemVersion() {
  return api<SystemVersionInfo>("/api/system/version");
}

export function checkSystemUpdate() {
  return api<SystemVersionInfo>("/api/system/update/check", { method: "POST" });
}

export function requestSystemUpdateCheck() {
  window.dispatchEvent(new Event(SYSTEM_UPDATE_CHECK_EVENT));
}

export function localDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDismissedUpdate(raw: string | null): DismissedUpdate | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DismissedUpdate>;
    const version = String(value.version || "").trim();
    const date = String(value.date || "").trim();
    if (version && date) return { version, date };
  } catch {
    // Ignore the previous session-only version string.
  }
  return null;
}

export function shouldSuppressUpdateDialog(
  latestVersion: string,
  dismissed: DismissedUpdate | null,
  now = new Date()
) {
  return (
    Boolean(latestVersion) &&
    dismissed?.version === latestVersion &&
    dismissed.date === localDateKey(now)
  );
}

export function buildSystemUpdatePreview(current: SystemVersionInfo): SystemVersionInfo {
  const match = current.currentVersion.match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  const previewVersion = match ? `v${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "vNEXT";
  return {
    status: "update_available",
    updateAvailable: true,
    currentVersion: current.currentVersion,
    latestVersion: previewVersion,
    releaseUrl: "https://github.com/kaibush/codex-omni/releases",
    releaseNotes: [
      "## 更新提醒预览",
      "",
      "> 这是开发环境中的本地界面预览，不会修改后端检测结果。",
      "",
      "- 展示 GitHub Release 更新说明",
      "- 提供 npm 全局安装与 Docker Compose 更新命令",
      "- 支持今日不再提醒"
    ].join("\n"),
    publishedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    error: ""
  };
}
