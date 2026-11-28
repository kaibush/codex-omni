import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Copy, Download, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { BoundedImage } from "./BoundedImage";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import {
  chatImageSource,
  chatLinkResource,
  type ChatResource,
  type PreviewProject
} from "./chat-preview";
import { fileName, type FilePreview } from "./file-workspace";
import { parseProjectFileHref } from "./markdown-refs";
import { previewHtml } from "./preview-html";

const PreviewContext = createContext<{
  project: PreviewProject | undefined;
  open: (resource: ChatResource | null) => void;
}>({ project: undefined, open: () => {} });
const InsidePreviewLink = createContext(false);
export const useChatPreview = () => useContext(PreviewContext);

export function ChatPreviewProvider({
  project,
  children
}: {
  project: PreviewProject | undefined;
  children: ReactNode;
}) {
  const [resource, setResource] = useState<ChatResource | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const open = useCallback((next: ChatResource | null) => {
    if (!next) {
      toast.error("无法预览这个资源");
      return;
    }
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setResource(next);
  }, []);
  const context = useMemo(() => ({ project, open }), [project, open]);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
  };
  return (
    <PreviewContext.Provider value={context}>
      {children}
      {resource && (
        <ResourceDialog
          resource={resource}
          onClose={() => setResource(null)}
          restoreFocus={restoreFocus}
        />
      )}
    </PreviewContext.Provider>
  );
}

export function ChatPreviewLink({
  href,
  children,
  className
}: {
  href?: string | undefined;
  children?: ReactNode;
  className?: string | undefined;
}) {
  const { open, project } = useChatPreview();
  const resource = href ? chatLinkResource(href, project) : null;
  const label = <InsidePreviewLink.Provider value>{children}</InsidePreviewLink.Provider>;
  if (resource && href && /^(?:https?:\/\/|\/\/|\/api\/)/i.test(href)) {
    return (
      <a
        href={href}
        className={className}
        onClick={(event) => {
          event.preventDefault();
          open(resource);
        }}
      >
        {label}
      </a>
    );
  }
  if (resource) {
    return (
      <button type="button" className={className ?? "file-ref-link"} onClick={() => open(resource)}>
        {label}
      </button>
    );
  }
  return <span className={parseProjectFileHref(href) ? "file-ref-link" : undefined}>{label}</span>;
}

export function ChatPreviewImage({
  src,
  alt = ""
}: {
  src?: string | undefined;
  alt?: string | undefined;
}) {
  const { open, project } = useChatPreview();
  const linked = useContext(InsidePreviewLink);
  const [failedSource, setFailedSource] = useState<string>();
  const source = src && chatImageSource(src, project);
  if (!source) return <span>{alt}</span>;
  const name = alt || "图片";
  const image =
    failedSource === source ? (
      <span className="text-sm underline">{alt || "查看原图"}</span>
    ) : /^https?:\/\//i.test(source) ? (
      <img
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        src={source}
        alt={alt}
        className="notice-image"
        onError={() => setFailedSource(source)}
      />
    ) : (
      <BoundedImage
        src={source}
        alt={alt}
        className="notice-image"
        onError={() => setFailedSource(source)}
      />
    );
  if (linked) return image;
  return (
    <button
      type="button"
      className="max-w-full cursor-zoom-in"
      aria-label={`预览 ${name}`}
      onClick={() => open({ kind: "image", src: source, title: name })}
    >
      {image}
    </button>
  );
}

function DocumentBody({ resource, source }: { resource: ChatResource; source: boolean }) {
  const [content, setContent] = useState(resource.content);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState("");
  const marker = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      const text = resource.textUrl
        ? (await api<FilePreview>(resource.textUrl, { signal })).content
        : (resource.content ?? "");
      if (signal.aborted) return;
      setContent(text);
      if (resource.kind === "html") {
        const document = await previewHtml(text, resource.src, signal);
        if (!signal.aborted) setHtml(document);
      }
    }
    void load().catch((reason: Error) => {
      if (!controller.signal.aborted) setError(reason.message || "文件读取失败");
    });
    return () => controller.abort();
  }, [resource]);
  useEffect(() => {
    marker.current?.scrollIntoView?.({ block: "center" });
  }, [content, source]);
  if (error)
    return (
      <p role="alert" className="m-auto p-4 text-sm">
        无法预览：{error}
      </p>
    );
  if (content === undefined || (!source && resource.kind === "html" && html === null))
    return (
      <p role="status" className="m-auto text-sm text-muted-foreground">
        正在读取文件…
      </p>
    );
  if (!source && html !== null) {
    return (
      <iframe
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={resource.title}
        className="size-full border-0 bg-white"
        srcDoc={html}
      />
    );
  }
  const lines = resource.line ? content.split("\n") : [];
  const index = (resource.line ?? 0) - 1;
  return (
    <pre className="size-full overflow-auto overscroll-contain p-4 text-xs leading-5" tabIndex={0}>
      {index >= 0 && index < lines.length ? (
        <>
          {lines.slice(0, index).join("\n")}
          {index > 0 ? "\n" : ""}
          <mark ref={marker}>{lines[index] || " "}</mark>
          {index + 1 < lines.length ? "\n" : ""}
          {lines.slice(index + 1).join("\n")}
        </>
      ) : (
        content
      )}
    </pre>
  );
}

function ResourceDialog({
  resource,
  onClose,
  restoreFocus
}: {
  resource: ChatResource;
  onClose: () => void;
  restoreFocus: (event: Event) => void;
}) {
  const [source, setSource] = useState(Boolean(resource.line));
  const [blobUrl, setBlobUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!resource.blob && resource.kind !== "pdf") return;
    const controller = new AbortController();
    let url = "";
    async function loadBlob() {
      let blob = resource.blob;
      if (!blob && resource.src) {
        const response = await fetch(resource.src, {
          signal: controller.signal,
          credentials: "same-origin"
        });
        if (!response.ok) throw new Error("无法读取 PDF");
        blob = await response.blob();
      }
      if (!blob || controller.signal.aborted) return;
      url = URL.createObjectURL(
        resource.kind === "pdf" ? new Blob([blob], { type: "application/pdf" }) : blob
      );
      setBlobUrl(url);
    }
    void loadBlob().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [resource]);
  const src = resource.kind === "pdf" ? blobUrl : resource.src || blobUrl;
  const download = resource.download || blobUrl;
  if (resource.kind === "image" && src) {
    return (
      <ImagePreviewDialog
        open
        src={src}
        alt={resource.title}
        onOpenChange={onClose}
        onCloseAutoFocus={restoreFocus}
      />
    );
  }
  const web = resource.kind === "web";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="wide"
        showCloseButton={false}
        className="h-[85dvh] gap-3 overflow-hidden"
        onCloseAutoFocus={restoreFocus}
      >
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute end-3 top-3"
            aria-label="关闭预览"
          >
            <X />
          </Button>
        </DialogClose>
        <DialogHeader className="min-w-0 gap-1 pr-8 text-start">
          <DialogTitle className="truncate" title={resource.title}>
            {web ? "网页预览" : "文件预览"} · {fileName(resource.title)}
          </DialogTitle>
          <DialogDescription className="truncate" title={web ? src : resource.title}>
            {web ? src : resource.title}
            {resource.line ? `:${resource.line}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
          {resource.kind === "html" || resource.kind === "text" ? (
            <DocumentBody resource={resource} source={source} />
          ) : resource.kind === "binary" || failed ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              此文件无法在当前浏览器中预览。
            </p>
          ) : !src ? (
            <p role="status" className="text-sm text-muted-foreground">
              正在加载…
            </p>
          ) : resource.kind === "audio" ? (
            <audio controls src={src} className="w-full max-w-xl" onError={() => setFailed(true)} />
          ) : resource.kind === "video" ? (
            <video
              controls
              playsInline
              src={src}
              className="max-h-full max-w-full"
              onError={() => setFailed(true)}
            />
          ) : resource.kind === "pdf" ? (
            <object
              type="application/pdf"
              data={src}
              aria-label={resource.title}
              className="size-full"
            >
              <p className="p-4 text-sm">浏览器无法显示 PDF，请下载查看。</p>
            </object>
          ) : (
            <iframe
              title={resource.title}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              src={src}
              className="size-full border-0 bg-white"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {web && (
            <>
              <p className="mr-auto text-xs text-muted-foreground">
                若网站不允许嵌入，可复制链接到浏览器查看。
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  void copyTextToClipboard(src).then((ok) =>
                    ok ? toast.success("已复制链接") : toast.error("复制失败")
                  )
                }
              >
                <Copy />
                复制链接
              </Button>
            </>
          )}
          {resource.kind === "html" && (
            <Button variant="outline" onClick={() => setSource(!source)}>
              {source ? "查看预览" : "查看源码"}
            </Button>
          )}
          {download && (
            <Button asChild variant="outline">
              <a href={download} download={fileName(resource.title)}>
                <Download />
                下载文件
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
