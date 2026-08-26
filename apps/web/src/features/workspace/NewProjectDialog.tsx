import { useState } from "react";
import { FolderPlus, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Provider } from "@/types";
import { ServerFolderPicker } from "./ServerFolderPicker";

export function NewProjectDialog({
  open,
  onOpenChange,
  providers,
  onCreate
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  providers: Provider[];
  onCreate: (v: { name: string; path: string; providerId: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [p, setP] = useState("");
  const [providerId, setProviderId] = useState("");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const applyPath = (path: string) => {
    setP(path);
    if (!name.trim()) {
      const base = path.split("/").filter(Boolean).at(-1);
      if (base) setName(base);
    }
    setPicker(false);
  };

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
            <FolderPlus />
            打开服务器工程
          </DialogTitle>
          <DialogDescription>
            通过文件夹弹框浏览部署服务器上的目录，或直接输入服务账号可访问的绝对路径。
          </DialogDescription>
          <label className="field-label mt-5">工程名称</label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="codex-omni"
          />
          <label className="field-label mt-4">服务器绝对路径</label>
          <div className="mt-1.5 flex gap-2">
            <input
              className="field mt-0 font-mono"
              value={p}
              onChange={(e) => setP(e.target.value)}
              placeholder="/srv/projects/example"
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
          <label className="field-label mt-4">默认 Provider</label>
          <select
            className="field"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="">稍后选择</option>
            {providers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-6 flex justify-stretch sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onCreate({ name, path: p, providerId: providerId || null });
                  onOpenChange(false);
                  setName("");
                  setP("");
                } catch (reason) {
                  setError(String(reason instanceof Error ? reason.message : reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              打开工程
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ServerFolderPicker
        open={picker}
        initialPath={p}
        onOpenChange={setPicker}
        onSelect={applyPath}
      />
    </>
  );
}
