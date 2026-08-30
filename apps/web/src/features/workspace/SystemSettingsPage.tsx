import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Blocks,
  BookOpen,
  Clock3,
  Folder,
  KeyRound,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  RotateCcw,
  Save,
  ShieldQuestion,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ThemeSwitch } from "@/components/theme-switch";
import { useTheme } from "@/context/theme-provider";
import { api } from "@/lib/api";
import { workspacePath } from "@/lib/routes";
import { formatDataSize, formatUptime } from "@/lib/utils";
import type { Project, PromptTemplate, Provider, ProviderHomeMode, RuntimeInfo } from "@/types";
import { ApprovalAuditDialog } from "./ApprovalAuditDialog";
import { ProjectKnowledgeDialog } from "./ProjectKnowledgeDialog";
import { ProviderDialog } from "./ProviderDialog";
import { ScheduleDialog } from "./ScheduleDialog";
import { defaultWorkspaceSettings, type WorkspaceSettings } from "./SettingsDialog";
import { findSettingsSection } from "./settings-navigation";
import { SettingsUpdatesSection } from "./SettingsUpdatesSection";
import { SettingsMobileNav, SettingsSidebar } from "./settings/settings-sidebar";
import {
  SettingsCard,
  SettingsField,
  SettingsFormGrid,
  SettingsInfoRow,
  SettingsProjectSelect,
  SettingsSelect,
  SettingsSwitchField,
  SettingsUsageBar
} from "./settings/settings-ui";
import { SkillsMcpDialog } from "./SkillsMcpDialog";
import { TaskBoardDialog } from "./TaskBoardDialog";

const sandboxLabel: Record<WorkspaceSettings["sandbox"], string> = {
  "read-only": "只读",
  "workspace-write": "工作区可写",
  "danger-full-access": "完全访问"
};

const approvalLabel: Record<WorkspaceSettings["approvalPolicy"], string> = {
  untrusted: "建议模式",
  "on-request": "平衡模式",
  never: "全自动"
};

const homeModeLabel: Record<ProviderHomeMode, string> = {
  "api-key": "API Key",
  external: "已有目录",
  managed: "托管配置"
};

export function SystemSettingsPage() {
  const { section } = useParams();
  const active = findSettingsSection(section);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState("");
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<WorkspaceSettings>("/api/settings")
  });
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<Provider[]>("/api/providers")
  });
  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<PromptTemplate[]>("/api/templates")
  });
  const runtimeQuery = useQuery({
    queryKey: ["runtime"],
    queryFn: () => api<RuntimeInfo>("/api/runtime"),
    refetchInterval: 30_000
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects")
  });
  const sessionQuery = useQuery({
    queryKey: ["auth", "settings"],
    queryFn: () => api<{ user?: { username: string; role: string } }>("/api/auth/session")
  });
  const [draft, setDraft] = useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const [templateName, setTemplateName] = useState("");
  const [templateCommand, setTemplateCommand] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const settings = useMemo(
    () => ({ ...defaultWorkspaceSettings, ...(settingsQuery.data ?? {}) }),
    [settingsQuery.data]
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);
  const projects = projectsQuery.data ?? [];
  useEffect(() => {
    if (settingsProjectId || !projects.length) return;
    const latest = [...projects].sort(
      (left, right) =>
        (right.lastOpenedAt ?? right.updatedAt) - (left.lastOpenedAt ?? left.updatedAt)
    )[0];
    if (latest) setSettingsProjectId(latest.id);
  }, [projects, settingsProjectId]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api("/api/settings", { method: "PUT", body: JSON.stringify(draft) }),
    onSuccess: () => {
      queryClient.setQueryData(["settings"], draft);
      toast.success("设置已保存");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败")
  });
  const saveTemplate = useMutation({
    mutationFn: () =>
      api("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          name: templateName.trim(),
          command: templateCommand.trim(),
          content: templateContent.trim()
        })
      }),
    onSuccess: async () => {
      setTemplateName("");
      setTemplateCommand("");
      setTemplateContent("");
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("已保存 Prompt 模板");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存模板失败")
  });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] })
  });
  const updateProviderModel = async (provider: Provider, model: string) => {
    await api(`/api/providers/${provider.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...provider, model: model || null })
    });
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
  };

  const showSave = active.id === "runtime" || active.id === "appearance";
  const providers = providersQuery.data ?? [];
  const defaultProvider = providers.find((item) => item.isDefault) ?? providers[0];

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r lg:block">
        <SettingsSidebar activeId={active.id} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetTitle className="sr-only">系统设置菜单</SheetTitle>
          <SettingsSidebar activeId={active.id} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="lg:hidden"
            aria-label="打开设置菜单"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-4" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight sm:text-lg">
            {active.title}
          </h1>
          <ThemeSwitch />
          {dirty ? <Badge variant="warning">有未保存修改</Badge> : null}
          {showSave ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => setDraft(settings)}
              >
                <RotateCcw className="size-4" />
                重置
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!dirty || save.isPending || settingsQuery.isPending}
                onClick={() => save.mutate()}
              >
                <Save className="size-4" />
                保存
              </Button>
            </>
          ) : null}
        </header>
        <SettingsMobileNav activeId={active.id} />
        <div className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-4 sm:py-5">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            {active.id === "system-info" ? (
              <>
                <SettingsCard title="当前版本" description="后续检查更新时会对照这个版本号。">
                  <SettingsFormGrid>
                    <SettingsInfoRow label="应用" value="Codex Omni" />
                    <SettingsInfoRow
                      label="版本"
                      value={runtimeQuery.data?.host.app.version || "未读取"}
                    />
                    <SettingsInfoRow
                      label="Node.js"
                      value={runtimeQuery.data?.host.node || "未读取"}
                    />
                    <SettingsInfoRow
                      label="主机名"
                      value={runtimeQuery.data?.host.hostname || "未读取"}
                    />
                  </SettingsFormGrid>
                </SettingsCard>
                <SettingsCard
                  title="主机资源"
                  description="当前这台电脑的 CPU、内存和存储，每 30 秒自动刷新。"
                >
                  <SettingsFormGrid>
                    <SettingsUsageBar
                      label="CPU"
                      value={runtimeQuery.data?.host.cpu.usage ?? 0}
                      detail={
                        runtimeQuery.data
                          ? `${runtimeQuery.data.host.cpu.cores} 核 · ${runtimeQuery.data.host.cpu.model} · 负载 ${runtimeQuery.data.host.cpu.load1.toFixed(2)}`
                          : "未读取"
                      }
                    />
                    <SettingsUsageBar
                      label="内存"
                      value={runtimeQuery.data?.host.memory.usage ?? 0}
                      detail={
                        runtimeQuery.data
                          ? `${formatDataSize(runtimeQuery.data.host.memory.used)} / ${formatDataSize(runtimeQuery.data.host.memory.total)}`
                          : "未读取"
                      }
                    />
                    <SettingsUsageBar
                      label="存储"
                      value={runtimeQuery.data?.host.storage.usage ?? 0}
                      detail={
                        runtimeQuery.data
                          ? `${formatDataSize(runtimeQuery.data.host.storage.used)} / ${formatDataSize(runtimeQuery.data.host.storage.total)}`
                          : "未读取"
                      }
                    />
                    <SettingsInfoRow
                      label="系统"
                      value={
                        runtimeQuery.data
                          ? `${runtimeQuery.data.host.platform} ${runtimeQuery.data.host.arch} · ${runtimeQuery.data.host.release} · 已运行 ${formatUptime(runtimeQuery.data.host.uptimeSec)}`
                          : "未读取"
                      }
                    />
                  </SettingsFormGrid>
                </SettingsCard>
                <SettingsCard title="系统信息" description="当前工作台标识和运行目录。">
                  <SettingsFormGrid>
                    <SettingsInfoRow label="工作台" value="Codex Omni" />
                    <SettingsInfoRow
                      label="供应商"
                      value={
                        defaultProvider
                          ? `${providers.length} 个 · 默认 ${defaultProvider.name}`
                          : "尚未配置"
                      }
                    />
                    <SettingsInfoRow
                      icon={Folder}
                      label="系统 CODEX_HOME"
                      value={runtimeQuery.data?.defaultCodexHome || "未读取"}
                    />
                    <SettingsInfoRow
                      icon={Folder}
                      label="运行时目录"
                      value={
                        defaultProvider?.codexHome || runtimeQuery.data?.providersRoot || "未读取"
                      }
                    />
                  </SettingsFormGrid>
                </SettingsCard>
                <SettingsCard title="当前运行策略" description="这些值可在「运行与权限」中修改。">
                  <SettingsFormGrid>
                    <SettingsInfoRow label="文件权限" value={sandboxLabel[settings.sandbox]} />
                    <SettingsInfoRow
                      label="审批策略"
                      value={approvalLabel[settings.approvalPolicy]}
                    />
                    <SettingsInfoRow
                      label="Plan / Execute"
                      value={settings.executionMode === "plan" ? "Plan" : "Execute"}
                    />
                    <SettingsInfoRow
                      label="网络访问"
                      value={settings.networkAccessEnabled ? "允许" : "禁止"}
                    />
                  </SettingsFormGrid>
                </SettingsCard>
                <SettingsCard
                  title="对话工具"
                  description="任务看板和审批审计以小弹框打开，不进入独立设置页。"
                >
                  <div className="space-y-3">
                    <SettingsField label="当前工程">
                      <SettingsProjectSelect
                        projects={projects}
                        value={settingsProjectId}
                        onValueChange={setSettingsProjectId}
                      />
                    </SettingsField>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!settingsProjectId}
                        onClick={() => setTaskBoardOpen(true)}
                      >
                        <ListChecks className="size-4" />
                        任务看板
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setApprovalOpen(true)}>
                        <ShieldQuestion className="size-4" />
                        审批审计
                      </Button>
                    </div>
                  </div>
                </SettingsCard>
                <SettingsCard
                  title="项目工具"
                  description="项目规则、Skills/MCP 和定时任务也用小弹框打开，不做成设置子菜单。"
                >
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!settingsProjectId}
                      onClick={() => setKnowledgeOpen(true)}
                    >
                      <BookOpen className="size-4" />
                      项目规则
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!settingsProjectId}
                      onClick={() => setSkillsOpen(true)}
                    >
                      <Blocks className="size-4" />
                      Skills / MCP
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!settingsProjectId}
                      onClick={() => setScheduleOpen(true)}
                    >
                      <Clock3 className="size-4" />
                      定时任务
                    </Button>
                  </div>
                </SettingsCard>
              </>
            ) : null}

            {active.id === "runtime" ? (
              <SettingsCard
                title="运行与权限"
                description="这些设置会保存到当前工作台，并作用于后续 Codex 对话。"
              >
                <SettingsFormGrid>
                  <SettingsSelect
                    label="文件权限"
                    hint="限制 Codex 可读写的文件范围。"
                    value={draft.sandbox}
                    onValueChange={(value) => setDraft({ ...draft, sandbox: value })}
                    options={[
                      { value: "read-only", label: "只读：仅查看文件" },
                      { value: "workspace-write", label: "工作区可写：允许修改当前工程" },
                      { value: "danger-full-access", label: "完全访问：允许访问全部文件" }
                    ]}
                  />
                  <SettingsSelect
                    label="审批策略"
                    hint="平衡模式允许在工作区内正常编辑；需要提升权限时才请求确认。"
                    value={draft.approvalPolicy}
                    onValueChange={(value) => setDraft({ ...draft, approvalPolicy: value })}
                    options={[
                      { value: "untrusted", label: "建议模式：非可信操作请求确认" },
                      { value: "on-request", label: "平衡模式（推荐）：需要提升权限时确认" },
                      { value: "never", label: "全自动：不请求确认" }
                    ]}
                  />
                  <SettingsSelect
                    label="Plan / Execute"
                    hint="Plan 只读规划，确认后再执行写入。"
                    value={draft.executionMode}
                    onValueChange={(value) => setDraft({ ...draft, executionMode: value })}
                    options={[
                      { value: "execute", label: "Execute：允许按文件权限修改" },
                      { value: "plan", label: "Plan：只读规划，确认后再执行" }
                    ]}
                  />
                  <SettingsSwitchField
                    label="允许命令访问网络"
                    description="关闭后，命令和工具默认不能访问外网。"
                    checked={draft.networkAccessEnabled}
                    onCheckedChange={(checked) =>
                      setDraft({ ...draft, networkAccessEnabled: checked })
                    }
                  />
                </SettingsFormGrid>
              </SettingsCard>
            ) : null}

            {active.id === "appearance" ? (
              <SettingsCard title="界面与对话" description="只影响当前浏览器中的工作台显示。">
                <SettingsFormGrid>
                  <SettingsSelect
                    label="工作区字号"
                    hint="应用到侧栏、时间线和输入区。"
                    value={String(draft.uiFontSize) as `${WorkspaceSettings["uiFontSize"]}`}
                    onValueChange={(value) =>
                      setDraft({
                        ...draft,
                        uiFontSize: Number(value) as WorkspaceSettings["uiFontSize"]
                      })
                    }
                    options={[
                      { value: "13", label: "13 · 紧凑" },
                      { value: "14", label: "14 · 默认" },
                      { value: "15", label: "15 · 稍大" },
                      { value: "16", label: "16 · 大" },
                      { value: "18", label: "18 · 更大" }
                    ]}
                  />
                  <SettingsInfoRow
                    label="主题"
                    value={theme === "system" ? "跟随系统" : theme === "dark" ? "深色" : "浅色"}
                  />
                  <SettingsSelect
                    label="时间线"
                    hint="折叠合并思考和执行；平铺列出全部原始事件；展开则同时打开卡片。"
                    value={draft.timelineView}
                    onValueChange={(value) => setDraft({ ...draft, timelineView: value })}
                    options={[
                      { value: "folded", label: "折叠 · 合并思考和连续执行" },
                      { value: "flat", label: "平铺 · 列出全部原始 Think 和工具" },
                      { value: "expanded", label: "展开 · 列出并打开全部原始事件" }
                    ]}
                  />
                  <SettingsSwitchField
                    label="显示 reasoning 事件"
                    description="折叠模式下是否展示思考卡片。平铺和展开会始终显示。"
                    checked={draft.showReasoning}
                    onCheckedChange={(checked) => setDraft({ ...draft, showReasoning: checked })}
                  />
                  <SettingsSwitchField
                    label="默认展开工具调用"
                    description="新的工具卡片默认展开详细输出。"
                    checked={draft.expandToolCalls}
                    onCheckedChange={(checked) => setDraft({ ...draft, expandToolCalls: checked })}
                  />
                  <SettingsSwitchField
                    label="显示 Provider 标签"
                    description="在消息上标注当前供应商。"
                    checked={draft.showProviderLabels}
                    onCheckedChange={(checked) =>
                      setDraft({ ...draft, showProviderLabels: checked })
                    }
                  />
                  <SettingsSwitchField
                    label="Enter 发送消息"
                    description="关闭后使用 Ctrl/Cmd + Enter 发送。"
                    checked={draft.sendWithEnter}
                    onCheckedChange={(checked) => setDraft({ ...draft, sendWithEnter: checked })}
                  />
                </SettingsFormGrid>
              </SettingsCard>
            ) : null}

            {active.id === "updates" ? <SettingsUpdatesSection /> : null}

            {active.id === "providers" ? (
              <SettingsCard
                title="供应商与模型"
                description="在此选择默认模型，或打开供应商管理进行新增、编辑和测试连接。"
                actions={
                  <Button type="button" size="sm" onClick={() => setProviderOpen(true)}>
                    <KeyRound className="size-4" />
                    管理供应商
                  </Button>
                }
              >
                {providers.length ? (
                  <div className="space-y-2">
                    {providers.map((provider) => (
                      <div
                        key={provider.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3"
                      >
                        <KeyRound className="size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{provider.name}</p>
                            {provider.isDefault ? <Badge variant="secondary">默认</Badge> : null}
                            <Badge variant="outline">
                              {homeModeLabel[provider.homeMode ?? "managed"]}
                            </Badge>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {provider.baseUrl || provider.codexHome || "未配置 Base URL"}
                          </p>
                        </div>
                        <label className="grid min-w-40 gap-1">
                          <span className="text-[11px] text-muted-foreground">默认模型</span>
                          <Select
                            value={provider.model || "__none__"}
                            onValueChange={(value) =>
                              void updateProviderModel(provider, value === "__none__" ? "" : value)
                            }
                          >
                            <SelectTrigger className="w-full min-w-40">
                              <SelectValue placeholder="未设置模型" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">未设置模型</SelectItem>
                              {provider.models.map((model) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                    还没有供应商，点击「管理供应商」添加。
                  </p>
                )}
              </SettingsCard>
            ) : null}

            {active.id === "templates" ? (
              <>
                <SettingsCard
                  title="已保存模板"
                  description="保存后可在输入框用斜杠命令展开。模板可用 {{input}}、{{date}}、{{project}}、{{session}}。"
                >
                  {(templatesQuery.data ?? []).length ? (
                    <div className="space-y-2">
                      {(templatesQuery.data ?? []).map((template) => (
                        <div
                          key={template.id}
                          className="flex items-start gap-3 rounded-xl border px-3 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-sm font-medium">{template.name}</strong>
                              {template.command ? (
                                <code className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                                  {template.command}
                                </code>
                              ) : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {template.content}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`删除模板 ${template.name}`}
                            onClick={() => deleteTemplate.mutate(template.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">还没有模板。</p>
                  )}
                </SettingsCard>
                <SettingsCard title="新建模板">
                  <SettingsFormGrid>
                    <SettingsField label="名称">
                      <Input
                        value={templateName}
                        onChange={(event) => setTemplateName(event.target.value)}
                        placeholder="代码审查"
                      />
                    </SettingsField>
                    <SettingsField label="斜杠命令" hint="例如 /review">
                      <Input
                        className="font-mono"
                        value={templateCommand}
                        onChange={(event) => setTemplateCommand(event.target.value)}
                        placeholder="/review"
                      />
                    </SettingsField>
                    <SettingsField label="模板内容" span="full">
                      <Textarea
                        className="min-h-28"
                        value={templateContent}
                        onChange={(event) => setTemplateContent(event.target.value)}
                        placeholder="请审查 {{project}} 在 {{date}} 的变更"
                      />
                    </SettingsField>
                  </SettingsFormGrid>
                  <Button
                    type="button"
                    className="mt-4"
                    disabled={
                      !templateName.trim() || !templateContent.trim() || saveTemplate.isPending
                    }
                    onClick={() => saveTemplate.mutate()}
                  >
                    <Plus className="size-4" />
                    保存模板
                  </Button>
                </SettingsCard>
              </>
            ) : null}

            {active.id === "account" ? (
              <SettingsCard title="当前账户" description="退出后需要重新登录才能访问工作区。">
                <SettingsFormGrid>
                  <SettingsInfoRow
                    label="用户名"
                    value={sessionQuery.data?.user?.username || "已登录"}
                  />
                  <SettingsInfoRow
                    label="角色"
                    value={sessionQuery.data?.user?.role === "admin" ? "管理员" : "用户"}
                  />
                </SettingsFormGrid>
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-6"
                  onClick={async () => {
                    await api("/api/auth/logout", { method: "POST" });
                    window.location.assign("/");
                  }}
                >
                  <LogOut className="size-4" />
                  退出登录
                </Button>
              </SettingsCard>
            ) : null}
          </div>
        </div>
      </div>
      <TaskBoardDialog
        open={taskBoardOpen}
        onOpenChange={setTaskBoardOpen}
        projectId={settingsProjectId}
        onOpenSession={(id) => navigate(workspacePath(settingsProjectId, id))}
      />
      <ApprovalAuditDialog
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        projectId={settingsProjectId || undefined}
        onOpenSession={(nextProjectId, nextSessionId) => {
          navigate(workspacePath(nextProjectId, nextSessionId));
        }}
      />
      <ProjectKnowledgeDialog
        open={knowledgeOpen}
        onOpenChange={setKnowledgeOpen}
        projectId={settingsProjectId}
      />
      <SkillsMcpDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        projectId={settingsProjectId}
        providers={providers}
      />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        projectId={settingsProjectId}
      />
      <ProviderDialog
        open={providerOpen}
        onOpenChange={setProviderOpen}
        providers={providers}
        onSelect={() => undefined}
        onDelete={async (id) => {
          const result = await api<{ ok: boolean }>(`/api/providers/${id}`, { method: "DELETE" });
          if (!result.ok) throw new Error("Provider 不存在或已删除");
          await queryClient.invalidateQueries({ queryKey: ["providers"] });
        }}
        onSave={async (body) => {
          await api(body.id ? `/api/providers/${body.id}` : "/api/providers", {
            method: body.id ? "PUT" : "POST",
            body: JSON.stringify(body)
          });
          await queryClient.invalidateQueries({ queryKey: ["providers"] });
        }}
        onRefresh={async () => {
          await queryClient.invalidateQueries({ queryKey: ["providers"] });
        }}
      />
    </div>
  );
}
