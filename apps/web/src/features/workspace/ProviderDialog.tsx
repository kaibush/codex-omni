import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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

type ProviderInput = Omit<Provider, "id" | "isDefault"> & { id?: string; isDefault?: boolean };

const empty: ProviderInput = {
  name: "",
  kind: "codex",
  model: null,
  models: [],
  baseUrl: null,
  apiKey: null,
  configToml: "",
  authJson: "",
  messageEnvVars: {},
  homeMode: "api-key",
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
  onSave: (v: ProviderInput) => Promise<void>;
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
  const [folderOpen, setFolderOpen] = useState(false);
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
      : { ...empty };
    setEditing(next);
    setEnvDraft(envText(next.messageEnvVars));
    setError("");
    setShowSecrets(false);
    setModelQuery("");
    setTestNotice("");
    setFormOpen(true);
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
  const submit = async () => {
    const name = editing.name?.trim();
    if (!name) return setError("供应商名称为必填项");
    const homeMode: ProviderHomeMode = editing.homeMode ?? (editing.id ? "managed" : "api-key");
    if (homeMode === "api-key") {
      const key = editing.apiKey?.trim();
      if (!key || (key === "••••••••" && !editing.id)) return setError("API Key 为必填项");
    } else if (homeMode === "external") {
      if (!editing.codexHomePath?.trim()) return setError("请填写已有 CODEX_HOME 路径");
    } else {
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
      await onSave({
        ...editing,
        name,
        homeMode,
        messageEnvVars,
        codexHomePath: homeMode === "external" ? (editing.codexHomePath ?? null) : null
      });
      setFormOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(96vw,980px)]">
        <DialogTitle className="flex items-center gap-2">
          <KeyRound /> Provider 管理
        </DialogTitle>
        <DialogDescription>
          管理 Codex 供应商配置；点击行可切换当前对话使用的供应商。
        </DialogDescription>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
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
          <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>
            <FileUp className="size-4" /> 导入
          </Button>
          <Button size="sm" onClick={() => begin()}>
            <Plus className="size-4" /> 新增供应商
          </Button>
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-3">供应商名称</th>
                <th className="px-3 py-3">模型</th>
                <th className="px-3 py-3">Base URL</th>
                <th className="px-3 py-3">模式</th>
                <th className="px-3 py-3">配置</th>
                <th className="px-3 py-3">环境变量</th>
                <th className="px-3 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {providers.map((provider) => (
                <tr key={provider.id} className="hover:bg-muted">
                  <td className="px-3 py-3 font-medium">
                    <button
                      className="text-left hover:text-primary"
                      onClick={() => onSelect(provider.id)}
                    >
                      {provider.name}
                    </button>
                    {provider.isDefault && (
                      <span className="provider-pill ml-2">
                        <Star className="mr-0.5 inline size-3" />
                        默认
                      </span>
                    )}
                    {provider.codexHome && (
                      <span
                        className="mt-1 block max-w-[18rem] truncate font-mono text-[10px] font-normal text-muted-foreground"
                        title={provider.codexHome}
                      >
                        {provider.codexHome}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {provider.model || "配置文件默认"}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-3 text-muted-foreground">
                    {provider.baseUrl || "Codex 默认"}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {homeModeLabel[provider.homeMode ?? "managed"]}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {provider.homeMode === "external"
                      ? provider.codexHomePath || provider.codexHome || "-"
                      : provider.configToml
                        ? "config.toml"
                        : "-"}
                    {provider.homeMode === "external"
                      ? ""
                      : ` / ${provider.authJson ? "auth.json" : "-"}`}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {Object.keys(provider.messageEnvVars ?? {}).length || 0} 项
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      {!provider.isDefault && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="设为默认"
                          onClick={() => onSave({ ...provider, isDefault: true })}
                        >
                          <Star className="size-4 text-muted-foreground" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="复制供应商"
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
                        <Copy className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="导出供应商"
                        onClick={() => void exportProvider(provider.id, provider.name)}
                      >
                        <Download className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="测试连接"
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
                                ? `可用 · ${result.durationMs}ms · ${result.models.length} 个模型`
                                : result.error || "不可用"
                            );
                            if (result.models.length) await onRefresh?.();
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "测试失败");
                          }
                        }}
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="编辑"
                        onClick={() => begin(provider)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="删除"
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
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!providers.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    还没有配置供应商，请点击“新增供应商”。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:w-[min(94vw,720px)]">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            新增供应商默认只需填写 API Key。也可以复用已有 CODEX_HOME，或继续手动托管 config.toml /
            auth.json。
          </DialogDescription>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="field-label sm:col-span-2">
              配置方式
              <select
                className="field"
                value={editing.homeMode ?? "api-key"}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    homeMode: event.target.value as ProviderHomeMode
                  })
                }
              >
                <option value="api-key">API Key（推荐）</option>
                <option value="external">复用已有 CODEX_HOME</option>
                <option value="managed">手动填写 config.toml / auth.json</option>
              </select>
            </label>
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
                value={editing.model ?? ""}
                onChange={(e) => setEditing({ ...editing, model: e.target.value || null })}
                placeholder="留空使用 config.toml"
              />
            </label>
            <label className="field-label">
              Base URL
              <input
                className="field"
                value={editing.baseUrl ?? ""}
                onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value || null })}
                placeholder="留空使用 config.toml"
              />
            </label>
            <label className="field-label">
              API Key{" "}
              {(editing.homeMode ?? "api-key") === "api-key" ? (
                <span className="text-red-500">*</span>
              ) : null}
              <input
                className="field font-mono"
                type={showSecrets ? "text" : "password"}
                name="apiKey"
                autoComplete="off"
                value={editing.apiKey ?? ""}
                onChange={(e) => setEditing({ ...editing, apiKey: e.target.value || null })}
                placeholder={
                  (editing.homeMode ?? "api-key") === "api-key"
                    ? editing.id
                      ? "•••••••• 表示保持原 Key"
                      : "填写 API Key"
                    : editing.id
                      ? "留空保持原 Key"
                      : "可留空，优先使用 auth.json"
                }
              />
            </label>
            {(editing.homeMode ?? "api-key") === "external" ? (
              <label className="field-label sm:col-span-2">
                已有 CODEX_HOME <span className="text-red-500">*</span>
                <div className="flex gap-2">
                  <input
                    className="field mt-0 font-mono"
                    value={editing.codexHomePath ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, codexHomePath: e.target.value || null })
                    }
                    placeholder="/home/you/.codex"
                  />
                  <Button type="button" variant="outline" onClick={() => setFolderOpen(true)}>
                    浏览
                  </Button>
                </div>
              </label>
            ) : null}
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
                  onClick={async () => {
                    try {
                      const result = await api<{
                        ok: boolean;
                        durationMs: number;
                        models: string[];
                        error?: string;
                      }>(`/api/providers/${editing.id}/test`, { method: "POST" });
                      const models = result.models ?? [];
                      setEditing((current) => ({ ...current, models }));
                      if (models.length) await onRefresh?.();
                      setTestNotice(
                        result.ok
                          ? `可用 · ${result.durationMs}ms · ${models.length} 个模型`
                          : result.error || "不可用"
                      );
                    } catch (error) {
                      setTestNotice(error instanceof Error ? error.message : "测试失败");
                    }
                  }}
                >
                  <RefreshCw className="size-4" /> 测试连接 / 拉取模型
                </Button>
              ) : null}
              {testNotice ? (
                <span className="text-xs text-muted-foreground">{testNotice}</span>
              ) : null}
            </div>
            {editing.models?.length ? (
              <label className="field-label sm:col-span-2">
                模型目录
                <input
                  className="field"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="搜索模型"
                />
                <select
                  className="field mt-2"
                  value={editing.model ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, model: event.target.value || null })
                  }
                >
                  <option value="">使用 config.toml 默认</option>
                  {editing.models
                    .filter((item) => item.toLowerCase().includes(modelQuery.trim().toLowerCase()))
                    .map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {(editing.homeMode ?? "api-key") === "managed" ? (
              <>
                <label className="field-label sm:col-span-2">
                  config.toml <span className="text-red-500">*</span>
                  <textarea
                    className="field min-h-36 font-mono text-xs"
                    value={editing.configToml ?? ""}
                    onChange={(e) => setEditing({ ...editing, configToml: e.target.value })}
                    placeholder="填写 Codex 配置内容"
                  />
                </label>
                <label className="field-label sm:col-span-2">
                  auth.json <span className="text-red-500">*</span>
                  <textarea
                    className="field min-h-36 font-mono text-xs"
                    value={editing.authJson ?? ""}
                    onChange={(e) => setEditing({ ...editing, authJson: e.target.value })}
                    placeholder='例如：{"OPENAI_API_KEY":"..."}'
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
            <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中..." : "保存供应商"}
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
