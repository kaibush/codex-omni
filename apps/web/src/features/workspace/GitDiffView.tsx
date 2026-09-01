import { Component, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import { toast } from "sonner";
import { Columns2, Copy, FileCode2, Rows3 } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useTheme } from "@/context/theme-provider";
import { cn } from "@/lib/utils";
import {
  diffViewHunks,
  firstOpenLine,
  hasTextHunks,
  hunkCount,
  parseDiffView,
  preferredDiffMode
} from "./git-diff";

type HunkAction = "stage" | "unstage" | "discard";

class DiffViewBoundary extends Component<
  { resetKey: string; fallback: ReactNode; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint
  );
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
}

export function GitDiffView({
  diff,
  path,
  fill = false,
  hunkKind,
  onOpenFile,
  onHunkAction
}: {
  diff: string;
  path: string;
  fill?: boolean | undefined;
  hunkKind?: "staged" | "unstaged" | undefined;
  onOpenFile?: ((path: string, line: number | null) => void) | undefined;
  onHunkAction?: ((hunkIndex: number, action: HunkAction) => void) | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<"split" | "unified">(() =>
    preferredDiffMode(typeof window === "undefined" ? 1024 : window.innerWidth)
  );
  const hunks = hunkCount(diff);
  const viewHunks = useMemo(() => diffViewHunks(diff, path), [diff, path]);
  const canRender = viewHunks.length > 0;
  const data = useMemo(
    () => ({
      oldFile: { fileName: path },
      newFile: { fileName: path },
      hunks: viewHunks
    }),
    [path, viewHunks]
  );
  const hunkHeaders = useMemo(
    () => parseDiffView(diff).filter((row) => row.kind === "hunk"),
    [diff]
  );
  const emptyMessage = useMemo(() => {
    const trimmed = diff.trim();
    if (/binary files /i.test(trimmed)) return "二进制文件，没有可显示的文本差异";
    if (trimmed.includes("文件过大")) return "文件过大，无法生成完整 Diff";
    if (!trimmed || trimmed === "暂无文本差异" || !hasTextHunks(diff, path)) {
      return fill ? "当前草稿与打开的文件一致，没有可显示的差异。" : "暂无文本差异";
    }
    return trimmed.split("\n").slice(0, 8).join("\n");
  }, [diff, fill, path]);

  const openAt = (line: number | null) => onOpenFile?.(path, line);

  const handleSurfaceClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onOpenFile) return;
    const target = event.target as HTMLElement | null;
    const row = target?.closest("[data-side], .diff-line") as HTMLElement | null;
    if (!row || row.getAttribute("data-state") === "hunk") return;
    const line = row.querySelector("[data-line-num]")?.getAttribute("data-line-num");
    if (!line) return;
    openAt(Number(line));
  };

  const fallback = <pre className="git-diff-empty">{emptyMessage}</pre>;

  return (
    <div className={cn("git-diff-view", fill && "git-diff-view-fill")}>
      <div className="git-diff-toolbar">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
          title={path}
        >
          {path}
        </span>
        <button
          type="button"
          className={cn("git-diff-tool-btn", mode === "split" && "is-active")}
          onClick={() => setMode("split")}
        >
          <Columns2 className="size-3" /> 左右
        </button>
        <button
          type="button"
          className={cn("git-diff-tool-btn", mode === "unified" && "is-active")}
          onClick={() => setMode("unified")}
        >
          <Rows3 className="size-3" /> 统一
        </button>
        {onOpenFile ? (
          <button
            type="button"
            className="git-diff-tool-btn"
            onClick={() => openAt(firstOpenLine(diff))}
          >
            <FileCode2 className="size-3" /> 打开
          </button>
        ) : null}
        <button
          type="button"
          className="git-diff-tool-btn"
          onClick={() => {
            void copyTextToClipboard(diff).then((copied) =>
              copied ? toast.success("Diff 已复制") : toast.error("复制失败")
            );
          }}
        >
          <Copy className="size-3" /> 复制
        </button>
      </div>
      {hunkKind && hunks > 0 && onHunkAction ? (
        <div className="git-diff-hunks">
          {hunkHeaders.map((row) => (
            <div key={`hunk-${row.hunkIndex}`} className="git-diff-hunk-actions">
              <span className="font-mono text-[10px] text-muted-foreground">
                hunk {(row.hunkIndex ?? 0) + 1}
              </span>
              {hunkKind === "unstaged" ? (
                <>
                  <button type="button" onClick={() => onHunkAction(row.hunkIndex!, "stage")}>
                    暂存此块
                  </button>
                  <button type="button" onClick={() => onHunkAction(row.hunkIndex!, "discard")}>
                    丢弃此块
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => onHunkAction(row.hunkIndex!, "unstage")}>
                  取消暂存此块
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {canRender ? (
        <div className="git-diff-surface" onClick={handleSurfaceClick}>
          <DiffViewBoundary resetKey={`${path}:${diff.length}:${viewHunks.length}`} fallback={fallback}>
            <DiffView
              data={data}
              diffViewTheme={resolvedTheme}
              diffViewHighlight={diff.length < 32_000 && hunks < 80}
              diffViewWrap={isMobile}
              diffViewFontSize={isMobile ? 11 : 12}
              diffViewMode={mode === "split" ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified}
            />
          </DiffViewBoundary>
        </div>
      ) : (
        fallback
      )}
    </div>
  );
}
