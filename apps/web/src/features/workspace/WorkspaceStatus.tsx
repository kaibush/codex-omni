import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Lock,
  Pencil,
  Square,
  Unlock,
  WifiOff,
  Zap,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, formatMessageTime } from "@/lib/utils";
import { taskStatusLabel, type TaskStatus } from "@/lib/task-state";
import type { WorkspaceSettings } from "@/features/workspace/SettingsDialog";
import {
  formatDuration,
  formatTokens,
  type ConnectionState,
  type RunState
} from "./workspace-model";

export const sandboxMeta = (sandbox: WorkspaceSettings["sandbox"]) =>
  sandbox === "read-only"
    ? { icon: Lock, label: "只读" }
    : sandbox === "danger-full-access"
      ? { icon: Unlock, label: "完全访问" }
      : { icon: Pencil, label: "工作区可写" };

export function runStatusAppearance(status: TaskStatus) {
  if (status === "running")
    return { icon: LoaderCircle, iconClassName: "text-primary", label: "进行中", spin: true };
  if (status === "completed")
    return { icon: CheckCircle2, iconClassName: "text-emerald-500", label: "完成", spin: false };
  if (status === "cancelled")
    return { icon: Square, iconClassName: "text-muted-foreground", label: "已终止", spin: false };
  if (status === "interrupted")
    return { icon: WifiOff, iconClassName: "text-amber-600", label: "已中断", spin: false };
  return { icon: CircleAlert, iconClassName: "text-red-500", label: "异常", spin: false };
}

export function useNow(enabled: boolean, interval = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [enabled, interval]);
  return now;
}

export function LiveDuration({
  startedAt,
  endedAt
}: {
  startedAt: number;
  endedAt?: number | undefined;
}) {
  const now = useNow(endedAt == null);
  return <>{formatDuration((endedAt ?? now) - startedAt)}</>;
}

export function RunStatusBubble({
  state,
  connection,
  notice
}: {
  state: RunState;
  connection: ConnectionState;
  notice: string;
}) {
  const elapsed = <LiveDuration startedAt={state.startedAt} endedAt={state.endedAt} />;
  const firstResponse = state.firstResponseAt
    ? formatDuration(state.firstResponseAt - state.startedAt)
    : null;
  const appearance = state.reconnecting
    ? {
        icon: LoaderCircle,
        iconClassName: "text-amber-500",
        label: "重连中",
        spin: true
      }
    : runStatusAppearance(state.status);
  const Icon = appearance.icon;
  return (
    <article className="event-card event-card-bot compact">
      <header className="event-title min-w-0">
        <Bot className="size-4" />
        <span>Codex</span>
        <Icon
          className={`size-4 ${appearance.iconClassName}${appearance.spin ? " animate-spin" : ""}`}
        />
        <span className="text-xs font-medium text-muted-foreground">{appearance.label}</span>
        {state.startedAt ? (
          <time
            className="event-time ml-auto"
            dateTime={new Date(state.startedAt).toISOString()}
            title={formatDateTime(state.startedAt)}
          >
            {formatMessageTime(state.startedAt)}
          </time>
        ) : null}
      </header>
      <p className="text-sm leading-6 text-foreground">
        {state.reconnecting
          ? `Codex 流连接暂时中断，正在自动重连（${state.reconnecting.attempt}/${state.reconnecting.maxAttempts}）`
          : state.status === "running"
            ? connection !== "connected"
              ? notice || "任务进行中，正在恢复连接"
              : state.firstResponseAt
                ? "任务进行中，Codex 正在响应"
                : "任务进行中，等待 Codex 响应"
            : taskStatusLabel(state.status)}
      </p>
      {state.reconnecting?.reason ? (
        <p className="break-words text-xs text-muted-foreground">{state.reconnecting.reason}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        耗时 {elapsed}
        {firstResponse ? ` · 首响 ${firstResponse}` : ""}
      </p>
    </article>
  );
}

export function StatusChip({
  icon: Icon,
  title,
  label,
  onClick,
  iconClassName,
  className
}: {
  icon: LucideIcon;
  title: string;
  label?: string | undefined;
  onClick?: () => void;
  iconClassName?: string;
  className?: string | undefined;
}) {
  const chipClassName = className ? `composer-chip ${className}` : "composer-chip";
  const content = (
    <>
      <Icon className={`size-3.5 ${iconClassName ?? ""}`} />
      {label ? <span className="max-w-[7.5rem] truncate">{label}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={chipClassName}
        title={title}
        aria-label={title}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={chipClassName} title={title}>
      {content}
    </span>
  );
}

export function RunSummary({ state }: { state: RunState }) {
  const elapsed = formatDuration((state.endedAt ?? Date.now()) - state.startedAt);
  const firstResponse = state.firstResponseAt
    ? formatDuration(state.firstResponseAt - state.startedAt)
    : null;
  const usage = state.usage ?? {};
  const inputTokens = usage.input_tokens ?? usage.inputTokens;
  const outputTokens = usage.output_tokens ?? usage.outputTokens;
  const appearance = runStatusAppearance(state.status);
  const StatusIcon = appearance.icon;
  const inputLabel = inputTokens != null ? formatTokens(Number(inputTokens)) : null;
  const outputLabel = outputTokens != null ? formatTokens(Number(outputTokens)) : null;
  return (
    <div className="composer-summary">
      <span className="composer-summary-item" title={taskStatusLabel(state.status)}>
        <StatusIcon className={`size-3.5 ${appearance.iconClassName}`} />
        {appearance.label}
      </span>
      <span className="composer-summary-item" title={`本次耗时 ${elapsed}`}>
        <Clock3 className="size-3.5" />
        {elapsed}
      </span>
      {firstResponse ? (
        <span className="composer-summary-item" title={`首响 ${firstResponse}`}>
          <Zap className="size-3.5" />
          {firstResponse}
        </span>
      ) : null}
      {inputLabel ? (
        <span
          className="composer-summary-item"
          title={`输入 ${Number(inputTokens).toLocaleString()} tokens`}
        >
          <ArrowDownToLine className="size-3.5" />
          {inputLabel}
        </span>
      ) : null}
      {outputLabel ? (
        <span
          className="composer-summary-item"
          title={`输出 ${Number(outputTokens).toLocaleString()} tokens`}
        >
          <ArrowUpFromLine className="size-3.5" />
          {outputLabel}
        </span>
      ) : null}
    </div>
  );
}

export function RuntimeOptionsPanel({
  settings,
  onChange,
  onClose,
  homePath
}: {
  settings: WorkspaceSettings;
  onChange: (settings: WorkspaceSettings) => Promise<void>;
  onClose: () => void;
  homePath?: string | undefined;
}) {
  return (
    <div className="runtime-options-panel absolute bottom-12 right-0 z-40 w-[min(calc(100vw-1.5rem),22rem)] rounded-xl border border-border bg-popover p-3 shadow-2xl">
      <div className="flex items-center justify-between">
        <b className="text-sm">运行设置</b>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onClose}>
          关闭
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        <label className="field-label">
          执行方式
          <Select
            value={settings.executionMode}
            onValueChange={(value) =>
              void onChange({
                ...settings,
                executionMode: value as WorkspaceSettings["executionMode"]
              })
            }
          >
            <SelectTrigger className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="execute">Execute</SelectItem>
              <SelectItem value="plan">Plan</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="field-label">
          文件权限
          <Select
            value={settings.sandbox}
            onValueChange={(value) =>
              void onChange({
                ...settings,
                sandbox: value as WorkspaceSettings["sandbox"]
              })
            }
          >
            <SelectTrigger className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="read-only">只读</SelectItem>
              <SelectItem value="workspace-write">工作区可写</SelectItem>
              <SelectItem value="danger-full-access">完全访问</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="field-label">
          审批策略
          <Select
            value={settings.approvalPolicy}
            onValueChange={(value) =>
              void onChange({
                ...settings,
                approvalPolicy: value as WorkspaceSettings["approvalPolicy"]
              })
            }
          >
            <SelectTrigger className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="untrusted">建议模式</SelectItem>
              <SelectItem value="on-request">平衡模式（推荐）</SelectItem>
              <SelectItem value="never">全自动</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
        允许命令访问网络
        <Switch
          checked={settings.networkAccessEnabled}
          onCheckedChange={(checked) =>
            void onChange({ ...settings, networkAccessEnabled: checked })
          }
        />
      </label>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Plan 只做只读规划；平衡模式仅在需要提升权限时确认。修改后立即保存，并用于下一次发送。
      </p>
      {homePath ? (
        <p className="mt-2 truncate text-xs text-muted-foreground" title={homePath}>
          CODEX_HOME {homePath}
        </p>
      ) : null}
    </div>
  );
}
