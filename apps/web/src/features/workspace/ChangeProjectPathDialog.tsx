import { useEffect, useState } from "react";
import { FolderInput, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Project } from "@/types";
import { ServerFolderPicker } from "./ServerFolderPicker";

export function ChangeProjectPathDialog({
  project,
  open,
  onOpenChange,
  onSave
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (path: string) => Promise<void>;
}) {
  const [path, setPath] = useState(project?.displayPath ?? "");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPath(project?.displayPath ?? "");
    setError("");
    setBusy(false);
    setPicker(false);
  }, [open, project?.displayPath, project?.id]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) setPicker(false);
          onOpenChange(value);
        }}
      >
        <DialogContent>
          <DialogTitle className="flex gap-2">
            <FolderInput />
            切换工程路径
          </DialogTitle>
          <DialogDescription>
            只改服务器上的工程目录，对话和任务记录都会留在当前工程里。如果新路径已经被另一个工程占用，请先删除那个工程再切换。
          </DialogDescription>
          {project ? (
            <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
              当前：{project.displayPath}
            </p>
          ) : null}
          <label className="field-label mt-4">新的服务器绝对路径</label>
          <div className="mt-1.5 flex gap-2">
            <input
              className="field mt-0 font-mono"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/root/project/github/kaibush/grok-iq-plus"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => setPicker(true)}
            >
              <FolderSearch className="size-4" />
              浏览
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-6 flex justify-stretch sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              disabled={busy || !path.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onSave(path.trim());
                  onOpenChange(false);
                } catch (reason) {
                  setError(String(reason instanceof Error ? reason.message : reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              切换路径
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ServerFolderPicker
        open={picker}
        initialPath={path || project?.displayPath || ""}
        onOpenChange={setPicker}
        onSelect={(next) => {
          setPath(next);
          setPicker(false);
        }}
      />
    </>
  );
}
