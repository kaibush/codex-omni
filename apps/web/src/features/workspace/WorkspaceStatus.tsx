import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Gauge,
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
import { parseContextUsage } from "@/lib/context-usage";
import { formatDateTime, formatMessageTime } from "@/lib/utils";
import { taskStatusLabel, type TaskStatus } from "@/lib/task-state";
import type { WorkspaceSettings } from "@/features/workspace/SettingsDialog";
import { RuntimeSettingsTabs } from "./RuntimeSettingsTabs";
import { placeRuntimeOptionsPanel } from "./runtime-options-layout";
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
  const contextUsage = parseContextUsage(state.usage);
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
      {contextUsage ? (
        <span
          className={
            contextUsage.percent >= 80
              ? "composer-summary-item text-amber-600"
              : "composer-summary-item"
          }
          title={contextUsage.title}
        >
          <Gauge className="size-3.5" />
          {contextUsage.label}
        </span>
      ) : null}
    </div>
  );
}

export function RuntimeOptionsPanel({
  settings,
  onChange,
  onClose,
  homePath,
  anchorRef
}: {
  settings: WorkspaceSettings;
  onChange: (settings: WorkspaceSettings) => Promise<void>;
  onClose: () => void;
  homePath?: string | undefined;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const sync = () => {
      const anchor = anchorRef.current;
      const layer = layerRef.current;
      if (!anchor || !layer) return;
      const rect = anchor.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      const viewport = { width: layerRect.width, height: layerRect.height };
      const panelHeight = panelRef.current?.offsetHeight;
      setBox(
        placeRuntimeOptionsPanel({
          anchor: {
            top: rect.top - layerRect.top,
            right: rect.right - layerRect.left,
            bottom: rect.bottom - layerRect.top,
            left: rect.left - layerRect.left,
            width: rect.width,
            height: rect.height
          },
          viewport,
          ...(panelHeight ? { panelHeight } : {}),
          narrow: viewport.width < 768
        })
      );
    };
    sync();
    const frame = window.requestAnimationFrame(sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    const panel = panelRef.current;
    const observer = typeof ResizeObserver !== "undefined" && panel ? new ResizeObserver(sync) : null;
    if (panel) observer?.observe(panel);
    return () => {
      window.cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      observer?.disconnect();
    };
  }, [anchorRef, settings]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest("[data-slot='select-content'], [data-radix-popper-content-wrapper]")
      ) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div ref={layerRef} className="runtime-options-layer">
      <div
        ref={panelRef}
        role="dialog"
        aria-label="运行设置"
        className="runtime-options-panel rounded-xl border border-border bg-popover p-3 shadow-2xl"
        style={{
          top: box?.top ?? 0,
          left: box?.left ?? 12,
          width: box?.width,
          maxHeight: box?.maxHeight,
          visibility: box ? "visible" : "hidden"
        }}
      >
        <div className="flex items-center justify-between">
          <b className="text-sm">运行设置</b>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onClose}>
            关闭
          </Button>
        </div>
        <RuntimeSettingsTabs
          compact
          settings={settings}
          onChange={(next) => void onChange(next)}
        />
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          修改后立即保存，并用于下一次发送。
        </p>
        {homePath ? (
          <p className="mt-2 truncate text-xs text-muted-foreground" title={homePath}>
            CODEX_HOME {homePath}
          </p>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
