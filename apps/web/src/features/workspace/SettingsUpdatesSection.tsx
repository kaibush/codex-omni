import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  PanelTopOpen,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  SYSTEM_UPDATE_COMMANDS,
  SYSTEM_UPDATE_PREVIEW_EVENT,
  SYSTEM_VERSION_QUERY_KEY,
  buildSystemUpdatePreview,
  checkSystemUpdate,
  fetchSystemVersion,
  type SystemVersionInfo
} from "@/lib/system-update";
import { formatDateTime } from "@/lib/utils";
import { ReleaseNotesMarkdown } from "./ReleaseNotesMarkdown";
import { SettingsCard, SettingsFormGrid, SettingsInfoRow } from "./settings/settings-ui";

function versionStatus(info: SystemVersionInfo) {
  if (info.status === "update_available") {
    return {
      label: "发现新版本",
      badge: "可更新",
      detail: `${info.currentVersion} → ${info.latestVersion}`,
      variant: "warning" as const,
      icon: AlertTriangle
    };
  }
  if (info.status === "up_to_date") {
    return {
      label: "已是最新版本",
      badge: "最新",
      detail: info.currentVersion,
      variant: "success" as const,
      icon: CheckCircle2
    };
  }
  if (info.status === "checking") {
    return {
      label: "正在检查",
      badge: "检查中",
      detail: "正在读取 GitHub 最新 Release",
      variant: "info" as const,
      icon: RefreshCw
    };
  }
  if (info.status === "error") {
    return {
      label: "检查异常",
      badge: "异常",
      detail: info.error || "GitHub Release 暂时不可用",
      variant: "destructive" as const,
      icon: AlertTriangle
    };
  }
  if (info.status === "no_release") {
    return {
      label: "尚无公开 Release",
      badge: "未发布",
      detail: "GitHub 仓库目前没有可用于版本比较的 Release",
      variant: "secondary" as const,
      icon: Clock3
    };
  }
  return {
    label: "等待首次检查",
    badge: "等待",
    detail: info.currentVersion,
    variant: "secondary" as const,
    icon: Clock3
  };
}

function formatCheckedAt(value: string) {
  if (!value) return "—";
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return value;
  return formatDateTime(stamp) || "—";
}

export function SettingsUpdatesSection() {
  const queryClient = useQueryClient();
  const versionQuery = useQuery({
    queryKey: SYSTEM_VERSION_QUERY_KEY,
    queryFn: fetchSystemVersion,
    staleTime: 60_000
  });
  const checkMutation = useMutation({
    mutationFn: checkSystemUpdate,
    onSuccess: (value) => {
      queryClient.setQueryData(SYSTEM_VERSION_QUERY_KEY, value);
      if (value.status === "error") {
        toast.error(value.error || "GitHub Release 检查异常");
      } else if (value.status === "no_release") {
        toast.info("GitHub 仓库尚未发布 Release");
      } else if (value.updateAvailable) {
        toast.success(`发现新版本 ${value.latestVersion}`);
      } else {
        toast.success("当前已是最新版本");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "检查失败")
  });

  if (versionQuery.isLoading) {
    return (
      <SettingsCard title="版本更新" description="正在读取当前版本和 GitHub Release。">
        <p className="text-sm text-muted-foreground">正在读取版本信息…</p>
      </SettingsCard>
    );
  }

  if (versionQuery.isError || !versionQuery.data) {
    return (
      <SettingsCard title="版本更新" description="无法读取 GitHub Release 信息。">
        <p className="text-sm text-muted-foreground">
          {versionQuery.error instanceof Error ? versionQuery.error.message : "版本信息加载失败"}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => versionQuery.refetch()}
        >
          重试
        </Button>
      </SettingsCard>
    );
  }

  const info = versionQuery.data;
  const status = versionStatus(info);
  const StatusIcon = status.icon;
  const copyCommands = () => {
    void copyTextToClipboard(SYSTEM_UPDATE_COMMANDS).then((copied) => {
      if (copied) toast.success("更新命令已复制");
      else toast.error("复制失败");
    });
  };
  const previewUpdateDialog = () => {
    if (!import.meta.env.DEV) return;
    window.dispatchEvent(
      new CustomEvent(SYSTEM_UPDATE_PREVIEW_EVENT, {
        detail: buildSystemUpdatePreview(info)
      })
    );
  };

  return (
    <>
      <SettingsCard
        title="版本更新"
        description="后端启动后立即检查 GitHub 最新 Release，之后每小时自动检查。"
      >
        <SettingsFormGrid>
          <SettingsInfoRow label="当前版本" value={info.currentVersion || "—"} />
          <SettingsInfoRow label="最新 Release" value={info.latestVersion || "—"} />
          <SettingsInfoRow label="最近检查" value={formatCheckedAt(info.checkedAt)} />
        </SettingsFormGrid>
        <div className="mt-6 flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background">
              <StatusIcon
                className={`size-4${info.status === "checking" ? " animate-spin" : ""}`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{status.label}</span>
                <Badge variant={status.variant}>{status.badge}</Badge>
              </div>
              <p className="mt-1 text-xs break-words text-muted-foreground">{status.detail}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {import.meta.env.DEV ? (
              <Button type="button" variant="outline" onClick={previewUpdateDialog}>
                <PanelTopOpen className="size-4" />
                预览提醒
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={checkMutation.isPending}
              onClick={() => checkMutation.mutate()}
            >
              <RefreshCw className={`size-4${checkMutation.isPending ? " animate-spin" : ""}`} />
              立即检查
            </Button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="更新命令"
        description="推荐用 npm 安装最新发布包；如果用 Docker 部署，可在部署目录拉取并重建。"
      >
        <div className="overflow-hidden rounded-lg border bg-muted/40">
          <div className="flex h-8 items-center justify-between border-b px-3">
            <span className="font-mono text-[11px] text-muted-foreground">bash</span>
            <Button type="button" variant="ghost" className="h-8" onClick={copyCommands}>
              <Copy className="size-4" />
              复制
            </Button>
          </div>
          <pre className="overflow-x-auto p-3 font-mono text-xs leading-6 whitespace-pre-wrap">
            <code>{SYSTEM_UPDATE_COMMANDS}</code>
          </pre>
        </div>
      </SettingsCard>

      <SettingsCard title="Release 说明" description="内容来自 GitHub Releases，按 Markdown 渲染。">
        <div className="max-h-72 min-h-32 overflow-y-auto rounded-lg border bg-muted/40 p-3">
          {info.releaseNotes.trim() ? (
            <ReleaseNotesMarkdown text={info.releaseNotes} />
          ) : (
            <p className="text-sm text-muted-foreground">暂无 Release 说明。</p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          {info.releaseUrl ? (
            <Button asChild variant="outline">
              <a href={info.releaseUrl} target="_blank" rel="noreferrer">
                查看 GitHub Releases
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled>
              查看 GitHub Releases
              <ExternalLink className="size-4" />
            </Button>
          )}
        </div>
      </SettingsCard>
    </>
  );
}
