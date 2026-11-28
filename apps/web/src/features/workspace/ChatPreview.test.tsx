// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPreviewProvider } from "./ChatPreview";
import { EventCard } from "./EventCard";
import { chatLinkResource, draftResource } from "./chat-preview";
import { linkFileRefs } from "./markdown-refs";
import { previewHtml } from "./preview-html";

const project = { id: "project", realPath: "/work/repo", displayPath: "/work/repo" };
let container: HTMLDivElement;
let root: Root;

function render(children?: ReactNode) {
  act(() =>
    root.render(
      <ChatPreviewProvider project={project}>
        <textarea defaultValue="未发送的草稿" />
        {children}
      </ChatPreviewProvider>
    )
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("chat previews", () => {
  it("intercepts a normal link without navigating and survives the message being virtualized away", async () => {
    const url = "https://docs.example.org:8080/demo/index.html?q=1";
    expect(linkFileRefs(url)).toBe(url);
    render(<EventCard item={{ id: "link", kind: "assistant", text: url }} />);
    const originalUrl = location.href;
    const link = container.querySelector("a")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    render();
    const frame = document.querySelector("iframe")!;
    expect(frame.src).toBe(url);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("复制链接");
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("textarea")!.value).toBe("未发送的草稿");
    expect(location.href).toBe(originalUrl);
  });

  it("loads linked project HTML with the text API, isolates it, and can show its source", async () => {
    const content = "<h1>本地演示</h1>";
    const fetch = vi.fn().mockResolvedValue(Response.json({ content }));
    vi.stubGlobal("fetch", fetch);
    render(
      <EventCard
        item={{ id: "html", kind: "assistant", text: "[演示](</work/repo/设计 示例/index.html>)" }}
      />
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".file-ref-link")!.click();
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/projects/project/file?path=${encodeURIComponent("设计 示例/index.html")}`
    );
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.srcdoc).toContain(content);
    expect(frame.srcdoc).toContain("Content-Security-Policy");
    const toggle = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "查看源码"
    )!;
    act(() => toggle.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(content);
  });

  it("uses the original GIF rather than a still thumbnail for both markdown and sent attachments", async () => {
    const path = ".codex-uploads/1-motion.gif";
    render(
      <EventCard
        projectId={project.id}
        item={{
          id: "gif",
          kind: "user",
          text: `![演示](${path})`,
          data: { attachments: [{ name: "motion.gif", kind: "image", path }] }
        }}
      />
    );
    for (const name of ["演示", "motion.gif"]) {
      act(() => container.querySelector<HTMLButtonElement>(`[aria-label="预览 ${name}"]`)!.click());
      expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe(
        `/api/projects/project/files/download?path=${encodeURIComponent(path)}&inline=1`
      );
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click();
      });
    }
  });

  it("keeps text line references and unreadable files in the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ content: "first\nsecond" }))
        .mockResolvedValueOnce(Response.json({ error: "文件不存在" }, { status: 404 }))
    );
    render(
      <EventCard
        item={{ id: "text", kind: "user", text: "[代码](file.ts#L2) [附件](archive.zip)" }}
      />
    );
    const links = container.querySelectorAll<HTMLButtonElement>(".file-ref-link");
    await act(async () => {
      links[0]!.click();
    });
    expect(document.querySelector("mark")?.textContent).toBe("second");
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click();
    });
    await act(async () => {
      links[1]!.click();
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("文件不存在");
    expect(document.querySelector("a[download]")?.getAttribute("download")).toBe("archive.zip");
  });

  it("only resolves supported link schemes and preserves draft HTML without uploading it", () => {
    for (const href of ["javascript:void(0)", "data:text/html,hello", "codex-file:%ZZ"])
      expect(chatLinkResource(href, project)).toBeNull();
    expect(chatLinkResource("//cdn.example.org/demo.gif?v=3", project)?.kind).toBe("image");
    expect(chatLinkResource("demo.html?v=2#section", project)?.textUrl).toBe(
      "/api/projects/project/file?path=demo.html"
    );
    expect(chatLinkResource("Dockerfile", project)?.kind).toBe("text");
    expect(chatLinkResource("sandbox:/tmp/demo.html", project)?.textUrl).toBe(
      "/api/filesystem/file?path=%2Ftmp%2Fdemo.html"
    );
    expect(
      draftResource(
        {
          id: "1",
          name: "demo.htm",
          kind: "text",
          mime: "text/html",
          text: "<main>草稿</main>",
          size: 0,
          bytes: new Uint8Array()
        },
        project
      )
    ).toEqual({ kind: "html", title: "demo.htm", content: "<main>草稿</main>" });
  });

  it("only fetches supported project HTML assets in the document directory, once per path", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: async () => new Blob(["gif"], { type: "image/gif" })
    });
    vi.stubGlobal("fetch", fetch);
    const html = await previewHtml(
      '<img src="clip.gif"><img src="clip.gif"><img src="../other.gif"><img src="https://example.com/clip.gif"><script src="file.txt"></script>',
      "/api/projects/project/files/download?path=demo%2Findex.html&inline=1",
      new AbortController().signal
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0]![0] as URL).searchParams.get("path")).toBe("demo/clip.gif");
    expect(html.match(/data:image\/gif;base64,/g)).toHaveLength(2);
  });
});
