import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Copy, Download } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";

const LINE_HEIGHT = 18;
const VIEWPORT = 260;
const OVERSCAN = 24;
const VIRTUALIZE_AFTER = 80;

export function VirtualLog({ text, label = "日志" }: { text: string; label?: string }) {
  const lines = useMemo(() => text.replace(/\n$/, "").split("\n"), [text]);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visible = Math.ceil(VIEWPORT / LINE_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(lines.length, start + visible);
  const virtual = lines.length >= VIRTUALIZE_AFTER;

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [text, virtual]);

  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${label.replace(/\s+/g, "-")}.log`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="virtual-log">
      <div className="virtual-log-toolbar">
        <span>
          {label} · {lines.length} 行
        </span>
        <button type="button" onClick={() => void copyTextToClipboard(text)}>
          <Copy className="size-3" /> 复制全部
        </button>
        <button type="button" onClick={download}>
          <Download className="size-3" /> 下载
        </button>
        <button
          type="button"
          onClick={() => {
            const node = scroller.current;
            if (node) node.scrollTop = node.scrollHeight;
          }}
        >
          <ArrowDownToLine className="size-3" /> 跳到底部
        </button>
      </div>
      {virtual ? (
        <div
          ref={scroller}
          className="virtual-log-body"
          style={{ height: VIEWPORT }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div style={{ height: lines.length * LINE_HEIGHT, position: "relative" }}>
            <pre
              className="virtual-log-window"
              style={{ top: start * LINE_HEIGHT, minHeight: (end - start) * LINE_HEIGHT }}
            >
              {lines.slice(start, end).join("\n")}
            </pre>
          </div>
        </div>
      ) : (
        <pre ref={scroller as never} className="virtual-log-body virtual-log-plain">
          {text}
        </pre>
      )}
    </div>
  );
}
