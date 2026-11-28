import { dataUrl, previewAssets, type HtmlCompanions } from "./preview-html-assets";
import { rewriteReferences, type AssetKind } from "./preview-html-code";

export async function previewHtml(
  content: string,
  media: string | undefined,
  signal: AbortSignal,
  files?: HtmlCompanions
) {
  const doc = document.implementation.createHTMLDocument("");
  doc.documentElement.innerHTML = content;
  const assets = previewAssets(media, signal, files);
  const encoded = new Map<string, string>();
  const active = new Set<string>();
  const modules = new Map<string, string>();
  const imports: Record<string, string> = Object.create(null);
  let outputBudget = 48 * 1024 * 1024;

  function code(text: string, language: "css" | "js", owner: URL) {
    return rewriteReferences(text, language, (ref) =>
      embed(ref.value, ref.kind, ref.documentRelative ? assets.entry : owner)
    );
  }

  async function embed(reference: string, kind: AssetKind, owner = assets.entry): Promise<string> {
    signal.throwIfAborted();
    const value = reference.trim();
    if (!value || /^(?:#|data:|blob:)/i.test(value)) return reference;
    try {
      const asset = assets.locate(value, owner, kind);
      if (asset?.external) return asset.external;
      if (asset?.file) {
        const { file, mime, url } = asset;
        const key = `${kind}:${file}`;
        const knownModule = modules.get(file);
        if (kind === "module" && knownModule) return knownModule;
        if (active.has(key)) return "data:text/css,";
        let src = encoded.get(key);
        if (!src) {
          const bytes = await assets.read(file);
          if (bytes) {
            const moduleId = `omni-preview:${modules.size}`;
            if (kind === "module") modules.set(file, moduleId);
            active.add(key);
            try {
              const part = ["style", "script", "module"].includes(kind)
                ? await code(new TextDecoder().decode(bytes), kind === "style" ? "css" : "js", url)
                : new Uint8Array(bytes);
              src = await dataUrl(new Blob([part], { type: mime }));
              if (kind === "module") {
                imports[moduleId] = `${src}#${moduleId}`;
                return moduleId;
              }
              encoded.set(key, src);
            } finally {
              active.delete(key);
            }
          }
        }
        if (src && src.length <= outputBudget) {
          outputBudget -= src.length;
          return src + url.hash;
        }
      }
    } catch {
      signal.throwIfAborted();
    }
    assets.missing.add(value);
    return reference;
  }

  async function attribute(element: Element, name: string, kind: AssetKind) {
    const original = element.getAttribute(name);
    if (!original) return;
    const next = await embed(original, kind);
    if (next !== original) {
      const src =
        kind === "module" && next in imports
          ? `data:text/javascript,${encodeURIComponent(`import ${JSON.stringify(next)}`)}`
          : next;
      element.setAttribute(name, src);
    }
  }

  for (const element of doc.querySelectorAll(
    'script, style, link[rel~="stylesheet"], img, image, video, audio, source, track, [style]'
  )) {
    signal.throwIfAborted();
    const tag = element.localName;
    if (tag === "script") {
      const type = element.getAttribute("type")?.trim().toLowerCase();
      if (type === "importmap") {
        try {
          const map = JSON.parse(element.textContent || "{}");
          for (const entries of [map.imports, ...Object.values(map.scopes ?? {})]) {
            if (!entries || typeof entries !== "object") continue;
            for (const [key, ref] of Object.entries(entries)) {
              if (typeof ref !== "string") continue;
              const next = await embed(ref, "module");
              const mapped = imports[next];
              if (mapped && mapped.length > outputBudget) assets.missing.add(ref);
              else {
                entries[key] = mapped ?? next;
                outputBudget -= mapped?.length ?? 0;
              }
            }
          }
          element.textContent = JSON.stringify(map).replaceAll("<", "\\u003c");
        } catch {
          signal.throwIfAborted();
        }
      } else if (
        !type ||
        type === "module" ||
        /^(?:application|text)\/(?:java|ecma)script$/.test(type)
      ) {
        if (element.hasAttribute("src"))
          await attribute(element, "src", type === "module" ? "module" : "script");
        else element.textContent = await code(element.textContent ?? "", "js", assets.entry);
      }
    } else if (tag === "style")
      element.textContent = await code(element.textContent ?? "", "css", assets.entry);
    else if (tag === "link") await attribute(element, "href", "style");
    else if (tag === "image") {
      await attribute(element, "href", "media");
      await attribute(element, "xlink:href", "media");
    } else if (["img", "video", "audio", "source", "track"].includes(tag)) {
      await attribute(element, "src", "media");
      if (tag === "video") await attribute(element, "poster", "media");
      const srcset = element.getAttribute("srcset");
      if (srcset && !/\bdata:/i.test(srcset)) {
        const candidates: string[] = [];
        for (const candidate of srcset.split(",")) {
          const [src, ...descriptor] = candidate.trim().split(/\s+/);
          if (src) candidates.push([await embed(src, "media"), ...descriptor].join(" "));
        }
        element.setAttribute("srcset", candidates.join(", "));
      }
    }
    const style = element.getAttribute("style");
    if (style)
      element.setAttribute("style", (await code(`a{${style}}`, "css", assets.entry)).slice(2, -1));
  }

  if (Object.keys(imports).length) {
    const map = doc.createElement("script");
    map.type = "importmap";
    map.textContent = JSON.stringify({ imports });
    doc.head.prepend(map);
  }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  const referrer = doc.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  doc.head.prepend(policy, referrer);
  const origins = [...assets.remote];
  return {
    origins,
    missing: [...assets.missing],
    render(allowExternal: boolean) {
      const sources = ["data:", "blob:", ...(allowExternal ? origins : [])].join(" ");
      policy.content = `default-src 'none'; script-src 'unsafe-inline' ${sources}; style-src 'unsafe-inline' ${sources}; img-src ${sources}; media-src ${sources}; font-src ${sources}; connect-src ${sources}; worker-src blob: data:; base-uri 'none'; form-action 'none'`;
      return `<!doctype html>${doc.documentElement.outerHTML}`;
    }
  };
}

export type HtmlPreview = Awaited<ReturnType<typeof previewHtml>>;
