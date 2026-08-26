import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Blocks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type { McpServer, Provider, SkillInfo } from "@/types";

export function SkillsMcpDialog({
  open,
  onOpenChange,
  projectId,
  providers
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  providers: Provider[];
}) {
  const qc = useQueryClient();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState("");
  const selected = providerId || providers[0]?.id || "";
  const skills = useQuery({
    queryKey: ["skills", projectId],
    queryFn: () =>
      api<{ project: SkillInfo[]; provider: SkillInfo[] }>(`/api/projects/${projectId}/skills`),
    enabled: open && Boolean(projectId)
  });
  const mcp = useQuery({
    queryKey: ["mcp", selected],
    queryFn: () => api<{ servers: McpServer[] }>(`/api/providers/${selected}/mcp`),
    enabled: open && Boolean(selected)
  });
  const saveMcp = useMutation({
    mutationFn: () =>
      api(`/api/providers/${selected}/mcp`, {
        method: "POST",
        body: JSON.stringify({
          name,
          command,
          args: args
            .split(/\s+/)
            .map((item) => item.trim())
            .filter(Boolean)
        })
      }),
    onSuccess: async () => {
      setName("");
      setArgs("");
      await qc.invalidateQueries({ queryKey: ["mcp", selected] });
      toast.success("已保存 MCP 服务器");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存 MCP 失败")
  });
  const toggleMcp = useMutation({
    mutationFn: (server: McpServer) =>
      api(`/api/providers/${selected}/mcp/${encodeURIComponent(server.name)}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled: !server.enabled })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp", selected] })
  });
  const removeMcp = useMutation({
    mutationFn: (serverName: string) =>
      api(`/api/providers/${selected}/mcp/${encodeURIComponent(serverName)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp", selected] })
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] sm:w-[min(92vw,760px)]">
        <DialogTitle className="flex items-center gap-2">
          <Blocks className="size-4" /> Skills / MCP
        </DialogTitle>
        <DialogDescription>
          管理当前工程可见的 Skills，以及 Provider config.toml 中的 MCP 服务器。
        </DialogDescription>
        <section className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Skills
          </h3>
          {[...(skills.data?.project ?? []), ...(skills.data?.provider ?? [])].map((skill) => (
            <div key={skill.id} className="rounded-xl border bg-card p-3">
              <p className="text-sm font-medium">
                {skill.name}
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {skill.source === "project" ? "项目" : "Provider"}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {skill.description || skill.path}
              </p>
            </div>
          ))}
          {(skills.data?.project.length ?? 0) + (skills.data?.provider.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              未发现 SKILL.md。可放在项目 `.codex/skills` 或 Provider CODEX_HOME/skills。
            </p>
          ) : null}
        </section>
        <section className="mt-5 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            MCP 服务器
          </h3>
          <select
            className="field mt-0"
            value={selected}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          {(mcp.data?.servers ?? []).map((server) => (
            <div key={server.name} className="flex items-start gap-2 rounded-xl border bg-card p-3">
              <Switch
                checked={server.enabled}
                onCheckedChange={() => toggleMcp.mutate(server)}
                aria-label={`启用 ${server.name}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{server.name}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {server.command
                    ? `${server.command} ${server.args.join(" ")}`.trim()
                    : server.url}
                </p>
              </div>
              <button
                type="button"
                className="text-[11px] text-destructive"
                onClick={() => removeMcp.mutate(server.name)}
              >
                删除
              </button>
            </div>
          ))}
          <div className="rounded-xl border bg-muted/40 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="field-label">
                名称
                <input
                  className="field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="github"
                />
              </label>
              <label className="field-label">
                命令
                <input
                  className="field font-mono"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npx"
                />
              </label>
            </div>
            <label className="field-label mt-2">
              参数
              <input
                className="field font-mono"
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder="-y @modelcontextprotocol/server-github"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={!selected || !name.trim() || saveMcp.isPending}
              onClick={() => saveMcp.mutate()}
            >
              <Plus className="size-4" /> 添加 MCP
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
