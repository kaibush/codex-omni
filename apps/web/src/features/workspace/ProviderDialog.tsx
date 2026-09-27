import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClientIcon } from "@/components/ClientIcon";
import {
  CLIENTS,
  clientName,
  clientType,
  modelRuntimeSettingsSchema,
  type ClientType
} from "@codex-omni/protocol";
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { Provider, ProviderHomeMode } from "@/types";
import { ProviderRuntimeFields } from "./ProviderRuntimeFields";
import {
  defaultProviderTemplates,
  providerAuthKey,
  providerConfigValue,
  renderProviderTemplates,
  setProviderAuthKey,
  setProviderConfigValue
} from "./provider-templates";

type ProviderInput = Omit<Provider, "id" | "isDefault"> & { id?: string; isDefault?: boolean };

const empty: ProviderInput = {
  name: "新供应商",
  kind: "codex",
  model: "gpt-5",
  contextWindow: null,
  autoCompactTokenLimit: null,
  models: [],
  baseUrl: "https://api.openai.com/v1",
  apiKey: null,
  configToml: "",
  authJson: "",
  messageEnvVars: {},
  homeMode: "managed"
};

const homeModeLabel: Record<ProviderHomeMode, string> = {
  "api-key": "API Key",
  native: "客户端原生配置",
  managed: "运行配置"
};

const envText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

export function ProviderDialog({
  open,
  initialClient = "codex",
  onOpenChange,
  providers,
  onSave,
  onDelete,
  onSelect,
  onRefresh
}: {
  open: boolean;
  initialClient?: ClientType;
  onOpenChange: (v: boolean) => void;
  providers: Provider[];
  onSave: (v: ProviderInput) => Promise<Provider | void>;
  onDelete: (id: string) => Promise<void>;
  onSelect: (id: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  const [clientFilter, setClientFilter] = useState<ClientType>("codex");
  const [editing, setEditing] = useState<ProviderInput>(empty);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [envDraft, setEnvDraft] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [testNotice, setTestNotice] = useState("");
  const [testIsError, setTestIsError] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [secretLoading, setSecretLoading] = useState(false);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{ providerConfigTemplate?: string; providerAuthTemplate?: string }>("/api/settings"),
    enabled: open
  });
  const templates = {
    configToml: settingsQuery.data?.providerConfigTemplate || defaultProviderTemplates.configToml,
    authJson: settingsQuery.data?.providerAuthTemplate || defaultProviderTemplates.authJson
  };
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setClientFilter(initialClient);
    if (!open) {
      setFormOpen(false);
      setEditing(empty);
    }
  }, [open, initialClient]);
  const isClaude = editing.kind === "claude-code";
  const visibleProviders = providers.filter(
    (provider) => clientType(provider.kind) === clientFilter
  );
  const title = useMemo(() => (editing.id ? "编辑供应商" : "新增供应商"), [editing.id]);
  const begin = (provider?: Provider) => {
    const next = provider
      ? { ...provider, homeMode: provider.homeMode ?? "managed" }
      : clientFilter === "claude-code"
        ? {
            ...empty,
            kind: "claude-code",
            name: "Claude 供应商",
            homeMode: "api-key" as const,
            model: "sonnet",
            models: ["sonnet", "opus", "haiku"],
            baseUrl: "https://api.anthropic.com",
            configToml: null,
            authJson: null,
            settingsJson: "{}",
            mcpServersJson: "{}"
          }
        : {
            ...empty,
            ...renderProviderTemplates(templates, {
              name: empty.name,
              model: empty.model ?? "",
              baseUrl: empty.baseUrl ?? "",
              apiKey: ""
            })
          };
    setEditing(next);
    setEnvDraft(envText(next.messageEnvVars));
    setError("");
    setShowSecrets(false);
    setModelQuery("");
    setTestNotice("");
    setTestIsError(false);
    setManualModel("");
    setFormOpen(true);
    if (provider && provider.homeMode !== "native") {
      setSecretLoading(true);
      void api<{ apiKey: string | null; authJson: string | null; configToml: string | null }>(
        `/api/providers/${provider.id}/export`
      )
        .then((exported) => {
          setEditing((current) =>
            current.id === provider.id
              ? {
                  ...current,
                  apiKey: provider.homeMode === "api-key" ? exported.apiKey : null,
                  authJson: exported.authJson,
                  configToml: exported.configToml ?? current.configToml
                }
              : current
          );
        })
        .catch((reason) => {
          setError(reason instanceof Error ? reason.message : "读取供应商配置失败");
        })
        .finally(() => setSecretLoading(false));
    } else setSecretLoading(false);
  };
  const exportProvider = async (id: string, name: string) => {
    const data = await api<Record<string, unknown>>(`/api/providers/${id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name || "provider"}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const importProvider = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      await api("/api/providers/import", { method: "POST", body: JSON.stringify(parsed) });
      toast.success("已导入供应商");
      await onRefresh?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    }
  };
  const fetchModels = async (saved: ProviderInput) => {
    const result = await api<{
      ok: boolean;
      durationMs: number;
      models: string[];
      error?: string;
    }>(`/api/providers/${saved.id}/test`, { method: "POST" });
    const models = result.models ?? [];
    setTestIsError(!result.ok);
    setTestNotice(
      result.ok
        ? `连接成功 · ${result.durationMs} ms · 同步 ${models.length} 个模型`
        : `连接失败 · ${result.error || "上游没有返回模型"}。手动模型目录已保留。`
    );
    if (models.length) {
      const merged = [...new Set([...(saved.models ?? []), ...models])];
      await onSave({ ...saved, models: merged });
      await onRefresh?.();
      setEditing((value) => ({ ...value, models: merged }));
    }
    toast[result.ok ? "success" : "error"](
      result.ok
        ? `连接成功，获取 ${models.length} 个模型`
        : `连接失败：${result.error || "上游没有返回模型"}`
    );
    return result;
  };
  const submit = async (fetchAfterSave = false) => {
    const name = editing.name?.trim();
    if (!name) return setError("供应商名称为必填项");
    const runtimeSettings = modelRuntimeSettingsSchema.safeParse(editing);
    if (!runtimeSettings.success)
      return setError(runtimeSettings.error.issues[0]?.message ?? "模型运行参数无效");
    const homeMode: ProviderHomeMode = editing.homeMode ?? "managed";
    if (isClaude) {
      for (const [label, value] of [
        ["settings.json", editing.settingsJson],
        ["MCP", editing.mcpServersJson]
      ]) {
        try {
          const parsed = JSON.parse(value || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        } catch {
          return setError(`${label} 必须是 JSON 对象`);
        }
      }
    } else if (homeMode === "api-key") {
      const key = editing.apiKey?.trim();
      if (!key || (key === "••••••••" && !editing.id)) return setError("API Key 为必填项");
    } else if (homeMode === "managed") {
      if (secretLoading) return setError("正在读取 auth.json，请稍候");
      if (!editing.configToml?.trim()) return setError("config.toml 为必填项");
      if (!editing.authJson?.trim()) return setError("auth.json 为必填项");
      if (editing.authJson && editing.authJson !== "configured") {
        try {
          JSON.parse(editing.authJson);
        } catch {
          return setError("auth.json 必须是有效的 JSON");
        }
      }
    }
    const messageEnvVars: Record<string, string> = {};
    for (const line of envDraft.split("\n")) {
      const value = line.trim();
      if (!value) continue;
      const separator = value.indexOf("=");
      if (separator <= 0) return setError(`环境变量格式错误：${value}，应为 KEY=VALUE`);
      const key = value.slice(0, separator).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return setError(`环境变量名称无效：${key}`);
      messageEnvVars[key] = value.slice(separator + 1);
    }
    setBusy(true);
    try {
      const payload: ProviderInput = {
        ...editing,
        name,
        models: editing.models ?? [],
        homeMode,
        messageEnvVars
      };
      const saved = await onSave(payload);
      if (fetchAfterSave) {
        if (!saved?.id) throw new Error("供应商已保存，但无法获取供应商 ID");
        // publicProvider intentionally masks auth.json; keep the editable
        // values from the form when persisting the fetched model catalog.
        const latest = { ...payload, id: saved.id, homeMode };
        setEditing(latest);
        await fetchModels(latest);
      } else {
        toast.success(editing.id ? "供应商已更新" : "供应商已保存");
        setFormOpen(false);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存供应商失败");
      if (fetchAfterSave) {
        setTestIsError(true);
        setTestNotice(error instanceof Error ? `同步失败 · ${error.message}` : "同步失败");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(calc(100vw-1rem),68rem)] min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden sm:max-w-[calc(100vw-2rem)]"
        style={{ overflow: "hidden" }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2">
              <KeyRound /> 供应商管理
            </DialogTitle>
            <DialogDescription className="mt-1">
              分别管理 Codex 和 Claude Code 的供应商、默认模型与凭据。点名称切换当前对话配置。
            </DialogDescription>
          </div>
          <DialogClose
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X className="size-4" />
          </DialogClose>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="mr-auto flex gap-1 rounded-lg border p-1" aria-label="供应商客户端">
            {CLIENTS.map((client) => (
              <button
                key={client.id}
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm ${clientFilter === client.id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}
                aria-pressed={clientFilter === client.id}
                onClick={() => setClientFilter(client.id)}
              >
                <ClientIcon client={client.id} />
                {client.name}
                <span className="text-xs text-muted-foreground">
                  {providers.filter((provider) => clientType(provider.kind) === client.id).length}
                </span>
              </button>
            ))}
          </div>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importProvider(file);
            }}
          />
          <Button
            variant="outline"
            className="h-8 flex-1 rounded-lg sm:flex-none"
            onClick={() => importRef.current?.click()}
          >
            <FileUp className="size-4" /> 导入
          </Button>
          <Button className="h-8 flex-1 rounded-lg sm:flex-none" onClick={() => begin()}>
            <Plus className="size-4" /> 新增供应商
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
          {visibleProviders.map((provider) => {
            const mode = homeModeLabel[provider.homeMode ?? "managed"];
            const envCount = Object.keys(provider.messageEnvVars ?? {}).length;
            return (
              <article key={provider.id} className="rounded-lg border p-3">
                <button
                  type="button"
                  className="block w-full min-w-0 text-left"
                  onClick={() => onSelect(provider.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ClientIcon client={clientType(provider.kind)} />
                    <span className="line-clamp-2 min-w-0 flex-1 break-all text-sm font-medium">
                      {provider.name}
                    </span>
                    {provider.isDefault ? (
                      <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-lg bg-muted px-1.5 text-[11px] text-muted-foreground">
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                        默认
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {clientName(provider.kind)} · {provider.model || "客户端默认"} ·{" "}
                    {provider.baseUrl || "本地登录"}
                  </span>
                  {provider.runtimeHome ? (
                    <span
                      className="mt-1 block truncate font-mono text-[11px] text-muted-foreground"
                      title={provider.runtimeHome}
                    >
                      {provider.runtimeHome}
                    </span>
                  ) : null}
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {mode} · 环境变量 {envCount} 项
                  </span>
                </button>
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
                  {!provider.isDefault ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 w-full rounded-lg px-2 text-xs sm:w-auto"
                      onClick={() => onSave({ ...provider, isDefault: true })}
                    >
                      <Star className="size-3.5" /> 默认
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-full rounded-lg px-2 text-xs sm:w-auto"
                    onClick={async () => {
                      try {
                        await api(`/api/providers/${provider.id}/clone`, { method: "POST" });
                        toast.success("已复制供应商");
                        await onRefresh?.();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "复制失败");
                      }
                    }}
                  >
                    <Copy className="size-3.5" /> 复制
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-full rounded-lg px-2 text-xs sm:w-auto"
                    onClick={() => void exportProvider(provider.id, provider.name)}
                  >
                    <Download className="size-3.5" /> 导出
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-full rounded-lg px-2 text-xs sm:w-auto"
                    onClick={async () => {
                      try {
                        const result = await api<{
                          ok: boolean;
                          durationMs: number;
                          models: string[];
                          error?: string;
                        }>(`/api/providers/${provider.id}/test`, { method: "POST" });
                        toast[result.ok ? "success" : "error"](
                          result.ok
                            ? `连接成功 · ${result.durationMs}ms · 获取 ${result.models.length} 个模型`
                            : `连接失败 · ${result.error || "上游没有返回模型"}`
                        );
                        if (result.models.length) await onRefresh?.();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "测试失败");
                      }
                    }}
                  >
                    <RefreshCw className="size-3.5" /> 测试
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-full rounded-lg px-2 text-xs sm:w-auto"
                    onClick={() => begin(provider)}
                  >
                    <Pencil className="size-3.5" /> 编辑
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-8 w-full rounded-lg px-2 text-xs sm:w-auto"
                    disabled={deletingId === provider.id}
                    onClick={async () => {
                      if (!confirm(`删除 Provider「${provider.name}」？`)) return;
                      setDeletingId(provider.id);
                      try {
                        await onDelete(provider.id);
                        if (editing.id === provider.id) {
                          setEditing(empty);
                          setFormOpen(false);
                        }
                      } finally {
                        setDeletingId(null);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" /> 删除
                  </Button>
                </div>
              </article>
            );
          })}
          {!visibleProviders.length ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              还没有配置供应商，请点击“新增供应商”。
            </p>
          ) : null}
        </div>
      </DialogContent>
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-[min(calc(100vw-1rem),68rem)] min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden sm:max-w-[calc(100vw-2rem)]"
          style={{ overflow: "hidden" }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">
                {isClaude
                  ? "使用 Anthropic Messages 兼容供应商，或复用服务器上的 Claude Code 登录。供应商参数按运行隔离，会话保存在客户端固定目录。"
                  : "填写 Codex 配置、模型和密钥后保存；支持同步上游模型或手动维护模型目录。"}
              </DialogDescription>
            </div>
            <DialogClose
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="关闭"
            >
              <X className="size-4" />
            </DialogClose>
          </div>
          <form
            className="provider-form grid min-h-0 min-w-0 max-w-full flex-1 gap-3 overflow-y-auto overscroll-contain sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="field-label sm:col-span-2">
              客户端
              <span className="relative mt-1.5 block">
                <ClientIcon
                  client={clientType(editing.kind)}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                />
                <select
                  className="field field-client-select h-8 rounded-lg"
                  value={editing.kind}
                  disabled={Boolean(editing.id)}
                  onChange={(event) => {
                    const kind = event.target.value;
                    setEditing(
                      kind === "claude-code"
                        ? {
                            ...empty,
                            kind,
                            name: "Claude 供应商",
                            homeMode: "api-key",
                            model: "sonnet",
                            models: ["sonnet", "opus", "haiku"],
                            baseUrl: "https://api.anthropic.com",
                            configToml: null,
                            authJson: null,
                            settingsJson: "{}",
                            mcpServersJson: "{}"
                          }
                        : {
                            ...empty,
                            ...renderProviderTemplates(templates, {
                              name: empty.name,
                              model: empty.model ?? "",
                              baseUrl: empty.baseUrl ?? "",
                              apiKey: ""
                            })
                          }
                    );
                    setEnvDraft("");
                  }}
                >
                  {CLIENTS.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["managed", isClaude ? "运行设置 / 环境变量" : "运行配置"],
                    ["api-key", "快速 API Key"],
                    ["native", "客户端原生配置"]
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`h-8 rounded-lg border px-3 text-xs ${editing.homeMode === mode ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                    onClick={() => setEditing({ ...editing, homeMode: mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {editing.homeMode === "native"
                  ? "使用该客户端固定目录中的登录和原生配置。供应商切换不会修改这些文件。"
                  : "配置仅用于本次运行。不同对话可以同时使用不同供应商，共享该客户端的会话目录。"}
              </p>
              {editing.homeMode === "native" && editing.runtimeHome ? (
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {editing.runtimeHome}
                </p>
              ) : null}
            </div>
            <label className="field-label sm:col-span-2">
              供应商名称 <span className="text-red-500">*</span>
              <input
                className="field"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="例如：供应商 1"
              />
            </label>
            <label className="field-label">
              模型
              <input
                className="field"
                value={
                  !isClaude && editing.homeMode === "managed"
                    ? providerConfigValue(editing.configToml, "model")
                    : (editing.model ?? "")
                }
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    model: e.target.value || null,
                    configToml:
                      !isClaude && editing.homeMode === "managed"
                        ? setProviderConfigValue(editing.configToml ?? "", "model", e.target.value)
                        : editing.configToml
                  })
                }
                placeholder={isClaude ? "使用 Claude Code 默认值" : "留空使用 config.toml"}
              />
            </label>
            <label className="field-label">
              Base URL
              <input
                disabled={editing.homeMode === "native"}
                className="field"
                value={
                  !isClaude && editing.homeMode === "managed"
                    ? providerConfigValue(editing.configToml, "base_url")
                    : (editing.baseUrl ?? "")
                }
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    baseUrl: e.target.value || null,
                    configToml:
                      !isClaude && editing.homeMode === "managed"
                        ? setProviderConfigValue(
                            editing.configToml ?? "",
                            "base_url",
                            e.target.value
                          )
                        : editing.configToml
                  })
                }
                placeholder={isClaude ? "使用 Claude Code 默认值" : "留空使用 config.toml"}
              />
            </label>
            <label className="field-label">
              API Key{" "}
              {editing.homeMode === "api-key" || (!isClaude && editing.homeMode === "managed") ? (
                <span className="text-red-500">*</span>
              ) : null}
              <input
                className="field min-w-0 max-w-full font-mono"
                type={showSecrets ? "text" : "password"}
                name="apiKey"
                disabled={editing.homeMode === "native"}
                autoComplete="off"
                value={
                  !isClaude && editing.homeMode === "managed"
                    ? providerAuthKey(editing.authJson)
                    : (editing.apiKey ?? "")
                }
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    apiKey:
                      !isClaude && editing.homeMode === "managed" ? null : e.target.value || null,
                    authJson:
                      !isClaude && editing.homeMode === "managed"
                        ? setProviderAuthKey(editing.authJson ?? "", e.target.value)
                        : editing.authJson
                  })
                }
                placeholder={
                  editing.homeMode === "api-key"
                    ? editing.id
                      ? "•••••••• 表示保持原 Key"
                      : "填写 API Key"
                    : secretLoading
                      ? "正在读取 auth.json"
                      : editing.homeMode === "native"
                        ? "使用客户端登录状态"
                        : "填写后同步到运行配置"
                }
              />
            </label>
            <label className="field-label">
              自定义消息环境变量
              <textarea
                className="field min-h-24 font-mono text-xs"
                value={envDraft}
                onChange={(e) => setEnvDraft(e.target.value)}
                placeholder="KEY=VALUE，每行一个"
              />
            </label>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  const next = !showSecrets;
                  setShowSecrets(next);
                  if (next && editing.id) {
                    try {
                      const exported = await api<{
                        apiKey: string | null;
                        authJson: string | null;
                        configToml: string | null;
                      }>(`/api/providers/${editing.id}/export`);
                      setEditing((current) => ({
                        ...current,
                        apiKey: exported.apiKey,
                        authJson: exported.authJson,
                        configToml: exported.configToml ?? current.configToml
                      }));
                    } catch (error) {
                      setError(error instanceof Error ? error.message : "无法显示敏感字段");
                    }
                  }
                }}
              >
                {showSecrets ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {showSecrets ? "隐藏敏感字段" : "显示敏感字段"}
              </Button>
              {editing.id ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void submit(true)}>
                  <RefreshCw className="size-4" /> 测试连接 / 拉取模型
                </Button>
              ) : null}
              {testNotice ? (
                <span
                  className={`text-xs ${testIsError ? "text-red-600" : "text-muted-foreground"}`}
                >
                  {testNotice}
                </span>
              ) : null}
            </div>
            <div className="field-label sm:col-span-2">
              模型目录（可手动添加）
              <div className="flex gap-2">
                <input
                  className="field mt-0"
                  value={manualModel}
                  onChange={(event) => setManualModel(event.target.value)}
                  placeholder={
                    isClaude ? "Claude 模型 ID 或 sonnet / opus / haiku" : "例如：gpt-5-codex"
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const model = manualModel.trim();
                    if (!model || editing.models?.includes(model)) return;
                    setEditing((value) => ({
                      ...value,
                      models: [...(value.models ?? []), model],
                      model: value.model || model,
                      configToml:
                        !isClaude &&
                        value.homeMode === "managed" &&
                        !providerConfigValue(value.configToml, "model")
                          ? setProviderConfigValue(value.configToml ?? "", "model", model)
                          : value.configToml
                    }));
                    setManualModel("");
                  }}
                >
                  添加
                </Button>
              </div>
              <input
                className="field mt-2"
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder="筛选已添加的模型"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(editing.models ?? [])
                  .filter((item) => item.toLowerCase().includes(modelQuery.trim().toLowerCase()))
                  .map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setEditing((value) => ({
                            ...value,
                            model: item,
                            configToml:
                              !isClaude && value.homeMode === "managed"
                                ? setProviderConfigValue(value.configToml ?? "", "model", item)
                                : value.configToml
                          }))
                        }
                      >
                        {item}
                        {editing.model === item ? " · 默认" : ""}
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setEditing((value) => {
                            const models = (value.models ?? []).filter((model) => model !== item);
                            const nextModel =
                              value.model === item ? (models[0] ?? "") : (value.model ?? "");
                            return {
                              ...value,
                              models,
                              model: nextModel || null,
                              configToml:
                                !isClaude && value.model === item && value.homeMode === "managed"
                                  ? setProviderConfigValue(
                                      value.configToml ?? "",
                                      "model",
                                      nextModel
                                    )
                                  : value.configToml
                            };
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            </div>
            {isClaude && editing.homeMode !== "native" ? (
              <details className="rounded-lg border p-3 sm:col-span-2">
                <summary className="cursor-pointer text-sm font-medium">
                  Claude 原生设置、Hooks 与 MCP
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  自动读取项目的 CLAUDE.md、.claude/skills、.claude/agents 与
                  .mcp.json。以下设置仅作用于此供应商。
                </p>
                <label className="field-label mt-3">
                  settings.json
                  <textarea
                    className="field min-h-36 font-mono text-xs"
                    value={editing.settingsJson ?? "{}"}
                    onChange={(event) =>
                      setEditing({ ...editing, settingsJson: event.target.value })
                    }
                  />
                </label>
                <label className="field-label mt-3">
                  MCP 服务器 JSON
                  <textarea
                    className="field min-h-28 font-mono text-xs"
                    value={editing.mcpServersJson ?? "{}"}
                    onChange={(event) =>
                      setEditing({ ...editing, mcpServersJson: event.target.value })
                    }
                    placeholder={'{"my-server":{"command":"npx","args":["-y","my-mcp"]}}'}
                  />
                </label>
              </details>
            ) : null}
            {!isClaude && (
              <ProviderRuntimeFields
                value={editing}
                onChange={(patch) => setEditing((current) => ({ ...current, ...patch }))}
              />
            )}
            {!isClaude && (editing.homeMode ?? "api-key") === "managed" ? (
              <>
                <label className="field-label sm:col-span-2">
                  config.toml <span className="text-red-500">*</span>
                  <textarea
                    className="field min-h-36 font-mono text-xs"
                    value={editing.configToml ?? ""}
                    onChange={(e) => setEditing({ ...editing, configToml: e.target.value })}
                    placeholder="模板加载中，或填写 Codex 配置内容"
                  />
                </label>
                <label className="field-label sm:col-span-2">
                  auth.json <span className="text-red-500">*</span>
                  <textarea
                    className="field min-h-36 font-mono text-xs"
                    value={editing.authJson ?? ""}
                    onChange={(e) => setEditing({ ...editing, authJson: e.target.value })}
                    placeholder='例如：{"OPENAI_API_KEY":"sk-..."}'
                  />
                </label>
              </>
            ) : !isClaude && (editing.homeMode ?? "api-key") === "api-key" ? (
              <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                保存时会根据名称、模型、Base URL 和 API Key 自动生成该供应商的 config.toml 与
                auth.json 运行参数，仅注入当前进程，不改写客户端目录中的配置。
              </p>
            ) : editing.homeMode === "native" ? (
              <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                运行时使用该客户端固定目录中的配置和登录状态，会话目录始终保持不变。
              </p>
            ) : null}
            {error && (
              <p className="sm:col-span-2 mt-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="mt-1 grid grid-cols-1 gap-2 sm:col-span-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-8 w-full rounded-lg sm:w-auto"
                onClick={() => setFormOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" className="h-8 w-full rounded-lg sm:w-auto" disabled={busy}>
                {busy ? "保存中..." : "保存供应商"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-8 w-full rounded-lg sm:w-auto"
                disabled={busy}
                onClick={() => void submit(true)}
              >
                {busy ? "处理中..." : "保存并获取模型"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
