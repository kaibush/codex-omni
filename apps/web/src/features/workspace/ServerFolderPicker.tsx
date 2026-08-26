import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, HardDrive, Home, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { FilesystemBrowse } from "@/types";

export function ServerFolderPicker({
  open,
  initialPath,
  onOpenChange,
  onSelect
}: {
  open: boolean;
  initialPath?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}) {
  const [browse, setBrowse] = useState<FilesystemBrowse | null>(null);
  const [jumpPath, setJumpPath] = useState(initialPath ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (path?: string) => {
    setBusy(true);
    setError("");
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const result = await api<FilesystemBrowse>(`/api/filesystem/browse${query}`);
      setBrowse(result);
      setJumpPath(result.path);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load(initialPath || undefined);
  }, [open, initialPath]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92dvh,720px)] w-full max-w-none flex-col sm:w-[min(92vw,720px)]">
        <DialogTitle className="flex items-center gap-2">
          <FolderOpen className="size-5" />
          选择服务器目录
        </DialogTitle>
        <DialogDescription>
          浏览当前服务账号能访问的路径，选中后作为工程目录打开。
        </DialogDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          {(browse?.roots ?? []).map((root) => (
            <Button
              key={root.path}
              type="button"
              size="sm"
              variant={browse?.path === root.path ? "default" : "outline"}
              onClick={() => void load(root.path)}
            >
              {root.path === "/" || root.name === "/" ? (
                <HardDrive className="size-3.5" />
              ) : (
                <Home className="size-3.5" />
              )}
              {root.name}
            </Button>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load(jumpPath);
          }}
        >
          <input
            className="field mt-0 font-mono"
            value={jumpPath}
            onChange={(event) => setJumpPath(event.target.value)}
            placeholder="/root/project"
          />
          <Button type="submit" variant="outline" className="shrink-0">
            转到
          </Button>
        </form>
        <div className="mt-3 flex min-h-9 flex-wrap items-center gap-1 overflow-x-auto text-sm">
          {(browse?.breadcrumbs ?? []).map((crumb, index) => (
            <button
              key={crumb.path}
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => void load(crumb.path)}
            >
              {index > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
              <span className="font-medium">{crumb.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/60">
          {busy && !browse ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {browse?.parent && (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-card"
                  onClick={() => void load(browse.parent ?? undefined)}
                >
                  <Folder className="size-4 text-muted-foreground" />
                  <span className="font-mono text-sm">..</span>
                </button>
              )}
              {(browse?.entries ?? []).map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  disabled={!entry.readable}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void load(entry.path)}
                  onDoubleClick={() => {
                    if (entry.readable) onSelect(entry.path);
                  }}
                >
                  <Folder className="size-4 text-sky-700/80" />
                  <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                  {entry.symlink && <span className="text-[11px] text-muted-foreground">链接</span>}
                </button>
              ))}
              {browse && browse.entries.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  这个目录下没有可进入的文件夹
                </p>
              )}
            </div>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={!browse} onClick={() => browse && onSelect(browse.path)}>
            选择此文件夹
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
