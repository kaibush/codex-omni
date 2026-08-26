import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function createId() {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function")
    cryptoObj.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isScrolledToBottom(
  element: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 96
) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function formatDateTime(value?: number | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function formatCompactDateTime(value?: number | null) {
  if (!value) return "";
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("zh-CN", {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatMessageTime(value?: number | null) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }
  return formatCompactDateTime(value);
}

export function formatDataSize(bytes: number, compact = false) {
  const value = Math.max(0, bytes);
  const units = compact
    ? (["B", "K", "M", "G", "T"] as const)
    : (["B", "KB", "MB", "GB", "TB"] as const);
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(digits)}${compact && unit > 0 ? "" : " "}${units[unit]}`;
}

export function formatUptime(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}
