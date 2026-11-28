import type { Project } from "@/types";
import {
  ATTACHMENT_UPLOAD_DIR,
  safeAttachmentName,
  type ComposerAttachment,
  type QueuedAttachmentMeta
} from "./composer-attachments";
import type { HtmlCompanions } from "./preview-html-assets";
import {
  fileDownloadUrl,
  fileName,
  fileTextUrl,
  isFilesystemAbsolutePath,
  mediaUrl,
  previewKindFor,
  resolveOpenableFilePath
} from "./file-workspace";
import { parseProjectFileHref } from "./markdown-refs";

export type PreviewProject = Pick<Project, "id" | "realPath" | "displayPath">;
export type ChatResource = {
  kind: "image" | "html" | "web" | "text" | "audio" | "video" | "pdf" | "binary";
  title: string;
  src?: string;
  textUrl?: string;
  content?: string;
  line?: number | null;
  download?: string;
  blob?: Blob;
  files?: HtmlCompanions;
};

function localResource(projectId: string, path: string, line: number | null): ChatResource {
  const kind = /\.html?$/i.test(path) ? "html" : previewKindFor(path, true);
  return {
    kind: kind === "markdown" ? "text" : kind,
    title: path,
    line,
    src: mediaUrl(projectId, path),
    textUrl: fileTextUrl(projectId, path),
    download: fileDownloadUrl(projectId, path)
  };
}

export function chatFileResource(
  path: string,
  line: number | null,
  project?: PreviewProject,
  attachments?: QueuedAttachmentMeta[]
) {
  const resolved = resolveOpenableFilePath(path, project?.realPath, project?.displayPath);
  if (!resolved || (!resolved.external && !project?.id)) return null;
  const resource = localResource(project?.id ?? "", resolved.path, line ?? resolved.line);
  const dir = `${ATTACHMENT_UPLOAD_DIR}/`;
  if (resource.kind === "html" && attachments && resolved.path.startsWith(dir)) {
    const files = new Map<string, string>();
    for (const item of attachments) {
      const saved = resolveOpenableFilePath(
        item.path,
        project?.realPath,
        project?.displayPath
      )?.path;
      if (!saved || item.path === path || /[/\\]/.test(item.name)) continue;
      const name = fileName(saved);
      if (saved === dir + name && name.replace(/^\d+-/, "") === safeAttachmentName(item.name))
        files.set(dir + item.name, name);
    }
    if (files.size) resource.files = files;
  }
  return resource;
}

export function chatLinkResource(href: string, project?: PreviewProject): ChatResource | null {
  const origin = globalThis.location?.origin ?? "https://localhost";
  if (/^(?:https?:\/\/|\/\/|\/api\/)/i.test(href)) {
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (url.origin === origin) {
      const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/download$/);
      const path = url.searchParams.get("path");
      if (
        path &&
        (match?.[1]
          ? !isFilesystemAbsolutePath(path)
          : url.pathname === "/api/filesystem/file/download" && isFilesystemAbsolutePath(path))
      ) {
        return localResource(match?.[1] ?? "", path, null);
      }
    }
    const kind = previewKindFor(url.pathname);
    return {
      kind: kind === "image" || kind === "audio" || kind === "video" ? kind : "web",
      title: kind === "image" ? fileName(url.pathname) : url.host,
      src: url.href
    };
  }
  const file = parseProjectFileHref(href);
  return file && chatFileResource(file.path, file.line, project);
}

export function chatImageSource(href: string, project?: PreviewProject) {
  if (/^data:image\/(?:png|apng|jpeg|gif|webp|avif);base64,/i.test(href)) return href;
  return chatLinkResource(href, project)?.src;
}

export function draftResource(
  item: ComposerAttachment,
  project?: PreviewProject,
  siblings: ComposerAttachment[] = []
): ChatResource | null {
  if (item.existingPath) return chatFileResource(item.existingPath, null, project);
  if (item.previewUrl && item.kind === "image") {
    return { kind: "image", title: item.name, src: item.previewUrl };
  }
  if (item.text !== undefined) {
    const html = /\.html?$/i.test(item.name) || item.mime.split(";")[0] === "text/html";
    const files = html
      ? new Map(
          siblings
            .filter((file) => file.id !== item.id && !file.existingPath)
            .map((file) => [file.name, file.bytes])
        )
      : null;
    return {
      kind: html ? "html" : "text",
      title: item.name,
      content: item.text,
      ...(files?.size ? { files } : {})
    };
  }
  const kind = previewKindFor(item.name);
  return {
    kind: kind === "markdown" ? "binary" : kind,
    title: item.name,
    blob: new Blob([new Uint8Array(item.bytes)], { type: item.mime })
  };
}
