import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

export const MAX_BRAND_ICON_BYTES = 512 * 1024;
export const brandingQueryKey = ["branding"] as const;

const ICON_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml"
]);
const ICON_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg"];
const ICON_SELECTOR = 'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]';

export type Branding = {
  iconUrl: string | null;
  contentType: string | null;
  updatedAt: number | null;
};

export function emptyBranding(): Branding {
  return { iconUrl: null, contentType: null, updatedAt: null };
}

export function brandIconFileError(file: Pick<File, "name" | "type" | "size">) {
  if (file.size <= 0) return "图标文件是空的";
  if (file.size > MAX_BRAND_ICON_BYTES) return "图标不能超过 512 KB";
  const name = file.name.toLowerCase();
  const extensionOk = ICON_EXTENSIONS.some((extension) => name.endsWith(extension));
  const typeOk = Boolean(file.type && ICON_TYPES.has(file.type));
  if (!extensionOk && !typeOk) return "只支持 PNG、JPG、WEBP、GIF、ICO 或 SVG";
  return null;
}

export function normalizeBranding(value: unknown): Branding {
  if (!value || typeof value !== "object") return emptyBranding();
  const record = value as Record<string, unknown>;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : null;
  const claimed = typeof record.iconUrl === "string" ? record.iconUrl : "";
  if (updatedAt == null || !isBrandIconPath(claimed)) return emptyBranding();
  return {
    iconUrl: brandIconUrl(updatedAt),
    contentType: typeof record.contentType === "string" ? record.contentType : null,
    updatedAt
  };
}

function brandIconUrl(updatedAt: number) {
  return `/api/branding/icon?v=${updatedAt}`;
}

export async function fetchBranding(): Promise<Branding> {
  const response = await fetch("/api/branding", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalizeBranding(await response.json());
}

export function applyDocumentIcon(branding: Branding | null) {
  if (typeof document === "undefined") return;
  const iconUrl = normalizeBranding(branding).iconUrl;
  let links = [...document.head.querySelectorAll<HTMLLinkElement>(ICON_SELECTOR)];
  if (links.length === 0) {
    const created = document.createElement("link");
    created.rel = "icon";
    created.dataset.created = "true";
    document.head.append(created);
    links = [created];
  }
  for (const link of links) {
    if (!("defaultHref" in link.dataset)) {
      link.dataset.defaultHref = link.getAttribute("href") ?? "";
      link.dataset.defaultType = link.getAttribute("type") ?? "";
    }
    if (iconUrl) {
      link.setAttribute("href", iconUrl);
      if (branding?.contentType) link.setAttribute("type", branding.contentType);
      else link.removeAttribute("type");
      continue;
    }
    if (link.dataset.created === "true") {
      link.remove();
      continue;
    }
    if (link.dataset.defaultHref) link.setAttribute("href", link.dataset.defaultHref);
    else link.removeAttribute("href");
    if (link.dataset.defaultType) link.setAttribute("type", link.dataset.defaultType);
    else link.removeAttribute("type");
  }
}

export function useBrandIcon() {
  const query = useQuery({
    queryKey: brandingQueryKey,
    queryFn: fetchBranding,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false
  });
  useEffect(() => {
    if (query.data) applyDocumentIcon(query.data);
  }, [query.data]);
  return query;
}

function isBrandIconPath(value: string) {
  if (!value || value.startsWith("//") || value.includes("://") || value.includes("\\")) {
    return false;
  }
  const path = value.split("?")[0]?.split("#")[0] ?? "";
  return /^\/(?:[A-Za-z0-9_-]+\/)?api\/branding\/icon$/.test(path);
}
