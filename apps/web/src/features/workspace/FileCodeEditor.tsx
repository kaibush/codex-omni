import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";
import type { LanguageDiagnostic } from "./file-workspace";

type EditorViewLike = EditorView;

function extensionsFor(path: string): Extension[] {
  const lower = path.toLowerCase();
  const extension = lower.split(".").pop();

  if (lower.endsWith(".tsx")) return [javascript({ jsx: true, typescript: true })];
  if (lower.endsWith(".ts")) return [javascript({ typescript: true })];
  if (lower.endsWith(".jsx")) return [javascript({ jsx: true })];
  if (extension === "js" || extension === "mjs" || extension === "cjs") {
    return [javascript()];
  }
  if (extension === "json" || extension === "jsonc") return [json()];
  if (extension === "css" || extension === "scss") return [css()];
  if (extension === "html" || extension === "htm" || extension === "xml") return [html()];
  if (extension === "md" || extension === "mdx") return [markdown()];
  if (extension === "py") return [python()];
  if (extension === "sql") return [sql()];
  if (extension === "yaml" || extension === "yml") return [yaml()];
  return [];
}

function toEditorDiagnostics(view: EditorView, items: LanguageDiagnostic[]): Diagnostic[] {
  const doc = view.state.doc;
  return items.map((item) => {
    const startLine = doc.line(Math.min(Math.max(item.line, 1), doc.lines));
    const endLine = doc.line(Math.min(Math.max(item.endLine || item.line, 1), doc.lines));
    const from = Math.min(doc.length, startLine.from + Math.max(0, item.column - 1));
    const to = Math.min(
      doc.length,
      endLine.from + Math.max(0, (item.endColumn || item.column) - 1)
    );
    return {
      from,
      to: Math.max(to, from),
      severity: item.severity,
      message: item.message
    };
  });
}

export default function FileCodeEditor({
  value,
  path,
  theme,
  editable,
  onChange,
  line = null,
  diagnostics = [],
  onDefinitionRequest,
  autoFocus = true
}: {
  value: string;
  path: string;
  theme: "light" | "dark";
  editable: boolean;
  onChange: (value: string) => void;
  line?: number | null;
  diagnostics?: LanguageDiagnostic[];
  onDefinitionRequest?: (line: number, column: number) => void;
  autoFocus?: boolean;
}) {
  const definitionRef = useRef(onDefinitionRequest);
  definitionRef.current = onDefinitionRequest;
  const extensions = useMemo(() => {
    const language = extensionsFor(path);
    return [
      ...language,
      lintGutter(),
      EditorView.domEventHandlers({
        click(event, view) {
          if (!(event.metaKey || event.ctrlKey)) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position == null) return false;
          const current = view.state.doc.lineAt(position);
          definitionRef.current?.(current.number, position - current.from + 1);
          return true;
        }
      })
    ];
  }, [path]);
  const viewRef = useRef<EditorViewLike | null>(null);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !line) return;
    const target = Math.min(Math.max(line, 1), view.state.doc.lines);
    const position = view.state.doc.line(target).from;
    view.dispatch({
      selection: { anchor: position, head: position },
      scrollIntoView: true
    });
  }, [line, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, toEditorDiagnostics(view, diagnostics)));
  }, [diagnostics, path, value]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={theme}
      extensions={extensions}
      onChange={onChange}
      editable={editable}
      readOnly={!editable}
      autoFocus={autoFocus}
      indentWithTab
      onCreateEditor={(view) => {
        viewRef.current = view as EditorView;
        view.dispatch(setDiagnostics(view.state, toEditorDiagnostics(view, diagnostics)));
      }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        searchKeymap: true
      }}
      className="h-full overflow-hidden text-[13px] [&_.cm-editor]:h-full [&_.cm-gutters]:border-r [&_.cm-gutters]:border-border [&_.cm-scroller]:overflow-auto [&_.cm-scroller]:font-mono"
    />
  );
}
