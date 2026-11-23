import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function RefreshModelsButton({
  providerId,
  providerName
}: {
  providerId: string | undefined;
  providerName: string | undefined;
}) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: (id: string) =>
      api<{
        ok: boolean;
        models: string[];
        fetched?: number;
        error?: string;
      }>(`/api/providers/${encodeURIComponent(id)}/test`, { method: "POST" }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
      if (!result.ok || result.error) {
        toast.error(`刷新模型失败：${result.error || "上游没有返回模型"}`);
      } else if (!result.fetched) {
        toast.info("上游未返回可用模型");
      } else {
        toast.success(`已刷新模型列表，获取 ${result.fetched} 个上游模型`);
      }
    },
    onError: (error) => toast.error(`刷新模型失败：${error.message}`)
  });
  const label = refresh.isPending ? "正在刷新上游模型" : "刷新上游模型";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-busy={refresh.isPending}
      title={providerId ? `${label}${providerName ? ` · ${providerName}` : ""}` : "请先选择供应商"}
      disabled={!providerId || refresh.isPending}
      onClick={() => providerId && refresh.mutate(providerId)}
    >
      <RefreshCw data-icon="inline-start" className={cn(refresh.isPending && "animate-spin")} />
    </Button>
  );
}
