import { Cpu, HardDrive, MemoryStick } from "lucide-react";
import { cn, formatDataSize } from "@/lib/utils";
import type { HostInfo } from "@/types";

export function HostResourceStatus({
  host,
  className
}: {
  host?: HostInfo | undefined;
  className?: string;
}) {
  if (!host) return null;
  const resources = [
    {
      label: "CPU",
      icon: Cpu,
      usage: host.cpu.usage,
      detail: `${host.cpu.cores} 核平均 · 1 秒采样 · ${host.cpu.model}`
    },
    {
      label: "内存",
      icon: MemoryStick,
      usage: host.memory.usage,
      detail: `${formatDataSize(host.memory.used, true)} / ${formatDataSize(host.memory.total, true)}`
    },
    {
      label: "存储",
      icon: HardDrive,
      usage: host.storage.usage,
      detail: `${formatDataSize(host.storage.used, true)} / ${formatDataSize(host.storage.total, true)}`
    }
  ];
  return (
    <div
      className={cn(
        "flex h-8 shrink-0 flex-nowrap items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums sm:gap-3 sm:text-[11px]",
        className
      )}
      aria-label="主机资源状态，每 30 秒刷新"
    >
      {resources.map(({ label, icon: Icon, usage, detail }) => (
        <span
          key={label}
          className="inline-flex shrink-0 items-center gap-0.5 sm:gap-1"
          title={`${label} ${usage}% · ${detail}`}
          aria-label={`${label} ${usage}% · ${detail}`}
        >
          <Icon className="size-3 shrink-0" aria-hidden="true" />
          <span>{usage}%</span>
        </span>
      ))}
    </div>
  );
}
