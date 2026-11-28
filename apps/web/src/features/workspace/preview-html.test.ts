// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewHtml } from "./preview-html";
import { chatFileResource, draftResource } from "./chat-preview";
import type { ComposerAttachment } from "./composer-attachments";

const filesystem = (path: string) =>
  `/api/filesystem/file/download?path=${encodeURIComponent(path)}&inline=1`;
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("isolated HTML dependencies", () => {
  it.each(["/tmp/我的动画", "C:/Users/Me/我的动画"])(
    "keeps the absolute directory of %s and resolves nested styles and modules",
    async (directory) => {
      const sources = new Map(
        Object.entries({
          "css/app.css":
            '@import "theme/colors.css"; .scene { background: url(../images/clip.gif) }',
          "css/theme/colors.css": "@font-face {font-family:demo;src:url(../../fonts/demo.woff2)}",
          "fonts/demo.woff2": "font",
          "images/clip.gif": "gif",
          "js/main.mjs": 'import {frame} from "./loop.js"; fetch("./scene.json"); frame();',
          "js/loop.js":
            'export function frame() { return new URL("../images/clip.gif", import.meta.url); }',
          "scene.json": "{}"
        })
      );
      const fetch = vi.fn(async (url: URL) => {
        expect(url.pathname).toBe("/api/filesystem/file/download");
        const path = url.searchParams.get("path")!;
        expect(path.startsWith(directory + "/")).toBe(true);
        return new Response(sources.get(path.slice(directory.length + 1)), {
          headers: {
            "x-file-path": encodeURIComponent(path),
            "content-type": "application/octet-stream"
          }
        });
      });
      vi.stubGlobal("fetch", fetch);
      const preview = await previewHtml(
        '<link rel="stylesheet" href="./css/app.css"><script type="module" src="js/main.mjs"></script><video poster="images/clip.gif"></video>',
        filesystem(directory + "/index.html"),
        signal()
      );
      expect(preview.missing).toEqual([]);
      const doc = parse(preview.render(false));
      expect(doc.querySelector("link")?.href).toMatch(/^data:text\/css/);
      expect(doc.querySelector("video")?.poster).toMatch(/^data:image\/gif/);
      expect(
        Object.keys(JSON.parse(doc.querySelector('script[type="importmap"]')!.textContent!).imports)
      ).toHaveLength(2);
      expect(fetch).toHaveBeenCalledTimes(sources.size);
    }
  );

  it("does not embed an out-of-directory path, a symlink's outside target, or unsupported file types", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("outside", { headers: { "x-file-path": "%2Foutside%2Fclip.gif" } })
      );
    vi.stubGlobal("fetch", fetch);
    const preview = await previewHtml(
      '<img src="../clip.gif"><img src="%2e%2e%2fclip.gif"><img src="alias.gif"><img src=".hidden/clip.gif"><script src="note.txt"></script>',
      filesystem("/tmp/site/index.html"),
      signal()
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(preview.missing).toHaveLength(5);
    expect(preview.render(false)).not.toContain("base64,");
  });

  it("does not fetch CDN dependencies with workbench credentials and requires per-preview opt-in", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const preview = await previewHtml(
      '<script src="https://cdn.example.org/tween.js"></script>',
      undefined,
      signal()
    );
    const policy = (network: boolean) =>
      parse(preview.render(network)).querySelector<HTMLMetaElement>("meta[http-equiv]")!.content;
    expect(preview.origins).toEqual(["https://cdn.example.org"]);
    expect(policy(false)).not.toContain("https:");
    expect(policy(true)).toContain("https://cdn.example.org");
    expect(policy(false)).not.toContain("https://cdn.example.org");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads matching draft attachments without uploading or scanning the browser's disk", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const entry: ComposerAttachment = {
      id: "page",
      name: "demo.html",
      kind: "text",
      text: '<script src="draw.js"></script>',
      bytes: new Uint8Array(),
      mime: "text/html",
      size: 0
    };
    const script: ComposerAttachment = {
      ...entry,
      id: "script",
      name: "draw.js",
      bytes: new TextEncoder().encode("requestAnimationFrame(draw)"),
      mime: "text/javascript"
    };
    const draft = draftResource(entry, undefined, [entry, script])!;
    const preview = await previewHtml(draft.content!, undefined, signal(), draft.files);
    expect(parse(preview.render(false)).querySelector("script")?.src).toMatch(
      /^data:text\/javascript/
    );
    expect(preview.missing).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses original companion names after a group of attachments has been saved", async () => {
    const peers = [
      { kind: "text" as const, name: "demo.html", path: ".codex-uploads/100-demo.html" },
      { kind: "text" as const, name: "draw.js", path: ".codex-uploads/101-draw.js" },
      { kind: "image" as const, name: "sprite.gif", path: ".codex-uploads/102-sprite.gif" }
    ];
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => {
      const path = url.searchParams.get("path")!;
      requests.push(path);
      return new Response(
        path.endsWith(".js") ? 'const sprite = new Image(); sprite.src = "sprite.gif";' : "gif"
      );
    });
    const entry = chatFileResource(
      peers[0]!.path,
      null,
      { id: "project", realPath: "/tmp/project", displayPath: "/tmp/project" },
      peers
    )!;
    const preview = await previewHtml(
      '<script src="draw.js"></script>',
      entry.src,
      signal(),
      entry.files
    );
    expect(preview.missing).toEqual([]);
    expect(requests).toEqual(peers.slice(1).map((item) => item.path));
  });
});
