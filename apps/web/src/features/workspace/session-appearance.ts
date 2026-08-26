import {
  BookOpen,
  Bug,
  MessageSquareText,
  Rocket,
  Star,
  TerminalSquare,
  type LucideIcon
} from "lucide-react";

export const SESSION_COLORS = [
  { id: "rose", swatch: "#f43f5e", className: "bg-rose-500" },
  { id: "amber", swatch: "#f59e0b", className: "bg-amber-500" },
  { id: "emerald", swatch: "#10b981", className: "bg-emerald-500" },
  { id: "sky", swatch: "#0ea5e9", className: "bg-sky-500" },
  { id: "violet", swatch: "#8b5cf6", className: "bg-violet-500" },
  { id: "zinc", swatch: "#71717a", className: "bg-zinc-500" }
] as const;

export const SESSION_ICONS: Array<{ id: string; icon: LucideIcon; label: string }> = [
  { id: "message", icon: MessageSquareText, label: "对话" },
  { id: "bug", icon: Bug, label: "缺陷" },
  { id: "rocket", icon: Rocket, label: "功能" },
  { id: "book", icon: BookOpen, label: "文档" },
  { id: "star", icon: Star, label: "重点" },
  { id: "terminal", icon: TerminalSquare, label: "终端" }
];

export function sessionColorClass(color?: string | null) {
  return SESSION_COLORS.find((item) => item.id === color)?.className ?? "";
}

export function sessionIcon(icon?: string | null) {
  return SESSION_ICONS.find((item) => item.id === icon)?.icon;
}
