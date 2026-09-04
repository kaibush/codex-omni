import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCode2,
  GitBranch,
  GitCommit,
  GitCompare,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type { OperationEvent, Project } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { commitDiffLabel, commitDiffPath } from "./git-diff";
import { GitDiffView } from "./GitDiffView";
import { VirtualRows } from "./VirtualRows";

type GitFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked?: boolean;
  conflict?: boolean;
};
type GitStatus = {
  isRepository: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  hasUpstream?: boolean;
  files: GitFile[];
};
type GitBranchInfo = { name: string; current: boolean; remote: boolean };
type GitCommitSummary = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};
type GitCommitDetail = GitCommitSummary & {
  body: string;
  parents: string[];
  files: Array<{ status: string; path: string; previousPath?: string }>;
};
type GitTab = "changes" | "branches" | "history" | "timeline";

const MAX_HISTORY_DIFF_CACHE_ENTRIES = 12;
const MAX_HISTORY_DIFF_CACHE_CHARS = 4_000_000;

function cacheHistoryDiff(cache: Record<string, string>, key: string, diff: string) {
  const entries = Object.entries(cache).filter(([entryKey]) => entryKey !== key);
  entries.push([key, diff]);
  let total = 0;
  const kept: Array<[string, string]> = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (kept.length >= MAX_HISTORY_DIFF_CACHE_ENTRIES) break;
    if (kept.length > 0 && total + entry[1].length > MAX_HISTORY_DIFF_CACHE_CHARS) break;
    kept.push(entry);
    total += entry[1].length;
  }
  kept.reverse();
  return Object.fromEntries(kept);
}

function GitSection({
  title,
  action,
  onAction,
  children
}: {
  title: string;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-2">
        <span className="text-[11px] font-semibold text-muted-foreground">{title}</span>
        {action && (
          <button className="text-[11px] text-primary hover:text-foreground" onClick={onAction}>
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function GitPanel({
  project,
  onOpenFile,
  focusCommit,
  onChangeCount
}: {
  project: Project;
  onOpenFile?: ((path: string, line: number | null) => void) | undefined;
  focusCommit?: string | null | undefined;
  onChangeCount?: ((count: number) => void) | undefined;
}) {
  const [tab, setTab] = useState<GitTab>("changes");
  const [operations, setOperations] = useState<OperationEvent[]>([]);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [suggesting, setSuggesting] = useState<"commit" | "summary" | "release" | null>(null);
  const [error, setError] = useState("");
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [historyFile, setHistoryFile] = useState<string | null>(null);
  const [historyDiff, setHistoryDiff] = useState("");
  const [historyDiffs, setHistoryDiffs] = useState<Record<string, string>>({});
  const [mobileHistoryPane, setMobileHistoryPane] = useState<"list" | "detail">("list");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api<GitStatus>(`/api/projects/${project.id}/git/status`);
      setStatus(next);
      setExpanded({});
      setOperations(await api<OperationEvent[]>(`/api/projects/${project.id}/operations`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };
  const loadBranches = async () => {
    try {
      const result = await api<{ branches: GitBranchInfo[] }>(
        `/api/projects/${project.id}/git/branches`
      );
      setBranches(result.branches);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const loadHistory = async () => {
    try {
      const result = await api<{ commits: GitCommitSummary[] }>(
        `/api/projects/${project.id}/git/log`
      );
      setCommits(result.commits);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const loadOperations = async () => {
    try {
      setOperations(await api<OperationEvent[]>(`/api/projects/${project.id}/operations`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const openCommitFile = async (
    hash: string,
    file: { path: string; previousPath?: string },
    cache: Record<string, string> = historyDiffs
  ) => {
    const filePath = commitDiffPath(file.path);
    const key = `${hash}:${filePath}`;
    setHistoryFile(filePath);
    if (cache[key] !== undefined) {
      setHistoryDiff(cache[key] ?? "");
      return cache;
    }
    setWorking(`history:${key}`);
    try {
      const result = await api<{ diff: string }>(
        `/api/projects/${project.id}/git/diff?path=${encodeURIComponent(filePath)}&commit=${encodeURIComponent(hash)}`
      );
      const nextDiff = result.diff || "暂无文本差异";
      const nextCache = cacheHistoryDiff(cache, key, nextDiff);
      setHistoryDiffs(nextCache);
      setHistoryDiff(nextDiff);
      return nextCache;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return cache;
    } finally {
      setWorking(null);
    }
  };
  const openCommit = async (hash: string) => {
    setWorking(`commit:${hash}`);
    setError("");
    try {
      const next = await api<GitCommitDetail>(`/api/projects/${project.id}/git/commit/${hash}`);
      setDetail(next);
      setMobileHistoryPane("detail");
      setHistoryDiffs({});
      setHistoryDiff("");
      const first = next.files[0];
      if (first) {
        await openCommitFile(next.hash, first, {});
      } else {
        setHistoryFile(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };
  useEffect(() => {
    void refresh();
  }, [project.id]);
  useEffect(() => {
    if (tab === "branches") void loadBranches();
    if (tab === "history") void loadHistory();
    if (tab === "timeline") void loadOperations();
  }, [project.id, tab]);
  const focusedCommit = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCommit || focusedCommit.current === focusCommit) return;
    focusedCommit.current = focusCommit;
    setTab("history");
    void loadHistory().then(() => openCommit(focusCommit));
  }, [focusCommit]);

  const staged = useMemo(() => status?.files.filter((file) => file.staged) ?? [], [status]);
  const unstaged = useMemo(
    () => status?.files.filter((file) => file.unstaged && !file.conflict) ?? [],
    [status]
  );
  const conflicts = useMemo(() => status?.files.filter((file) => file.conflict) ?? [], [status]);
  useEffect(() => {
    onChangeCount?.(staged.length + unstaged.length + conflicts.length);
  }, [conflicts.length, onChangeCount, staged.length, unstaged.length]);

  const updateFiles = async (action: "stage" | "unstage" | "discard", paths: string[]) => {
    if (!paths.length) return;
    if (
      action === "discard" &&
      !window.confirm(`丢弃 ${paths.length} 个文件的本地修改？此操作不可恢复。`)
    ) {
      return;
    }
    setWorking(`${action}:all`);
    setError("");
    try {
      await api(`/api/projects/${project.id}/git/${action}`, {
        method: "POST",
        body: JSON.stringify({ paths })
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };
  const loadDiff = async (file: GitFile, kind: "staged" | "unstaged") => {
    const key = `${kind}:${file.path}`;
    if (expanded[key] !== undefined) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setWorking(`diff:${key}`);
    try {
      const result = await api<{ diff: string }>(
        `/api/projects/${project.id}/git/diff?path=${encodeURIComponent(file.path)}&staged=${
          kind === "staged" ? "true" : "false"
        }`
      );
      setExpanded((current) => ({ ...current, [key]: result.diff || "暂无文本差异" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };
  const applyHunk = async (
    file: GitFile,
    kind: "staged" | "unstaged",
    hunkIndex: number,
    action: "stage" | "unstage" | "discard"
  ) => {
    if (action === "discard" && !window.confirm("丢弃这个 hunk 的修改？")) return;
    setWorking(`hunk:${file.path}:${hunkIndex}`);
    setError("");
    try {
      await api(`/api/projects/${project.id}/git/hunk`, {
        method: "POST",
        body: JSON.stringify({
          path: file.path,
          staged: kind === "staged",
          hunkIndex,
          action
        })
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };
  const commit = async () => {
    if (!message.trim() || staged.length === 0) return;
    if (
      !window.confirm(
        `提交以下 ${staged.length} 个文件？\n\n${staged.map((file) => file.path).join("\n")}`
      )
    )
      return;
    setWorking("commit");
    setError("");
    try {
      const result = await api<{ ok: boolean; output: string; hash: string }>(
        `/api/projects/${project.id}/git/commit`,
        { method: "POST", body: JSON.stringify({ message }) }
      );
      setMessage("");
      await refresh();
      toast.success(`提交完成 · ${result.hash}`, { description: result.output });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };
  const remote = async (action: "fetch" | "pull" | "push") => {
    setWorking(action);
    setError("");
    try {
      const result = await api<{ output: string }>(`/api/projects/${project.id}/git/remote`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      await refresh();
      toast.success(action, { description: result.output || "完成" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };

  if (loading && !status)
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-xs text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> 正在读取 Git 状态
      </div>
    );
  if (error && !status)
    return <p className="m-3 rounded-lg bg-red-50 p-3 text-xs text-red-600">{error}</p>;
  if (!status?.isRepository)
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <GitCompare className="mb-3 size-10 text-muted-foreground" />
        <b className="text-sm text-foreground">当前目录不是 Git 仓库</b>
        <p className="mt-1 text-xs">在项目目录执行 git init 后，刷新此面板即可查看变更。</p>
      </div>
    );

  const renderDiff = (file: GitFile, kind: "staged" | "unstaged", diff: string) => (
    <GitDiffView
      diff={diff}
      path={file.path}
      hunkKind={kind}
      onOpenFile={onOpenFile}
      onHunkAction={(hunkIndex, action) => void applyHunk(file, kind, hunkIndex, action)}
    />
  );

  const renderFile = (file: GitFile, kind: "staged" | "unstaged") => {
    const diffKey = `${kind}:${file.path}`;
    const statusCode = kind === "staged" ? file.indexStatus : file.worktreeStatus;
    const badge = statusCode === "?" ? "U" : statusCode;
    const isDiffLoading = working === `diff:${diffKey}`;
    return (
      <div key={`${kind}:${file.path}`} className="git-file-group">
        <div className="git-file-row">
          <button
            className="grid size-6 shrink-0 place-items-center text-muted-foreground"
            onClick={() => void loadDiff(file, kind)}
            title="查看差异"
          >
            {isDiffLoading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : expanded[diffKey] !== undefined ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
          <span className={`git-status-badge git-status-${badge.toLowerCase()}`}>{badge}</span>
          <button
            className="min-w-0 flex-1 truncate text-left text-xs text-foreground hover:text-primary"
            onClick={() => void loadDiff(file, kind)}
            title={file.path}
          >
            {file.path}
          </button>
          <button
            className="panel-icon-button !size-7"
            onClick={() => onOpenFile?.(file.path, 1)}
            title="在编辑器打开"
          >
            <FileCode2 className="size-3.5" />
          </button>
          {kind === "unstaged" && (
            <button
              className="panel-icon-button !size-7"
              onClick={() => void updateFiles("discard", [file.path])}
              disabled={working !== null}
              title="丢弃修改"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button
            className="panel-icon-button !size-7"
            onClick={() => void updateFiles(kind === "staged" ? "unstage" : "stage", [file.path])}
            disabled={working !== null}
            title={kind === "staged" ? "取消暂存" : "暂存"}
          >
            {kind === "staged" ? (
              <RotateCcw className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
          </button>
        </div>
        {expanded[diffKey] !== undefined && renderDiff(file, kind, expanded[diffKey] ?? "")}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <GitBranch className="size-4 text-violet-500" />
        <span className="truncate text-xs font-semibold text-foreground">{status.branch}</span>
        {status.hasUpstream && (
          <span className="text-[11px] text-muted-foreground">
            ↑{status.ahead ?? 0} ↓{status.behind ?? 0}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            className="panel-icon-button !size-7"
            title="fetch"
            onClick={() => void remote("fetch")}
          >
            <Download className="size-3.5" />
          </button>
          <button
            className="panel-icon-button !size-7"
            title="pull"
            onClick={() => void remote("pull")}
          >
            <ArrowDownToLine className="size-3.5" />
          </button>
          <button
            className="panel-icon-button !size-7"
            title="push"
            onClick={() => void remote("push")}
          >
            <ArrowUpFromLine className="size-3.5" />
          </button>
          <button
            className="panel-icon-button !size-7"
            onClick={() => void refresh()}
            title="刷新 Git 状态"
          >
            <RefreshCw className={`size-3.5 ${loading || working ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      <div className="flex shrink-0 border-b border-border px-2 py-1.5">
        <Tabs value={tab} onValueChange={(value) => setTab(value as GitTab)}>
          <TabsList>
            <TabsTrigger value="changes" className="px-2.5 text-xs">
              变更
            </TabsTrigger>
            <TabsTrigger value="branches" className="px-2.5 text-xs">
              分支
            </TabsTrigger>
            <TabsTrigger value="history" className="px-2.5 text-xs">
              历史
            </TabsTrigger>
            <TabsTrigger value="timeline" className="px-2.5 text-xs">
              时间线
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {error && (
        <p className="mx-3 mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {tab === "changes" && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conflicts.length > 0 && (
              <GitSection title={`冲突 · ${conflicts.length}`}>
                {conflicts.map((file) => (
                  <div key={file.path} className="git-file-row">
                    <span className="git-status-badge git-status-u">C</span>
                    <span className="min-w-0 flex-1 truncate text-xs">{file.path}</span>
                    <button
                      className="text-[11px] text-primary"
                      onClick={() => onOpenFile?.(file.path, 1)}
                    >
                      打开
                    </button>
                    <button
                      className="text-[11px] text-primary"
                      onClick={() =>
                        void api(`/api/projects/${project.id}/git/conflict`, {
                          method: "POST",
                          body: JSON.stringify({ path: file.path, strategy: "ours" })
                        }).then(() => refresh())
                      }
                    >
                      用我们的
                    </button>
                    <button
                      className="text-[11px] text-primary"
                      onClick={() =>
                        void api(`/api/projects/${project.id}/git/conflict`, {
                          method: "POST",
                          body: JSON.stringify({ path: file.path, strategy: "theirs" })
                        }).then(() => refresh())
                      }
                    >
                      用他们的
                    </button>
                  </div>
                ))}
              </GitSection>
            )}
            <GitSection
              title={`已暂存 · ${staged.length}`}
              action={staged.length ? "全部取消暂存" : undefined}
              onAction={() =>
                void updateFiles(
                  "unstage",
                  staged.map((file) => file.path)
                )
              }
            >
              {staged.length ? (
                <VirtualRows
                  items={staged}
                  itemHeight={40}
                  height={Math.min(360, Math.max(160, staged.length * 40))}
                  disabled={staged.some((file) => expanded[`staged:${file.path}`] !== undefined)}
                  renderItem={(file) => renderFile(file, "staged")}
                />
              ) : (
                <p className="git-empty">暂无已暂存文件</p>
              )}
            </GitSection>
            <GitSection
              title={`工作区变更 · ${unstaged.length}`}
              action={unstaged.length ? "全部暂存" : undefined}
              onAction={() =>
                void updateFiles(
                  "stage",
                  unstaged.map((file) => file.path)
                )
              }
            >
              {unstaged.length ? (
                <VirtualRows
                  items={unstaged}
                  itemHeight={40}
                  height={Math.min(420, Math.max(160, unstaged.length * 40))}
                  disabled={unstaged.some(
                    (file) => expanded[`unstaged:${file.path}`] !== undefined
                  )}
                  renderItem={(file) => renderFile(file, "unstaged")}
                />
              ) : (
                <p className="git-empty">工作区干净</p>
              )}
            </GitSection>
          </div>
          <div className="border-t border-border bg-background/60 p-3 sm:px-5 sm:py-4">
            <textarea
              className="field min-h-14 resize-none"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="填写提交信息，或生成后继续编辑…"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["commit", "生成提交信息", staged.length === 0],
                  ["summary", "生成摘要", staged.length === 0],
                  ["release", "发布说明", false]
                ] as const
              ).map(([kind, label, disabled]) => (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[11px]"
                  disabled={disabled || working !== null || suggesting !== null}
                  onClick={() => {
                    setSuggesting(kind);
                    void api<{ message: string }>(
                      `/api/projects/${project.id}/git/suggest-message`,
                      {
                        method: "POST",
                        body: JSON.stringify({ kind })
                      }
                    )
                      .then((result) => setMessage(result.message))
                      .catch((reason) =>
                        setError(reason instanceof Error ? reason.message : String(reason))
                      )
                      .finally(() => setSuggesting(null));
                  }}
                >
                  {suggesting === kind ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {label}
                </Button>
              ))}
            </div>
            <Button
              className="mt-2 h-9 w-full text-xs"
              size="sm"
              disabled={!message.trim() || staged.length === 0 || working !== null}
              onClick={() => void commit()}
            >
              {working === "commit" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <GitCommit className="size-3.5" />
              )}
              提交 {staged.length ? `(${staged.length})` : ""}
            </Button>
          </div>
        </>
      )}
      {tab === "branches" && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <form
            className="mb-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newBranch.trim()) return;
              void api(`/api/projects/${project.id}/git/branches`, {
                method: "POST",
                body: JSON.stringify({ name: newBranch.trim(), checkout: true })
              })
                .then(() => {
                  setNewBranch("");
                  return Promise.all([refresh(), loadBranches()]);
                })
                .catch((reason) =>
                  setError(reason instanceof Error ? reason.message : String(reason))
                );
            }}
          >
            <Input
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
              placeholder="新分支名"
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" className="h-8">
              <Plus className="size-3.5" /> 创建
            </Button>
          </form>
          {branches.map((branch) => (
            <div key={branch.name} className="git-file-row">
              <span className="min-w-0 flex-1 truncate text-xs">
                {branch.current ? "* " : ""}
                {branch.name}
                {branch.remote ? " · remote" : ""}
              </span>
              {!branch.current && (
                <>
                  <button
                    className="text-[11px] text-primary"
                    onClick={() =>
                      void api(`/api/projects/${project.id}/git/checkout`, {
                        method: "POST",
                        body: JSON.stringify({ name: branch.name })
                      }).then(() => Promise.all([refresh(), loadBranches()]))
                    }
                  >
                    切换
                  </button>
                  {!branch.remote && (
                    <button
                      className="text-[11px] text-destructive"
                      onClick={() => {
                        if (!window.confirm(`删除分支 ${branch.name}？`)) return;
                        void api(
                          `/api/projects/${project.id}/git/branches?name=${encodeURIComponent(branch.name)}`,
                          { method: "DELETE" }
                        ).then(() => loadBranches());
                      }}
                    >
                      删除
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "history" && (
        <div
          className={`git-history-layout ${detail && mobileHistoryPane === "detail" ? "is-detail" : ""}`}
        >
          <div className="git-history-commits">
            {commits.map((commitItem) => (
              <button
                key={commitItem.hash}
                type="button"
                className={`git-file-row w-full text-left ${detail?.hash === commitItem.hash ? "is-active" : ""}`}
                onClick={() => void openCommit(commitItem.hash)}
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {commitItem.shortHash}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{commitItem.subject}</span>
              </button>
            ))}
            {commits.length === 0 ? <p className="git-empty">暂无提交记录</p> : null}
          </div>
          <div className="git-history-main">
            {detail ? (
              <>
                <div className="git-history-header shrink-0 border-b border-border p-3 text-xs">
                  <button
                    type="button"
                    className="mb-2 inline-flex items-center gap-1 text-[11px] text-primary md:hidden"
                    onClick={() => setMobileHistoryPane("list")}
                  >
                    <ChevronLeft className="size-3.5" />
                    提交列表
                  </button>
                  <p className="font-semibold">{detail.subject}</p>
                  <p className="mt-1 text-muted-foreground">
                    {detail.author} · {detail.date}
                  </p>
                  {detail.body ? (
                    <pre className="git-history-commit-body mt-2 whitespace-pre-wrap text-muted-foreground">
                      {detail.body}
                    </pre>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detail.parents.map((parent) => (
                      <button
                        key={parent}
                        className="text-[11px] text-primary"
                        onClick={() => void openCommit(parent)}
                      >
                        父提交 {parent.slice(0, 7)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="git-history-body min-h-0 flex-1">
                  <div className="git-history-files">
                    {detail.files.map((file) => {
                      const filePath = commitDiffPath(file.path);
                      return (
                        <button
                          key={`${file.status}:${file.path}`}
                          type="button"
                          className={`git-file-row w-full text-left ${historyFile === filePath ? "is-active" : ""}`}
                          onClick={() => void openCommitFile(detail.hash, file)}
                          title={commitDiffLabel(file)}
                        >
                          <span
                            className={`git-status-badge git-status-${(file.status[0] ?? "m").toLowerCase()}`}
                          >
                            {file.status[0] ?? "M"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs">
                            {commitDiffLabel(file)}
                          </span>
                        </button>
                      );
                    })}
                    {detail.files.length === 0 ? (
                      <p className="git-empty">这次提交没有文件变更</p>
                    ) : null}
                  </div>
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {working?.startsWith("history:") ? (
                      <div className="flex items-center gap-2 px-4 py-8 text-xs text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" /> 正在读取提交差异
                      </div>
                    ) : historyFile ? (
                      <GitDiffView
                        diff={historyDiff}
                        path={historyFile}
                        fill
                        onOpenFile={onOpenFile}
                      />
                    ) : (
                      <p className="git-empty">选择一个文件查看这次提交的差异</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="git-empty">选择一条提交，查看文件差异</p>
            )}
          </div>
        </div>
      )}
      {tab === "timeline" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {operations.length === 0 ? (
            <p className="git-empty">暂无本地操作。暂存、丢弃和恢复检查点会出现在这里。</p>
          ) : (
            operations.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 border-b border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.kind} · {formatDateTime(item.createdAt)}
                  </p>
                </div>
                {item.undoable ? (
                  <button
                    className="text-[11px] text-primary"
                    onClick={() =>
                      void api(`/api/operations/${item.id}/undo`, { method: "POST" })
                        .then(() => {
                          toast.success("已撤销到该操作前的检查点");
                          void refresh();
                        })
                        .catch((error) =>
                          toast.error(error instanceof Error ? error.message : "撤销失败")
                        )
                    }
                  >
                    撤销
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
