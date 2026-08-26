import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "@/context/theme-provider";

export function MermaidBlock({ code }: { code: string }) {
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, "");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    void import("mermaid")
      .then(async (mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default"
        });
        const { svg } = await mermaid.render(`mermaid-${reactId}`, code);
        if (!cancelled && hostRef.current) hostRef.current.innerHTML = svg;
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "图表渲染失败");
      });
    return () => {
      cancelled = true;
    };
  }, [code, reactId, resolvedTheme]);

  if (error) {
    return (
      <pre className="mermaid-fallback" role="alert">
        {code}
        {"\n\n"}
        {error}
      </pre>
    );
  }

  return (
    <div ref={hostRef} className="mermaid-block" aria-label="Mermaid 图表">
      正在渲染图表
    </div>
  );
}
