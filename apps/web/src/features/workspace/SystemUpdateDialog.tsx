import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, ExternalLink, LoaderCircle, PackageOpen, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ReleaseNotesMarkdown } from "./ReleaseNotesMarkdown";
import {
  checkSystemUpdate,
  localDateKey,
  parseDismissedUpdate,
  shouldSuppressUpdateDialog,
  SYSTEM_UPDATE_CHECK_EVENT,
  SYSTEM_UPDATE_COMMANDS,
  SYSTEM_UPDATE_DISMISS_KEY,
  SYSTEM_UPDATE_PREVIEW_EVENT,
  SYSTEM_VERSION_QUERY_KEY,
  fetchSystemVersion,
  type DismissedUpdate,
  type SystemVersionInfo
} from "@/lib/system-update";

function readDismissedUpdate() {
  try {
    return parseDismissedUpdate(window.localStorage.getItem(SYSTEM_UPDATE_DISMISS_KEY));
  } catch {
    return null;
  }
}

function rememberDismissedUpdate(value: DismissedUpdate) {
  try {
    window.localStorage.setItem(SYSTEM_UPDATE_DISMISS_KEY, JSON.stringify(value));
  } catch {
    // The in-memory state below still closes the dialog for this page.
  }
}

function dialogCopy(args: {
  checking: boolean;
  preview: boolean;
  info?: SystemVersionInfo | undefined;
}) {
  if (args.checking) {
    return {
      title: "正在检查更新",
      description: "正在读取 GitHub 最新 Release。",
      dismissLabel: "取消"
    };
  }
  if (args.preview || args.info?.updateAvailable) {
    return {
      title: "发现 Codex Omni 新版本",
      description: args.preview
        ? "本地模拟完整更新提醒；生产构建中不显示预览入口。"
        : "GitHub Release 已发布，可以用 npm 安装最新包，或在部署目录拉取 Docker 镜像。",
      dismissLabel: args.preview ? "关闭预览" : "今日不再提醒"
    };
  }
  if (args.info?.status === "error") {
    return {
      title: "检查更新失败",
      description: args.info.error || "GitHub Release 暂时不可用。",
      dismissLabel: "关闭"
    };
  }
  if (args.info?.status === "no_release") {
    return {
      title: "尚无公开 Release",
      description: "GitHub 仓库目前没有可用于版本比较的 Release。",
      dismissLabel: "关闭"
    };
  }
  return {
    title: "已是最新版本",
    description: "当前安装版本与 GitHub 最新 Release 一致。",
    dismissLabel: "关闭"
  };
}

export function SystemUpdateDialog() {
  const queryClient = useQueryClient();
  const version = useQuery({
    queryKey: SYSTEM_VERSION_QUERY_KEY,
    queryFn: fetchSystemVersion,
    staleTime: 60_000,
    refetchInterval: (query) =>
      ["idle", "checking"].includes(query.state.data?.status ?? "") ? 3_000 : 5 * 60_000
  });
  const checkMutation = useMutation({
    mutationFn: checkSystemUpdate,
    onSuccess: (value) => {
      queryClient.setQueryData(SYSTEM_VERSION_QUERY_KEY, value);
    }
  });
  const [dismissedUpdate, setDismissedUpdate] = useState(readDismissedUpdate);
  const [preview, setPreview] = useState<SystemVersionInfo | null>(null);
  const [forcedOpen, setForcedOpen] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const showPreview = (event: Event) => {
      const detail = (event as CustomEvent<SystemVersionInfo>).detail;
      if (detail?.updateAvailable) setPreview(detail);
    };
    window.addEventListener(SYSTEM_UPDATE_PREVIEW_EVENT, showPreview);
    return () => window.removeEventListener(SYSTEM_UPDATE_PREVIEW_EVENT, showPreview);
  }, []);

  const checkNow = checkMutation.mutate;
  useEffect(() => {
    const onCheck = () => {
      setPreview(null);
      setForcedOpen(true);
      checkNow();
    };
    window.addEventListener(SYSTEM_UPDATE_CHECK_EVENT, onCheck);
    return () => window.removeEventListener(SYSTEM_UPDATE_CHECK_EVENT, onCheck);
  }, [checkNow]);

  const checking = forcedOpen && checkMutation.isPending;
  const info = preview ?? (checking ? undefined : (checkMutation.data ?? version.data));
  const isPreview = preview !== null;
  const latestVersion = info?.latestVersion ?? "";
  const updateAvailable = Boolean(info?.updateAvailable && latestVersion);
  const open = Boolean(
    isPreview ||
      forcedOpen ||
      (updateAvailable && !shouldSuppressUpdateDialog(latestVersion, dismissedUpdate))
  );
  const copy = dialogCopy({ checking, preview: isPreview, info });
  const showUpdateDetails = Boolean(!checking && (isPreview || updateAvailable));

  const close = (dismissForToday = false) => {
    if (isPreview) {
      setPreview(null);
      return;
    }
    setForcedOpen(false);
    if (dismissForToday && updateAvailable) {
      const next = { version: latestVersion, date: localDateKey() };
      rememberDismissedUpdate(next);
      setDismissedUpdate(next);
    }
  };

  const copyCommands = () => {
    void copyTextToClipboard(SYSTEM_UPDATE_COMMANDS).then((copied) => {
      if (copied) toast.success("更新命令已复制");
      else toast.error("复制失败");
    });
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close(updateAvailable)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {checking ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <PackageOpen className="size-5" />
            )}
            {copy.title}
            {isPreview ? <Badge variant="info">开发预览</Badge> : null}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {checking ? (
          <p className="text-sm text-muted-foreground">请稍候，正在对照 GitHub Release…</p>
        ) : info ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">当前 {info.currentVersion}</Badge>
              {latestVersion ? (
                <>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <Badge variant={updateAvailable ? "success" : "secondary"}>
                    {updateAvailable ? "最新" : "Release"} {latestVersion}
                  </Badge>
                </>
              ) : null}
            </div>
            {showUpdateDetails ? (
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Terminal className="size-4 text-primary" />
                  更新命令
                </div>
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
              </section>
            ) : null}
            {showUpdateDetails || info.releaseNotes.trim() ? (
              <section className="space-y-2">
                <div className="text-sm font-medium">Release 说明</div>
                <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-3">
                  {info.releaseNotes.trim() ? (
                    <ReleaseNotesMarkdown text={info.releaseNotes} />
                  ) : (
                    <p className="text-sm text-muted-foreground">本次 Release 未填写说明。</p>
                  )}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">暂无版本信息。</p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(updateAvailable)}>
            {copy.dismissLabel}
          </Button>
          {info?.releaseUrl && !checking ? (
            <Button asChild>
              <a href={info.releaseUrl} target="_blank" rel="noreferrer">
                查看 GitHub Release
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : (
            <Button type="button" disabled>
              查看 GitHub Release
              <ExternalLink className="size-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
