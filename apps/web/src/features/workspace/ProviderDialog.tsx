import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { modelRuntimeSettingsSchema } from "@codex-omni/protocol";
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
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { Provider, ProviderHomeMode } from "@/types";
import { ServerFolderPicker } from "./ServerFolderPicker";
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
  homeMode: "managed",
  codexHomePath: null
};

const homeModeLabel: Record<ProviderHomeMode, string> = {
  "api-key": "API Key",
  external: "已有目录",
  managed: "托管配置"
};

const envText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

export function ProviderDialog({
  open,
  onOpenChange,
  providers,
  onSave,
  onDelete,
  onSelect,
  onRefresh
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  providers: Provider[];
  onSave: (v: ProviderInput) => Promise<Provider | void>;
  onDelete: (id: string) => Promise<void>;
  onSelect: (id: string) => void;
  onRefresh?: () => Promise<void>;
}) {
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
  const [folderOpen, setFolderOpen] = useState(false);
  const [secretLoading, setSecretLoading] = useState(false);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ providerConfigTemplate?: string; providerAuthTemplate?: string }>("/api/settings"),
    enabled: open
  });
  const templates = {
    configToml: settingsQuery.data?.providerConfigTemplate || defaultProviderTemplates.configToml,
    authJson: settingsQuery.data?.providerAuthTemplate || defaultProviderTemplates.authJson
  };
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) {
      setFormOpen(false);
      setEditing(empty);
    }
  }, [open]);
  const title = useMemo(() => (editing.id ? "编辑供应商" : "新增供应商"), [editing.id]);
  const begin = (provider?: Provider) => {
    const next = provider
      ? { ...provider, homeMode: provider.homeMode ?? "managed" }
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
    if (provider && provider.homeMode !== "external") {
      setSecretLoading(true);
      void api<{ apiKey: string | null; authJson: string | null; configToml: string | null }>(
        `/api/providers/${provider.id}/export`
      ).then((exported) => {
        setEditing((current) => current.id === provider.id ? {
          ...current,
          apiKey: provider.homeMode === "api-key" ? exported.apiKey : null,
          authJson: exported.authJson,
          configToml: exported.configToml ?? current.configToml
        } : current);
      }).catch((reason) => {
        setError(reason instanceof Error ? reason.message : "读取供应商配置失败");
      }).finally(() => setSecretLoading(false));
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
    toast[result.ok ? "success" : "error"](result.ok
      ? `连接成功，获取 ${models.length} 个模型`
      : `连接失败：${result.error || "上游没有返回模型"}`);
    return result;
  };
  const submit = async (fetchAfterSave = false) => {
    const name = editing.name?.trim();
    if (!name) return setError("供应商名称为必填项");
    const runtimeSettings = modelRuntimeSettingsSchema.safeParse(editing);
    if (!runtimeSettings.success) return setError(runtimeSettings.error.issues[0]?.message ?? "模型运行参数无效");
    const homeMode: ProviderHomeMode = editing.homeMode ?? "managed";
    if (homeMode === "api-key") {
      const key = editing.apiKey?.trim();
      if (!key || (key === "••••••••" && !editing.id)) return setError("API Key 为必填项");
    } else if (homeMode === "external") {
      if (!editing.codexHomePath?.trim()) return setError("请填写已有 CODEX_HOME 路径");
    } else {
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
      const saved = await onSave({
        ...editing,
        name,
        models: editing.models ?? [],
        homeMode,
        messageEnvVars,
        codexHomePath: homeMode === "external" ? (editing.codexHomePath ?? null) : null
      });
      if (fetchAfterSave) {
        if (!saved?.id) throw new Error("供应商已保存，但无法获取供应商 ID");
        // publicProvider intentionally masks auth.json; keep the editable
        // values from the form when persisting the fetched model catalog.
        const latest = { ...editing, id: saved.id, homeMode };
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
      <DialogContent className="w-[min(calc(100vw-1rem),68rem)] min-w-0 max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto sm:max-w-[calc(100vw-2rem)]">
        <DialogTitle className="flex items-center gap-2 pr-8">
          <KeyRound /> Provider 管理
        </DialogTitle>
        <DialogDescription>
          管理 Codex 供应商配置。点名称可切换当前对话使用的供应商。
        </DialogDescription>
        <div className="mt-3 flex gap-2 sm:justify-end">
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
          <Button variant="outline" className="h-8 flex-1 rounded-lg sm:flex-none" onClick={() => importRef.current?.click()}>
            <FileUp className="size-4" /> 导入
          </Button>
          <Button className="h-8 flex-1 rounded-lg sm:flex-none" onClick={() => begin()}>
            <Plus className="size-4" /> 新增供应商
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {providers.map((provider) => {
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
                    {provider.model || "配置文件默认"} · {provider.baseUrl || "Codex 默认"}
                  </span>
                  {provider.codexHome ? (
                    <span
                      className="mt-1 block truncate font-mono text-[11px] text-muted-foreground"
                      title={provider.codexHome}
                    >
                      {provider.codexHome}
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
          {!providers.length ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              还没有配置供应商，请点击“新增供应商”。
            </p>
          ) : null}
        </div>
      </DialogContent>
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent
          className="w-[min(calc(100vw-1rem),68rem)] min-w-0 max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto sm:max-w-[calc(100vw-2rem)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription>
            新增供应商会填入 config.toml 和 auth.json 模板。修改模型、Base URL、密钥等必要值后即可保存，
            也可以保存并同步上游模型，或手动维护模型目录。
          </DialogDescription>
          <form
            className="provider-form mt-4 grid min-w-0 max-w-full gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {editing.homeMode === "external" ? (
              <div className="rounded-lg border p-3 sm:col-span-2">
                <p className="text-xs leading-5 text-muted-foreground">
                  这个供应商仍使用已有 CODEX_HOME。新供应商不再提供这种方式。
                </p>
                <label className="field-label mt-2">
                  已有 CODEX_HOME <span className="text-red-500">*</span>
                  <div className="flex min-w-0 gap-2">
                    <input
                      className="field mt-0 min-w-0 flex-1 font-mono"
                      value={editing.codexHomePath ?? ""}
                      onChange={(e) =>
                        setEditing({ ...editing, codexHomePath: e.target.value || null })
                      }
                      placeholder="/home/you/.codex"
                    />
                    <Button type="button" variant="outline" className="h-8 shrink-0 rounded-lg" onClick={() => setFolderOpen(true)}>
                      浏览
                    </Button>
                  </div>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-8 rounded-lg"
                  onClick={() => setEditing({ ...editing, homeMode: "managed", codexHomePath: null })}
                >
                  改为托管配置
                </Button>
              </div>
            ) : (
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold text-muted-foreground">配置方式</p>
                <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    className={`h-8 rounded-lg border px-2 text-left text-xs ${
                      editing.homeMode === "api-key"
                        ? "border-border text-muted-foreground hover:bg-muted"
                        : "border-primary bg-primary/10 text-foreground"
                    }`}
                    onClick={() => setEditing({ ...editing, homeMode: "managed" })}
                  >
                    编辑 config.toml / auth.json
                  </button>
                  <button
                    type="button"
                    className={`h-8 rounded-lg border px-2 text-left text-xs ${
                      editing.homeMode === "api-key"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                    onClick={() => setEditing({ ...editing, homeMode: "api-key" })}
                  >
                    快速 API Key
                  </button>
                </div>
              </div>
            )}
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
                value={editing.homeMode === "managed" ? providerConfigValue(editing.configToml, "model") : editing.model ?? ""}
                onChange={(e) => setEditing({
                  ...editing,
                  model: e.target.value || null,
                  configToml: editing.homeMode === "managed"
                    ? setProviderConfigValue(editing.configToml ?? "", "model", e.target.value)
                    : editing.configToml
                })}
                placeholder="留空使用 config.toml"
              />
            </label>
            <label className="field-label">
              Base URL
              <input
                className="field"
                value={editing.homeMode === "managed" ? providerConfigValue(editing.configToml, "base_url") : editing.baseUrl ?? ""}
                onChange={(e) => setEditing({
                  ...editing,
                  baseUrl: e.target.value || null,
                  configToml: editing.homeMode === "managed"
                    ? setProviderConfigValue(editing.configToml ?? "", "base_url", e.target.value)
                    : editing.configToml
                })}
                placeholder="留空使用 config.toml"
              />
            </label>
            <label className="field-label">
              API Key{" "}
              {editing.homeMode === "api-key" || editing.homeMode === "managed" ? (
                <span className="text-red-500">*</span>
              ) : null}
              <input
                className="field min-w-0 max-w-full font-mono"
                type={showSecrets ? "text" : "password"}
                name="apiKey"
                autoComplete="off"
                value={editing.homeMode === "managed" ? providerAuthKey(editing.authJson) : editing.apiKey ?? ""}
                onChange={(e) => setEditing({
                  ...editing,
                  apiKey: editing.homeMode === "managed" ? null : e.target.value || null,
                  authJson: editing.homeMode === "managed"
                    ? setProviderAuthKey(editing.authJson ?? "", e.target.value)
                    : editing.authJson
                })}
                placeholder={
                  editing.homeMode === "api-key"
                    ? editing.id
                      ? "•••••••• 表示保持原 Key"
                      : "填写 API Key"
                    : secretLoading ? "正在读取 auth.json" : "填写后同步到 auth.json"
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void submit(true)}
                >
                  <RefreshCw className="size-4" /> 测试连接 / 拉取模型
                </Button>
              ) : null}
              {testNotice ? (
                <span className={`text-xs ${testIsError ? "text-red-600" : "text-muted-foreground"}`}>{testNotice}</span>
              ) : null}
            </div>
            <div className="field-label sm:col-span-2">
              模型目录（可手动添加）
              <div className="flex gap-2">
                <input
                  className="field mt-0"
                  value={manualModel}
                  onChange={(event) => setManualModel(event.target.value)}
                  placeholder="例如：gpt-5-codex"
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
                      configToml: value.homeMode === "managed" && !providerConfigValue(value.configToml, "model")
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
                    <span key={item} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs">
                      <button type="button" onClick={() => setEditing((value) => ({
                        ...value,
                        model: item,
                        configToml: value.homeMode === "managed"
                          ? setProviderConfigValue(value.configToml ?? "", "model", item)
                          : value.configToml
                      }))}>
                        {item}{editing.model === item ? " · 默认" : ""}
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setEditing((value) => {
                          const models = (value.models ?? []).filter((model) => model !== item);
                          const nextModel = value.model === item ? (models[0] ?? "") : value.model ?? "";
                          return {
                            ...value,
                            models,
                            model: nextModel || null,
                            configToml: value.model === item && value.homeMode === "managed"
                              ? setProviderConfigValue(value.configToml ?? "", "model", nextModel)
                              : value.configToml
                          };
                        })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            </div>
            <ProviderRuntimeFields value={editing} onChange={(patch) => setEditing((current) => ({ ...current, ...patch }))} />
            {(editing.homeMode ?? "api-key") === "managed" ? (
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
            ) : (editing.homeMode ?? "api-key") === "api-key" ? (
              <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                保存时会根据名称、模型、Base URL 和 API Key 自动生成该供应商的 config.toml 与
                auth.json，并写入独立的 CODEX_HOME。
              </p>
            ) : (
              <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                运行时直接使用这个已有目录，不会覆盖其中的 config.toml / auth.json。
              </p>
            )}
            {error && (
              <p className="sm:col-span-2 mt-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="mt-1 grid grid-cols-1 gap-2 sm:col-span-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button type="button" variant="outline" className="h-8 w-full rounded-lg sm:w-auto" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" className="h-8 w-full rounded-lg sm:w-auto" disabled={busy}>
                {busy ? "保存中..." : "保存供应商"}
              </Button>
              <Button type="button" variant="secondary" className="h-8 w-full rounded-lg sm:w-auto" disabled={busy} onClick={() => void submit(true)}>
                {busy ? "处理中..." : "保存并获取模型"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ServerFolderPicker
        open={folderOpen}
        initialPath={editing.codexHomePath || ""}
        onOpenChange={setFolderOpen}
        onSelect={(path) => {
          setEditing((current) => ({ ...current, codexHomePath: path }));
          setFolderOpen(false);
        }}
      />
    </Dialog>
  );
}
