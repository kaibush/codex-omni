import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Plus, Save, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { TimelineView } from "@/lib/timeline";
import type { PromptTemplate, Provider } from "@/types";

export type WorkspaceSettings = {
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-request" | "never";
  networkAccessEnabled: boolean;
  showReasoning: boolean;
  expandToolCalls: boolean;
  timelineView: TimelineView;
  sendWithEnter: boolean;
  showProviderLabels: boolean;
  executionMode: "plan" | "execute";
  uiFontSize: 13 | 14 | 15 | 16 | 18;
};

export const defaultWorkspaceSettings: WorkspaceSettings = {
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  networkAccessEnabled: true,
  showReasoning: false,
  expandToolCalls: true,
  timelineView: "folded",
  sendWithEnter: true,
  showProviderLabels: true,
  executionMode: "execute",
  uiFontSize: 14
};

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  providers,
  runtime,
  currentCodexHome,
  onSaveProvider,
  onSave,
  onLogout
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  settings: WorkspaceSettings;
  providers: Provider[];
  runtime?: { defaultCodexHome: string; providersRoot: string } | undefined;
  currentCodexHome?: string | undefined;
  onSaveProvider: (provider: Provider) => Promise<void>;
  onSave: (settings: WorkspaceSettings) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateCommand, setTemplateCommand] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<PromptTemplate[]>("/api/templates"),
    enabled: open
  });
  const saveTemplate = useMutation({
    mutationFn: () =>
      api("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          name: templateName,
          command: templateCommand,
          content: templateContent
        })
      }),
    onSuccess: async () => {
      setTemplateName("");
      setTemplateCommand("");
      setTemplateContent("");
      await qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("已保存 Prompt 模板");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存模板失败")
  });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("已删除 Prompt 模板");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除模板失败")
  });
  useEffect(() => setDraft({ ...defaultWorkspaceSettings, ...settings }), [settings, open]);
  useEffect(() => {
    if (open && !providerId) setProviderId(providers[0]?.id ?? "");
  }, [open, providerId, providers]);
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const updateProviderModels = async (models: string[], model: string | null) => {
    if (!selectedProvider) return;
    await onSaveProvider({ ...selectedProvider, models, model });
  };
  const toggle = (
    key: {
      [K in keyof WorkspaceSettings]: WorkspaceSettings[K] extends boolean ? K : never;
    }[keyof WorkspaceSettings]
  ) => setDraft((current) => ({ ...current, [key]: !current[key] }));
  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(92vw,620px)]">
        <DialogTitle className="flex items-center gap-2">
          <SettingsIcon /> 工作区设置
        </DialogTitle>
        <DialogDescription>这些设置会保存到当前工作台，并作用于后续 Codex 对话。</DialogDescription>
        <div className="mt-5 space-y-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Codex 运行
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="field-label">
                文件权限
                <select
                  className="field"
                  value={draft.sandbox}
                  onChange={(e) =>
                    setDraft({ ...draft, sandbox: e.target.value as WorkspaceSettings["sandbox"] })
                  }
                >
                  <option value="read-only">只读：仅查看文件</option>
                  <option value="workspace-write">工作区可写：允许修改当前工程</option>
                  <option value="danger-full-access">完全访问：允许访问全部文件</option>
                </select>
              </label>
              <label className="field-label">
                执行模式
                <select
                  className="field"
                  value={draft.approvalPolicy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      approvalPolicy: e.target.value as WorkspaceSettings["approvalPolicy"]
                    })
                  }
                >
                  <option value="untrusted">建议模式：非可信操作请求确认</option>
                  <option value="on-request">平衡模式（推荐）：需要提升权限时确认</option>
                  <option value="never">全自动：不请求确认</option>
                </select>
              </label>
              <label className="field-label">
                Plan / Execute
                <select
                  className="field"
                  value={draft.executionMode}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      executionMode: e.target.value as WorkspaceSettings["executionMode"]
                    })
                  }
                >
                  <option value="execute">Execute：允许按文件权限修改</option>
                  <option value="plan">Plan：只读规划，确认后再执行</option>
                </select>
              </label>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              平衡模式允许在工作区内正常编辑和运行；需要离开沙箱、访问受限位置或提升权限时才请求确认。全自动仍受上方文件权限限制。
            </p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Codex Home
            </h3>
            <div className="mt-2 space-y-2 rounded-xl border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
              <p>
                <span className="font-sans font-semibold text-foreground">系统 CODEX_HOME</span>
                <br />
                {runtime?.defaultCodexHome || "未读取"}
              </p>
              <p>
                <span className="font-sans font-semibold text-foreground">运行时目录</span>
                <br />
                {selectedProvider?.codexHome ||
                  currentCodexHome ||
                  runtime?.providersRoot ||
                  "未读取"}
              </p>
            </div>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              供应商模型列表
            </h3>
            <div className="mt-2 rounded-xl border bg-muted p-3">
              <select
                className="field mt-0"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              {selectedProvider && (
                <>
                  <div className="mt-3 flex gap-2">
                    <input
                      className="field mt-0"
                      value={modelInput}
                      onChange={(event) => setModelInput(event.target.value)}
                      placeholder="添加这个 Provider 支持的模型"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        const model = modelInput.trim();
                        if (!model || selectedProvider.models.includes(model)) return;
                        await updateProviderModels(
                          [...selectedProvider.models, model],
                          selectedProvider.model || model
                        );
                        setModelInput("");
                      }}
                    >
                      添加
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedProvider.models.map((model) => (
                      <span
                        key={model}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${selectedProvider.model === model ? "border-primary/40 bg-accent text-foreground" : "bg-card"}`}
                      >
                        <button
                          type="button"
                          onClick={() => updateProviderModels(selectedProvider.models, model)}
                        >
                          {model}
                          {selectedProvider.model === model ? " · 默认" : ""}
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            updateProviderModels(
                              selectedProvider.models.filter((item) => item !== model),
                              selectedProvider.model === model ? null : selectedProvider.model
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              界面
            </h3>
            <label className="field-label mt-2">
              工作区字号
              <select
                className="field"
                value={draft.uiFontSize}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    uiFontSize: Number(event.target.value) as WorkspaceSettings["uiFontSize"]
                  })
                }
              >
                <option value={13}>13 · 紧凑</option>
                <option value={14}>14 · 默认</option>
                <option value={15}>15 · 稍大</option>
                <option value={16}>16 · 大</option>
                <option value={18}>18 · 更大</option>
              </select>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              对齐 JetBrains 字体缩放：只放大工作区文字，不影响系统控件。
            </p>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              对话显示
            </h3>
            <label className="field-label mt-2">
              时间线
              <select
                className="field"
                value={draft.timelineView}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    timelineView: event.target.value as WorkspaceSettings["timelineView"]
                  })
                }
              >
                <option value="folded">折叠 · 合并思考和连续执行</option>
                <option value="flat">平铺 · 列出全部原始 Think 和工具</option>
                <option value="expanded">展开 · 列出并打开全部原始事件</option>
              </select>
            </label>
            <div className="mt-2 divide-y rounded-xl border bg-card">
              {(
                [
                  ["showReasoning", "显示 reasoning 事件", "在时间线中保留模型思考事件"],
                  [
                    "networkAccessEnabled",
                    "允许命令访问网络",
                    "Codex 工具中的 curl、包管理器和网络命令可访问公网"
                  ],
                  ["expandToolCalls", "展开工具调用", "工具输出到达时默认展开"],
                  ["showProviderLabels", "显示 Provider 标签", "在消息和 Session 列表中标出供应商"],
                  ["sendWithEnter", "Enter 发送消息", "关闭后使用 Ctrl/Cmd + Enter 发送"]
                ] as const
              ).map(([key, title, description]) => (
                <label key={key} className="flex cursor-pointer items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={() => toggle(key)}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Prompt 模板
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              保存后可在输入框用斜杠命令展开。模板可用{" "}
              {"{{input}}、{{date}}、{{project}}、{{session}}"}，最近使用的命令会排在前面。
            </p>
            <div className="mt-2 space-y-2">
              {(templates.data ?? []).map((item) => (
                <div key={item.id} className="flex items-start gap-2 rounded-xl border bg-card p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.name}</span>
                      {item.command ? (
                        <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {item.command}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.content}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`删除模板 ${item.name}`}
                    onClick={() => deleteTemplate.mutate(item.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <div className="rounded-xl border bg-muted/40 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="field-label">
                    名称
                    <input
                      className="field"
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="代码审查"
                    />
                  </label>
                  <label className="field-label">
                    斜杠命令
                    <input
                      className="field font-mono"
                      value={templateCommand}
                      onChange={(event) => setTemplateCommand(event.target.value)}
                      placeholder="/review"
                    />
                  </label>
                </div>
                <label className="field-label mt-2">
                  模板内容
                  <textarea
                    className="field min-h-20"
                    value={templateContent}
                    onChange={(event) => setTemplateContent(event.target.value)}
                    placeholder="请审查 {{project}} 在 {{date}} 的变更"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2"
                  disabled={
                    !templateName.trim() || !templateContent.trim() || saveTemplate.isPending
                  }
                  onClick={() => saveTemplate.mutate()}
                >
                  <Plus className="size-4" />
                  保存模板
                </Button>
              </div>
            </div>
          </section>
          <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={async () => {
                await onLogout();
                onOpenChange(false);
              }}
            >
              <LogOut className="size-4" />
              退出登录
            </Button>
            <Button disabled={busy} onClick={save}>
              <Save className="size-4" />
              保存设置
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
