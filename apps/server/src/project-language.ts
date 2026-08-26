import path from "node:path";
import ts from "typescript";
import { normalizeProjectRelativePath } from "./project-file.js";

export type LanguageSymbol = {
  name: string;
  kind: string;
  line: number;
  column: number;
  children?: LanguageSymbol[];
};

export type LanguageDiagnostic = {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
};

export type LanguageDefinition = {
  path: string;
  line: number;
  column: number;
};

export type LanguageAnalysis = {
  symbols: LanguageSymbol[];
  diagnostics: LanguageDiagnostic[];
  definition: LanguageDefinition | null;
};

const MAX_LANGUAGE_CHARS = 400_000;
const SCRIPT_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]);

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

function extensionOf(relativePath: string) {
  const base = relativePath.split("/").pop() ?? relativePath;
  const index = base.lastIndexOf(".");
  return index >= 0 ? base.slice(index + 1).toLowerCase() : "";
}

function lineColumn(content: string, offset: number) {
  const safe = Math.max(0, Math.min(offset, content.length));
  const before = content.slice(0, safe);
  const line = before.split("\n").length;
  const column = safe - (before.lastIndexOf("\n") + 1) + 1;
  return { line, column };
}

function offsetAt(content: string, line: number, column: number) {
  const lines = content.split("\n");
  const index = Math.max(0, Math.min(line - 1, lines.length - 1));
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += (lines[i]?.length ?? 0) + 1;
  return offset + Math.max(0, Math.min(column - 1, lines[index]?.length ?? 0));
}

function jsonDiagnostics(content: string): LanguageDiagnostic[] {
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 无法解析";
    const position = Number(/position\s+(\d+)/i.exec(message)?.[1] ?? NaN);
    const loc = Number.isFinite(position) ? lineColumn(content, position) : { line: 1, column: 1 };
    return [
      {
        line: loc.line,
        column: loc.column,
        endLine: loc.line,
        endColumn: loc.column + 1,
        severity: "error",
        message,
        source: "json"
      }
    ];
  }
}

function markdownSymbols(content: string): LanguageSymbol[] {
  const symbols: LanguageSymbol[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index] ?? "");
    if (!match) continue;
    symbols.push({
      name: match[2] ?? "",
      kind: "heading",
      line: index + 1,
      column: 1
    });
  }
  return symbols;
}

function pythonSymbols(content: string): LanguageSymbol[] {
  const symbols: LanguageSymbol[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^[ \t]*(async\s+def|def|class)\s+([A-Za-z_][\w]*)/.exec(lines[index] ?? "");
    if (!match) continue;
    symbols.push({
      name: match[2] ?? "",
      kind: match[1]?.includes("class") ? "class" : "function",
      line: index + 1,
      column: 1
    });
  }
  return symbols;
}

function mapScriptKind(kind: string) {
  if (kind.includes("class") || kind.includes("interface") || kind.includes("enum")) return "class";
  if (kind.includes("function") || kind.includes("method") || kind.includes("constructor"))
    return "function";
  if (kind.includes("module") || kind.includes("alias")) return "module";
  if (kind.includes("type")) return "type";
  return "variable";
}

function flattenNavigation(
  items: readonly ts.NavigationBarItem[],
  sourceFile: ts.SourceFile
): LanguageSymbol[] {
  const symbols: LanguageSymbol[] = [];
  for (const item of items) {
    if (item.text === "<function>" || item.kind === "script") {
      symbols.push(...flattenNavigation(item.childItems ?? [], sourceFile));
      continue;
    }
    const span = item.spans[0];
    const loc = span
      ? sourceFile.getLineAndCharacterOfPosition(span.start)
      : { line: 0, character: 0 };
    const children = flattenNavigation(item.childItems ?? [], sourceFile);
    symbols.push({
      name: item.text,
      kind: mapScriptKind(item.kind),
      line: loc.line + 1,
      column: loc.character + 1,
      ...(children.length ? { children } : {})
    });
  }
  return symbols;
}

function analyzeScript(input: {
  rootPath: string;
  relativePath: string;
  content: string;
  line?: number;
  column?: number;
}): Pick<LanguageAnalysis, "symbols" | "diagnostics" | "definition"> {
  const fileName = path.resolve(input.rootPath, input.relativePath);
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    isolatedModules: true
  };
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      if (name === fileName) return ts.ScriptSnapshot.fromString(input.content);
      const text = ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => input.rootPath,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories
  };
  const service = ts.createLanguageService(host);
  try {
    const sourceFile = service.getProgram()?.getSourceFile(fileName);
    const symbols = sourceFile
      ? flattenNavigation(service.getNavigationBarItems(fileName), sourceFile)
      : [];
    const diagnostics = [
      ...service.getSyntacticDiagnostics(fileName),
      ...service.getSemanticDiagnostics(fileName)
    ]
      .filter((item) => item.file && item.start !== undefined)
      .slice(0, 80)
      .map((item) => {
        const start = item.start ?? 0;
        const length = item.length ?? 1;
        const startLoc = lineColumn(input.content, start);
        const endLoc = lineColumn(input.content, start + length);
        return {
          line: startLoc.line,
          column: startLoc.column,
          endLine: endLoc.line,
          endColumn: endLoc.column,
          severity:
            item.category === ts.DiagnosticCategory.Warning
              ? ("warning" as const)
              : item.category === ts.DiagnosticCategory.Message ||
                  item.category === ts.DiagnosticCategory.Suggestion
                ? ("info" as const)
                : ("error" as const),
          message: ts.flattenDiagnosticMessageText(item.messageText, "\n"),
          source: "typescript"
        };
      });
    let definition: LanguageDefinition | null = null;
    if (input.line && input.column && sourceFile) {
      const position = offsetAt(input.content, input.line, input.column);
      const info = service.getDefinitionAtPosition(fileName, position)?.[0];
      if (info) {
        const targetPath = path.resolve(info.fileName);
        const root = path.resolve(input.rootPath);
        if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) {
          const relative = normalizeProjectRelativePath(path.relative(root, targetPath));
          const targetContent =
            targetPath === fileName ? input.content : (ts.sys.readFile(targetPath) ?? "");
          const loc = lineColumn(targetContent, info.textSpan.start);
          definition = { path: relative, line: loc.line, column: loc.column };
        }
      }
    }
    return { symbols, diagnostics, definition };
  } finally {
    service.dispose();
  }
}

export function analyzeProjectDocument(input: {
  rootPath: string;
  relativePath: string;
  content: string;
  line?: number | undefined;
  column?: number | undefined;
}): LanguageAnalysis {
  const relativePath = normalizeProjectRelativePath(input.relativePath);
  if (!relativePath) throw httpError(400, "路径不是文件");
  const content =
    input.content.length > MAX_LANGUAGE_CHARS
      ? input.content.slice(0, MAX_LANGUAGE_CHARS)
      : input.content;
  const extension = extensionOf(relativePath);
  if (extension === "json" || extension === "jsonc") {
    return { symbols: [], diagnostics: jsonDiagnostics(content), definition: null };
  }
  if (extension === "md" || extension === "mdx") {
    return { symbols: markdownSymbols(content), diagnostics: [], definition: null };
  }
  if (extension === "py") {
    return { symbols: pythonSymbols(content), diagnostics: [], definition: null };
  }
  if (SCRIPT_EXTENSIONS.has(extension)) {
    return analyzeScript({
      rootPath: input.rootPath,
      relativePath,
      content,
      ...(input.line ? { line: input.line } : {}),
      ...(input.column ? { column: input.column } : {})
    });
  }
  return { symbols: [], diagnostics: [], definition: null };
}
