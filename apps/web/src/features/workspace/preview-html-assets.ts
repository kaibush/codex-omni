import type { AssetKind } from "./preview-html-code";

export type HtmlCompanions = ReadonlyMap<string, Uint8Array | string>;

const VIRTUAL_ORIGIN = "https://preview.invalid";
const MAX_FILES = 48;
const MAX_BYTES = 16 * 1024 * 1024;
const MEDIA: Record<string, string> = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  vtt: "text/vtt"
};

function mimeFor(path: string, kind: AssetKind) {
  const ext = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (kind === "script" || kind === "module")
    return /^(?:js|mjs)$/.test(ext) ? "text/javascript" : undefined;
  if (kind === "style") return ext === "css" ? "text/css" : undefined;
  if (kind === "data" && ext === "json") return "application/json";
  return Object.hasOwn(MEDIA, ext) ? MEDIA[ext] : undefined;
}

export function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function previewAssets(
  media: string | undefined,
  signal: AbortSignal,
  files?: HtmlCompanions
) {
  const endpoint = media ? new URL(media, location.origin) : null;
  const filesystem = endpoint?.pathname === "/api/filesystem/file/download";
  const allowed =
    endpoint?.origin === location.origin &&
    (filesystem || /^\/api\/projects\/[^/]+\/files\/download$/.test(endpoint.pathname));
  const path = ((allowed && endpoint?.searchParams.get("path")) || "index.html").replaceAll(
    "\\",
    "/"
  );
  const entry = new URL(
    "/" + path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/"),
    VIRTUAL_ORIGIN
  );
  const directory = new URL(".", entry).pathname;
  const readCache = new Map<string, Uint8Array | null>();
  const missing = new Set<string>();
  const remote = new Set<string>();
  let remaining = MAX_BYTES;

  async function read(file: string) {
    signal.throwIfAborted();
    if (readCache.has(file)) return readCache.get(file);
    if (readCache.size >= MAX_FILES || remaining <= 0) return null;
    readCache.set(file, null);
    const companion = files?.get(file);
    let bytes = typeof companion === "string" ? undefined : companion;
    if (!bytes && endpoint && allowed) {
      const url = new URL(endpoint);
      if (typeof companion === "string" && (filesystem || !/^\d+-[^/\\]+$/.test(companion)))
        return null;
      const target =
        typeof companion === "string" ? file.slice(0, file.lastIndexOf("/") + 1) + companion : file;
      url.searchParams.set("path", target);
      const response = await fetch(url, { signal, credentials: "same-origin", redirect: "error" });
      const realPath = response.headers.get("x-file-path");
      if (
        !response.ok ||
        Number(response.headers.get("content-length")) > remaining ||
        ((filesystem || realPath !== null) &&
          (!realPath || decodeURIComponent(realPath).replaceAll("\\", "/") !== target))
      ) {
        await response.body?.cancel();
        return null;
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!bytes) return null;
    remaining -= bytes.byteLength;
    if (remaining < 0) return null;
    readCache.set(file, bytes);
    return bytes;
  }

  function locate(value: string, owner: URL, kind: AssetKind) {
    const url = new URL(value, owner);
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) {
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.hostname.includes("*") &&
        (remote.size < 16 || remote.has(url.origin)) &&
        url.hostname !== location.hostname &&
        url.origin !== VIRTUAL_ORIGIN
      ) {
        remote.add(url.origin);
        return { external: url.href } as const;
      }
      return null;
    }
    if (
      /^[/\\?]/.test(value) ||
      url.origin !== VIRTUAL_ORIGIN ||
      !url.pathname.startsWith(directory)
    )
      return null;
    const parts = url.pathname.slice(directory.length).split("/").map(decodeURIComponent);
    if (
      parts.some(
        (part) => !part || part.startsWith(".") || /[/\\]/.test(part) || part.includes("\0")
      )
    )
      return null;
    const file = path.slice(0, path.lastIndexOf("/") + 1) + parts.join("/");
    const mime = mimeFor(file, kind);
    return mime ? ({ file, mime, url } as const) : null;
  }

  return { entry, read, locate, missing, remote };
}
