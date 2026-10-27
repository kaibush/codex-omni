import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { api, apiUpload } from "@/lib/api";
import { brandIconFileError, brandingQueryKey, fetchBranding, type Branding } from "@/lib/branding";
import { SettingsCard } from "./settings-ui";

export function BrandIconSettings() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const branding = useQuery({
    queryKey: brandingQueryKey,
    queryFn: fetchBranding,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false
  });
  const upload = useMutation({
    mutationFn: (file: File) => apiUpload<Branding>("/api/branding/icon", file),
    onSuccess: (next) => {
      queryClient.setQueryData(brandingQueryKey, next);
      toast.success("图标已更新");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "上传图标失败")
  });
  const reset = useMutation({
    mutationFn: () => api<Branding>("/api/branding/icon", { method: "DELETE" }),
    onSuccess: (next) => {
      queryClient.setQueryData(brandingQueryKey, next);
      toast.success("已恢复默认图标");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "恢复默认图标失败")
  });
  const custom = Boolean(branding.data?.iconUrl);
  const busy = upload.isPending || reset.isPending;

  return (
    <SettingsCard
      title="工作台图标"
      description="浏览器标签和系统标识共用这一张图标，上传后立即生效。"
    >
      <div className="flex flex-wrap items-center gap-4">
        <BrandMark className="size-12 rounded-lg" iconClassName="size-6" alt="工作台图标" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              {custom ? "更换图标" : "上传图标"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!custom || busy}
              onClick={() => reset.mutate()}
            >
              <RotateCcw className="size-4" />
              恢复默认
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            支持 PNG、JPG、WEBP、GIF、ICO、SVG，不超过 512 KB。
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.ico,.svg"
        className="hidden"
        aria-label="选择工作台图标"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const message = brandIconFileError(file);
          if (message) {
            toast.error(message);
            return;
          }
          upload.mutate(file);
        }}
      />
    </SettingsCard>
  );
}
