import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function SettingsCard({
  title,
  description,
  actions,
  children,
  className
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("shadow-none", className)}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}

export function SettingsFormGrid({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-x-5 gap-y-6 lg:grid-cols-2",
        "lg:[&>[data-settings-span=full]]:col-span-2",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SettingsField({
  label,
  hint,
  span,
  className,
  children
}: {
  label: string;
  hint?: string;
  span?: "full";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-settings-span={span} className={cn("grid min-w-0 gap-1.5", className)}>
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SettingsSelect<T extends string>({
  label,
  hint,
  value,
  onValueChange,
  options
}: {
  label: string;
  hint?: string;
  value: T;
  onValueChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <SettingsField label={label} {...(hint ? { hint } : {})}>
      <Select value={value} onValueChange={(next) => onValueChange(next as T)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsField>
  );
}

export function SettingsSwitchField({
  label,
  description,
  checked,
  onCheckedChange
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      data-settings-span="full"
      className="flex min-w-0 items-center justify-between gap-4 py-2.5"
    >
      <div className="min-w-0 space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        {description ? (
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

export function SettingsInfoRow({
  icon: Icon,
  label,
  value
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <p className="flex min-w-0 items-start gap-2 text-sm leading-6">
        {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
        <span className="min-w-0 break-all text-foreground">{value}</span>
      </p>
    </div>
  );
}

export function SettingsProjectSelect({
  projects,
  value,
  onValueChange
}: {
  projects: Array<{ id: string; name: string }>;
  value: string;
  onValueChange: (value: string) => void;
}) {
  if (!projects.length) {
    return <p className="text-sm text-muted-foreground">还没有工程，请先在工作台打开一个项目。</p>;
  }
  if (!value) {
    return <p className="text-sm text-muted-foreground">正在读取工程…</p>;
  }
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full max-w-sm">
        <SelectValue placeholder="选择工程" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SettingsUsageBar({
  label,
  detail,
  value
}: {
  label: string;
  detail: string;
  value: number;
}) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="min-w-0 break-all text-sm leading-6 text-foreground">{detail}</p>
    </div>
  );
}
