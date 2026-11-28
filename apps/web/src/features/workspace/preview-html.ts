const POLICY =
  "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data:; media-src data:; font-src data:; base-uri 'none'; form-action 'none'";
const MAX_ASSETS = 16;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function siblingAsset(path: string, reference: string) {
  if (!reference || /^(?:[\w+.-]+:|[/\\#?])/.test(reference)) return null;
  const base = new URL(
    path.split("/").map(encodeURIComponent).join("/"),
    "https://project.invalid/"
  );
  const asset = new URL(reference, base);
  const decoded = decodeURIComponent(asset.pathname);
  if (
    asset.origin !== base.origin ||
    !asset.pathname.startsWith(new URL(".", base).pathname) ||
    decoded.split(/[\\/]/).includes("..")
  )
    return null;
  return decoded.slice(1);
}

export async function previewHtml(content: string, media: string | undefined, signal: AbortSignal) {
  const doc = document.implementation.createHTMLDocument("");
  doc.documentElement.innerHTML = content;
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = POLICY;
  doc.head.prepend(policy);
  const endpoint = media ? new URL(media, location.origin) : null;
  const path = endpoint?.searchParams.get("path");
  if (
    path &&
    endpoint?.origin === location.origin &&
    /^\/api\/projects\/[^/]+\/files\/download$/.test(endpoint.pathname)
  ) {
    const cache = new Map<string, string>();
    let remaining = MAX_ASSET_BYTES;
    for (const element of doc.querySelectorAll(
      'img[src], link[rel="stylesheet"][href], script[src]'
    )) {
      signal.throwIfAborted();
      const attribute = element.tagName === "LINK" ? "href" : "src";
      const reference = element.getAttribute(attribute)?.trim() ?? "";
      try {
        const asset = siblingAsset(path, reference);
        const allowed =
          element.tagName === "LINK"
            ? /\.css$/i
            : element.tagName === "SCRIPT"
              ? /\.(?:js|mjs)$/i
              : /\.(?:png|apng|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
        if (!asset || !allowed.test(asset)) continue;
        if (!cache.has(asset)) {
          if (cache.size >= MAX_ASSETS || remaining <= 0) continue;
          cache.set(asset, "");
          endpoint.searchParams.set("path", asset);
          const response = await fetch(endpoint, {
            signal,
            credentials: "same-origin",
            redirect: "error"
          });
          if (!response.ok || Number(response.headers.get("content-length")) > remaining) {
            await response.body?.cancel();
            continue;
          }
          const blob = await response.blob();
          remaining -= blob.size;
          if (remaining >= 0) cache.set(asset, await dataUrl(blob));
        }
        const src = cache.get(asset);
        if (src) element.setAttribute(attribute, src);
      } catch {
        signal.throwIfAborted();
      }
    }
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
