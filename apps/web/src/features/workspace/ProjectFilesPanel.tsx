import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Highlight, themes } from "prism-react-renderer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CircleAlert,
  Columns2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Hash,
  ListTree,
  File,
  FileCode2,
  FilePlus,
  ChevronsDown,
  ChevronsUp,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompare,
  LoaderCircle,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  TextSearch,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, apiDownload, apiUpload } from "@/lib/api";
import type { Project } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useTheme } from "@/context/theme-provider";
import { GitDiffView } from "./GitDiffView";
import { GitPanel } from "./GitPanel";
import {
  ancestorPaths,
  compactSelectedPaths,
  fileName,
  flattenVisibleFileEntries,
  isMarkdownFile,
  isMediaPreview,
  joinProjectPath,
  languageFor,
  parentProjectPath,
  previewKindFor,
  suggestedCopyPath,
  tabFromMedia,
  tabFromPreview,
  toProjectRelativePath,
  treeFilterPaths,
  unifiedDiff,
  visibleFileEntries,
  type DirectoryResult,
  type EditorTab,
  type FileEntry,
  type FileMeta,
  type FilePreview,
  type FileSearchResult,
  type FileSort,
  type LanguageAnalysis,
  type LanguageSymbol,
  MAX_EDITABLE_FILE_BYTES
} from "./file-workspace";
import { BoundedImage } from "./BoundedImage";
import { FILE_PREVIEW_IMAGE_MAX_HEIGHT, FILE_PREVIEW_IMAGE_MAX_WIDTH } from "./bounded-image";

type ProjectResourceView = "files" | "git";
type FileLookupMode = "tree" | "name" | "content";
type FileAction =
  | { type: "create-file"; directory: string }
  | { type: "create-directory"; directory: string }
  | { type: "rename"; entry: FileEntry }
  | { type: "copy"; entry: FileEntry }
  | { type: "move"; entry: FileEntry };

const FileCodeEditor = lazy(() => import("./FileCodeEditor"));

const FILE_LOOKUP_MODE_ORDER: FileLookupMode[] = ["tree", "name", "content"];

function fileLookupMeta(mode: FileLookupMode): { label: string; hint: string } {
  switch (mode) {
    case "name":
      return { label: "文件名", hint: "在整个项目中搜索文件名" };
    case "content":
      return { label: "内容", hint: "在整个项目中搜索文件内容" };
    default:
      return { label: "文件树", hint: "按文件名收窄文件树，并保留匹配项的上级目录" };
  }
}

function fileLookupIcon(mode: FileLookupMode, className: string) {
  if (mode === "content") return <TextSearch className={className} />;
  if (mode === "name") return <Search className={className} />;
  return <ListTree className={className} />;
}

const fileIcon = (name: string) =>
  /\.(tsx?|jsx?|json|css|scss|md|toml|ya?ml|py|rs|go|java|kt|sql|sh)$/i.test(name) ? (
    <FileCode2 className="size-4 text-sky-600" />
  ) : (
    <File className="size-4 text-muted-foreground" />
  );

function deleteConfirmDescription(paths: string[], directories: Record<string, FileEntry[]>) {
  if (paths.length === 1) {
    const path = paths[0]!;
    const kind =
      directories[parentProjectPath(path)]?.find((entry) => entry.path === path)?.type ===
      "directory"
        ? "目录及其全部内容"
        : "文件";
    return `确定删除${kind} ${path}？此操作不可恢复。`;
  }
  return `确定删除选中的 ${paths.length} 个文件或目录？此操作不可恢复。`;
}

function NameDialog({
  action,
  onClose,
  onSubmit
}: {
  action: FileAction | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!action) {
      setValue("");
      return;
    }
    if (action.type === "create-file") setValue("");
    else if (action.type === "create-directory") setValue("");
    else if (action.type === "copy") setValue(suggestedCopyPath(action.entry.path));
    else if (action.type === "move") setValue(action.entry.path);
    else setValue(action.entry.name);
  }, [action]);
  if (!action) return null;
  const title =
    action.type === "create-file"
      ? "新建文件"
      : action.type === "create-directory"
        ? "新建目录"
        : action.type === "rename"
          ? "重命名"
          : action.type === "copy"
            ? "复制到"
            : "移动到";
  const description =
    action.type === "create-file" || action.type === "create-directory"
      ? `位置：${action.directory || "项目根目录"}`
      : action.entry.path;
  const allowPath = action.type === "copy" || action.type === "move";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = value.trim();
            if (!next) return;
            onSubmit(next);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={value}
            className="mt-4"
            placeholder={allowPath ? "相对路径" : "名称"}
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              确定
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SymbolTree({
  symbols,
  onOpen
}: {
  symbols: LanguageSymbol[];
  onOpen: (line: number) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {symbols.map((symbol, index) => (
        <li key={`${symbol.kind}:${symbol.name}:${symbol.line}:${index}`}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
            onClick={() => onOpen(symbol.line)}
          >
            <span className="w-14 shrink-0 text-[10px] uppercase text-muted-foreground">
              {symbol.kind}
            </span>
            <span className="min-w-0 truncate">{symbol.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{symbol.line}</span>
          </button>
          {symbol.children?.length ? (
            <div className="ml-3 border-l border-border/70 pl-1">
              <SymbolTree symbols={symbol.children} onOpen={onOpen} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function mediaUrl(projectId: string, path: string) {
  return `/api/projects/${projectId}/files/download?path=${encodeURIComponent(path)}&inline=1`;
}

function FilePreviewPane({
  tab,
  theme,
  projectId
}: {
  tab: EditorTab;
  theme: "light" | "dark";
  projectId: string;
}) {
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => {
    setMediaError(false);
  }, [tab.path, tab.previewKind, projectId]);

  if (tab.previewKind === "image") {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-auto p-4">
        {mediaError ? (
          <p className="text-sm text-muted-foreground">图片无法显示</p>
        ) : (
          <BoundedImage
            src={mediaUrl(projectId, tab.path)}
            alt={tab.path}
            className="max-h-full max-w-full rounded-lg border bg-muted object-contain"
            maxWidth={FILE_PREVIEW_IMAGE_MAX_WIDTH}
            maxHeight={FILE_PREVIEW_IMAGE_MAX_HEIGHT}
            onError={() => setMediaError(true)}
          />
        )}
      </div>
    );
  }
  if (tab.previewKind === "pdf") {
    return (
      <iframe
        title={tab.path}
        src={mediaUrl(projectId, tab.path)}
        className="h-full min-h-0 w-full flex-1 border-0 bg-muted"
      />
    );
  }
  if (tab.previewKind === "audio") {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center p-6">
        <audio controls src={mediaUrl(projectId, tab.path)} className="w-full max-w-xl" />
      </div>
    );
  }
  if (tab.previewKind === "video") {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-auto p-4">
        <video
          controls
          src={mediaUrl(projectId, tab.path)}
          className="max-h-full max-w-full rounded-lg bg-black"
        />
      </div>
    );
  }
  if (tab.previewKind === "binary") {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <div>
          <p>该文件是二进制内容，无法在编辑器中打开。</p>
          <a
            className="mt-3 inline-flex text-primary"
            href={mediaUrl(projectId, tab.path)}
            download
          >
            下载文件
          </a>
        </div>
      </div>
    );
  }
  if (isMarkdownFile(tab.path) || tab.previewKind === "markdown") {
    return (
      <div className="markdown mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{tab.draft}</ReactMarkdown>
      </div>
    );
  }
  return (
    <Highlight
      theme={theme === "dark" ? themes.oneDark : themes.oneLight}
      code={tab.draft}
      language={languageFor(tab.path)}
    >
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${className} min-h-full min-w-max p-4 text-[12px] leading-5 sm:text-[13px]`}
          style={style}
        >
          {tokens.map((line, lineIndex) => (
            <div key={lineIndex} {...getLineProps({ line })} className="table-row">
              <span className="table-cell select-none pr-5 text-right opacity-45">
                {lineIndex + 1}
              </span>
              <span className="table-cell">
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

function FilesWorkspace({
  project,
  openRequest,
  editorCommand,
  onOpened,
  onCommandHandled,
  onDirtyCount
}: {
  project: Project;
  openRequest?: { path: string; line: number | null } | null;
  editorCommand?: "goto-line" | "toggle-outline" | null | undefined;
  onOpened?: () => void;
  onCommandHandled?: (() => void) | undefined;
  onDirtyCount?: ((count: number) => void) | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const uploadRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<EditorTab[]>([]);
  const skipClickRef = useRef(false);
  const lastCheckedPath = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [directories, setDirectories] = useState<Record<string, FileEntry[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [activeDirectory, setActiveDirectory] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [fileLookupMode, setFileLookupMode] = useState<FileLookupMode>("tree");
  const [fileLookup, setFileLookup] = useState("");
  const [treeFilterHits, setTreeFilterHits] = useState<string[] | null>(null);
  const [filterSearching, setFilterSearching] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<FileSort>("name");
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"tree" | "editor">("tree");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<FileSearchResult | null>(null);
  const [action, setAction] = useState<FileAction | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState("");
  const [language, setLanguage] = useState<LanguageAnalysis | null>(null);

  tabsRef.current = tabs;
  const filter = fileLookupMode === "tree" ? fileLookup : "";
  const searchQuery = fileLookupMode === "tree" ? "" : fileLookup;
  const searchContent = fileLookupMode === "content";
  const lookupMode = fileLookupMeta(fileLookupMode);
  const lookupBusy = filterSearching || searching;
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const activeDiff = useMemo(() => {
    if (!activeTab || activeTab.mode !== "diff" || activeTab.split) return "";
    return unifiedDiff(
      activeTab.conflict?.content ?? activeTab.content,
      activeTab.draft,
      activeTab.path
    );
  }, [activeTab]);
  const dirtyPaths = useMemo(
    () => new Set(tabs.filter((tab) => tab.draft !== tab.content).map((tab) => tab.path)),
    [tabs]
  );

  const localFilterHits = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return [] as string[];
    const hits: string[] = [];
    for (const entries of Object.values(directories)) {
      for (const entry of entries) {
        if (!showHidden && (entry.hidden || entry.name.startsWith("."))) continue;
        if (entry.name.toLowerCase().includes(query)) hits.push(entry.path);
      }
    }
    return hits;
  }, [directories, filter, showHidden]);
  const visibleTreePaths = useMemo(() => {
    if (!filter.trim()) return null;
    return treeFilterPaths([...(treeFilterHits ?? []), ...localFilterHits]);
  }, [filter, localFilterHits, treeFilterHits]);
  const visibleEntries = useMemo(
    () =>
      flattenVisibleFileEntries(directories, {
        expanded,
        query: filter,
        showHidden,
        sort,
        keepPaths: visibleTreePaths
      }),
    [directories, expanded, filter, showHidden, sort, visibleTreePaths]
  );

  useEffect(() => {
    onDirtyCount?.(dirtyPaths.size);
  }, [dirtyPaths.size, onDirtyCount]);

  const loadDirectoryRef = useRef<(directory: string, force?: boolean) => Promise<FileEntry[]>>(
    async () => []
  );
  const loadDirectory = useCallback(
    async (directory: string, force = false) => {
      if (!force && directories[directory]) return directories[directory] ?? [];
      setLoading((current) => new Set(current).add(directory));
      setError("");
      try {
        const result = await api<DirectoryResult>(
          `/api/projects/${project.id}/files?path=${encodeURIComponent(directory)}`
        );
        setDirectories((current) => ({ ...current, [directory]: result.entries }));
        return result.entries;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return [];
      } finally {
        setLoading((current) => {
          const next = new Set(current);
          next.delete(directory);
          return next;
        });
      }
    },
    [directories, project.id]
  );
  loadDirectoryRef.current = loadDirectory;

  const refreshTree = useCallback(async () => {
    const paths = ["", ...[...expanded].filter(Boolean)];
    await Promise.all(paths.map((directory) => loadDirectory(directory, true)));
  }, [expanded, loadDirectory]);

  useEffect(() => {
    setExpanded(new Set([""]));
    setDirectories({});
    setOpeningPath(null);
    setActiveDirectory("");
    setSelectedPath(null);
    setCheckedPaths(new Set());
    lastCheckedPath.current = null;
    setMultiSelect(false);
    setPendingDelete(null);
    setTabs([]);
    setActivePath(null);
    setSearchResult(null);
    setFileLookup("");
    setFileLookupMode("tree");
    setTreeFilterHits(null);
    setMobilePane("tree");
    void loadDirectory("", true);
  }, [project.id]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (![...tabsRef.current].some((tab) => tab.draft !== tab.content)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      for (const tab of tabsRef.current) {
        if (isMediaPreview(tab.previewKind)) continue;
        try {
          const meta = await api<FileMeta>(
            `/api/projects/${project.id}/file/meta?path=${encodeURIComponent(tab.path)}`
          );
          if (!meta.revision || meta.revision === tab.revision) continue;
          if (tab.conflict?.revision === meta.revision) continue;
          const latest = await api<FilePreview>(
            `/api/projects/${project.id}/file?path=${encodeURIComponent(tab.path)}`
          );
          setTabs((current) =>
            current.map((item) => {
              if (item.path !== tab.path || item.revision === latest.revision) return item;
              if (item.draft === latest.content) {
                return {
                  ...item,
                  content: latest.content,
                  draft: latest.content,
                  revision: latest.revision,
                  size: latest.size,
                  writable: latest.writable,
                  conflict: null
                };
              }
              return { ...item, conflict: { revision: latest.revision, content: latest.content } };
            })
          );
        } catch {
          // Keep the open tab; the next poll or save will surface a durable error.
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 8000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [project.id]);

  useEffect(() => {
    const query = filter.trim();
    if (!query || searchQuery.trim()) {
      setTreeFilterHits(null);
      setFilterSearching(false);
      return;
    }
    setFilterSearching(true);
    const timer = window.setTimeout(() => {
      void api<FileSearchResult>(
        `/api/projects/${project.id}/files/search?q=${encodeURIComponent(query)}&content=false`
      )
        .then((result) => {
          const hits = result.matches.map((match) => match.path);
          setTreeFilterHits(hits);
          const directoriesToOpen = new Set<string>([""]);
          for (const hit of hits) {
            for (const ancestor of ancestorPaths(hit)) directoriesToOpen.add(ancestor);
          }
          setExpanded((current) => new Set([...current, ...directoriesToOpen]));
          for (const directory of directoriesToOpen) {
            void loadDirectoryRef.current(directory);
          }
        })
        .catch((reason) => {
          setTreeFilterHits([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => setFilterSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filter, project.id, searchQuery]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResult(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setError("");
    const timer = window.setTimeout(() => {
      void api<FileSearchResult>(
        `/api/projects/${project.id}/files/search?q=${encodeURIComponent(query)}&content=${
          searchContent ? "true" : "false"
        }`
      )
        .then((result) => setSearchResult(result))
        .catch((reason) => {
          setSearchResult({ query, truncated: false, scanned: 0, matches: [] });
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project.id, searchContent, searchQuery]);

  const updateTab = (path: string, patch: Partial<EditorTab> | ((tab: EditorTab) => EditorTab)) => {
    setTabs((current) =>
      current.map((tab) => {
        if (tab.path !== path) return tab;
        return typeof patch === "function" ? patch(tab) : { ...tab, ...patch };
      })
    );
  };

  const openPath = async (targetPath: string, line: number | null = null) => {
    if (!targetPath.trim()) {
      setError("无法打开：文件路径为空。");
      setMobilePane("editor");
      return;
    }
    const relativePath =
      toProjectRelativePath(targetPath, project.realPath) ??
      toProjectRelativePath(targetPath, project.displayPath);
    if (!relativePath) {
      setError("该文件不在当前项目目录内，无法打开。");
      setMobilePane("editor");
      return;
    }
    const existing = tabsRef.current.find((tab) => tab.path === relativePath);
    if (existing) {
      setActivePath(relativePath);
      setSelectedPath(relativePath);
      setMobilePane("editor");
      if (isMediaPreview(existing.previewKind)) {
        updateTab(relativePath, { mode: "preview", ...(line ? { line } : {}) });
      } else if (line) {
        updateTab(relativePath, { line, mode: "edit" });
      }
      return;
    }
    if (openingPath === relativePath) {
      setActivePath(relativePath);
      setSelectedPath(relativePath);
      setMobilePane("editor");
      return;
    }
    try {
      setOpeningPath(relativePath);
      setError("");
      const meta = await api<FileMeta>(
        `/api/projects/${project.id}/file/meta?path=${encodeURIComponent(relativePath)}`
      );
      const kind = previewKindFor(relativePath, meta.text);
      const tab = isMediaPreview(kind)
        ? tabFromMedia({
            path: meta.path,
            size: meta.size,
            revision: meta.revision ?? `${meta.mtimeMs}:${meta.size}`,
            writable: meta.writable,
            previewKind: kind
          })
        : tabFromPreview(
            await api<FilePreview>(
              `/api/projects/${project.id}/file?path=${encodeURIComponent(relativePath)}`
            ),
            line
          );
      setTabs((current) => [...current.filter((item) => item.path !== tab.path), tab]);
      setActivePath(tab.path);
      setSelectedPath(tab.path);
      setActiveDirectory(parentProjectPath(tab.path));
      setMobilePane("editor");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setMobilePane("editor");
    } finally {
      setOpeningPath(null);
    }
  };

  useEffect(() => {
    if (!openRequest?.path) return;
    let cancelled = false;
    void openPath(openRequest.path, openRequest.line).finally(() => {
      if (!cancelled) onOpened?.();
    });
    return () => {
      cancelled = true;
    };
  }, [openRequest]);

  useEffect(() => {
    if (!activeTab || isMediaPreview(activeTab.previewKind)) {
      setLanguage(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void api<LanguageAnalysis>(`/api/projects/${project.id}/language`, {
        method: "POST",
        body: JSON.stringify({ path: activeTab.path, content: activeTab.draft })
      })
        .then(setLanguage)
        .catch(() => setLanguage(null));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeTab?.draft, activeTab?.path, activeTab?.previewKind, project.id]);

  useEffect(() => {
    if (!editorCommand) return;
    if (editorCommand === "toggle-outline") setOutlineOpen((value) => !value);
    if (editorCommand === "goto-line") {
      setGoToLineValue(activeTab?.line ? String(activeTab.line) : "");
      setGoToLineOpen(true);
    }
    onCommandHandled?.();
  }, [activeTab?.line, editorCommand, onCommandHandled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        setGoToLineValue("");
        setGoToLineOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const requestDefinition = async (line: number, column: number) => {
    if (!activeTab || isMediaPreview(activeTab.previewKind)) return;
    try {
      const result = await api<LanguageAnalysis>(`/api/projects/${project.id}/language`, {
        method: "POST",
        body: JSON.stringify({
          path: activeTab.path,
          content: activeTab.draft,
          line,
          column
        })
      });
      setLanguage(result);
      if (result.definition) await openPath(result.definition.path, result.definition.line);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const closeTab = (path: string) => {
    const tab = tabs.find((item) => item.path === path);
    if (!tab) return;
    if (
      tab.draft !== tab.content &&
      !window.confirm(`${tab.path} 还有未保存的修改，确定关闭吗？`)
    ) {
      return;
    }
    const remaining = tabs.filter((item) => item.path !== path);
    setTabs(remaining);
    if (activePath === path) {
      setActivePath(remaining.at(-1)?.path ?? null);
      if (remaining.length === 0) setMobilePane("tree");
    }
  };

  const saveTab = async (path: string, overwriteConflict = false) => {
    const tab = tabsRef.current.find((item) => item.path === path);
    if (!tab || !tab.writable || savingPath) return;
    const draftSize = new TextEncoder().encode(tab.draft).byteLength;
    if (draftSize > MAX_EDITABLE_FILE_BYTES) {
      setError("文件超过 2 MB，缩小内容后再保存");
      return;
    }
    const revision = overwriteConflict && tab.conflict ? tab.conflict.revision : tab.revision;
    setSavingPath(path);
    setError("");
    try {
      const saved = await api<FilePreview>(`/api/projects/${project.id}/file`, {
        method: "PUT",
        body: JSON.stringify({ path: tab.path, content: tab.draft, revision })
      });
      updateTab(path, (current) => ({
        ...current,
        content: current.draft === tab.draft ? saved.content : current.content,
        draft: current.draft === tab.draft ? saved.content : current.draft,
        revision: saved.revision,
        size: saved.size,
        writable: saved.writable,
        conflict: null
      }));
      toast.success("文件已保存", { description: saved.path });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      if (message.includes("发生变化")) {
        try {
          const latest = await api<FilePreview>(
            `/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`
          );
          updateTab(path, { conflict: { revision: latest.revision, content: latest.content } });
        } catch {
          // The save error is already visible.
        }
      }
    } finally {
      setSavingPath(null);
    }
  };

  const applyAction = async (nextAction: FileAction, value: string) => {
    setWorking(nextAction.type);
    setError("");
    try {
      if (nextAction.type === "create-file" || nextAction.type === "create-directory") {
        const target = joinProjectPath(nextAction.directory, value);
        await api(`/api/projects/${project.id}/files`, {
          method: "POST",
          body: JSON.stringify({
            path: target,
            type: nextAction.type === "create-file" ? "file" : "directory"
          })
        });
        await loadDirectory(nextAction.directory, true);
        if (nextAction.type === "create-file") await openPath(target);
        toast.success(nextAction.type === "create-file" ? "已创建文件" : "已创建目录");
      } else if (nextAction.type === "rename") {
        const target = joinProjectPath(parentProjectPath(nextAction.entry.path), value);
        await api(`/api/projects/${project.id}/files/rename`, {
          method: "POST",
          body: JSON.stringify({ from: nextAction.entry.path, to: target })
        });
        await loadDirectory(parentProjectPath(nextAction.entry.path), true);
        setTabs((current) =>
          current.map((tab) =>
            tab.path === nextAction.entry.path ? { ...tab, path: target } : tab
          )
        );
        if (activePath === nextAction.entry.path) setActivePath(target);
        toast.success("已重命名");
      } else if (nextAction.type === "copy") {
        await api(`/api/projects/${project.id}/files/copy`, {
          method: "POST",
          body: JSON.stringify({ from: nextAction.entry.path, to: value })
        });
        await loadDirectory(parentProjectPath(value) || "", true);
        toast.success("已复制");
      } else {
        await api(`/api/projects/${project.id}/files/rename`, {
          method: "POST",
          body: JSON.stringify({ from: nextAction.entry.path, to: value })
        });
        await refreshTree();
        setTabs((current) =>
          current.map((tab) => (tab.path === nextAction.entry.path ? { ...tab, path: value } : tab))
        );
        if (activePath === nextAction.entry.path) setActivePath(value);
        toast.success("已移动");
      }
      setAction(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };

  const toggleCheckedPath = (path: string, options?: { range?: boolean }) => {
    setCheckedPaths((current) => {
      const next = new Set(current);
      if (options?.range && lastCheckedPath.current) {
        const order = visibleEntries.map((entry) => entry.path);
        const from = order.indexOf(lastCheckedPath.current);
        const to = order.indexOf(path);
        if (from >= 0 && to >= 0) {
          const start = Math.min(from, to);
          const end = Math.max(from, to);
          for (let index = start; index <= end; index += 1) {
            const item = order[index];
            if (item) next.add(item);
          }
          return next;
        }
      }
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    lastCheckedPath.current = path;
  };

  const deleteEntries = (paths: Iterable<string>) => {
    const compact = compactSelectedPaths(paths);
    if (!compact.length) return;
    setPendingDelete(compact);
  };

  const confirmDelete = async () => {
    const compact = pendingDelete;
    if (!compact?.length) return;
    setWorking("delete");
    setError("");
    try {
      const result = await api<{
        deleted: string[];
        failed: Array<{ path: string; message: string }>;
      }>(`/api/projects/${project.id}/files/delete`, {
        method: "POST",
        body: JSON.stringify({ paths: compact })
      });
      await refreshTree();
      const deleted = result.deleted ?? compact;
      const remaining = tabsRef.current.filter(
        (tab) => !deleted.some((path) => tab.path === path || tab.path.startsWith(`${path}/`))
      );
      setTabs(remaining);
      if (
        activePath &&
        deleted.some((path) => activePath === path || activePath.startsWith(`${path}/`))
      ) {
        setActivePath(remaining.at(-1)?.path ?? null);
        if (remaining.length === 0) setMobilePane("tree");
      }
      setCheckedPaths(new Set());
      lastCheckedPath.current = null;
      setPendingDelete(null);
      toast.success(`已删除 ${deleted.length} 项`);
      if (result.failed?.length) {
        setError(result.failed.map((item) => `${item.path}: ${item.message}`).join("\n"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };

  const deleteEntry = (entry: FileEntry) => {
    deleteEntries([entry.path]);
  };

  const uploadFiles = async (
    fileList: FileList | File[],
    directory = activeDirectory,
    overwrite = false
  ) => {
    const files = [...fileList];
    if (!files.length) return;
    setWorking("upload");
    setError("");
    try {
      for (const file of files) {
        const target = joinProjectPath(directory, file.name);
        await apiUpload(
          `/api/projects/${project.id}/files/upload?path=${encodeURIComponent(target)}&overwrite=${
            overwrite ? "true" : "false"
          }`,
          file
        );
      }
      await loadDirectory(directory, true);
      toast.success(`已上传 ${files.length} 个文件`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      if (message.includes("已存在") && files.length === 1 && !overwrite) {
        if (window.confirm(`${files[0]?.name} 已存在，覆盖吗？`)) {
          await uploadFiles(files, directory, true);
        }
      } else {
        toast.error("上传失败", { description: message });
      }
    } finally {
      setWorking(null);
    }
  };

  const downloadEntry = async (entry: FileEntry) => {
    if (entry.type === "directory") return;
    try {
      await apiDownload(
        `/api/projects/${project.id}/files/download?path=${encodeURIComponent(entry.path)}`,
        entry.name
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const toggle = (entry: FileEntry) => {
    if (entry.type !== "directory") return;
    setActiveDirectory(entry.path);
    setSelectedPath(entry.path);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!expanded.has(entry.path)) void loadDirectory(entry.path);
  };

  const collapseDirectory = (directory: string) => {
    setActiveDirectory(directory);
    if (directory) setSelectedPath(directory);
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of current) {
        if (!directory) {
          if (path) next.delete(path);
        } else if (path === directory || path.startsWith(`${directory}/`)) {
          next.delete(path);
        }
      }
      next.add("");
      return next;
    });
  };

  const expandDirectory = async (directory: string) => {
    setActiveDirectory(directory);
    if (directory) setSelectedPath(directory);
    setWorking("expand");
    try {
      const next = new Set(expanded);
      const queue = [directory];
      const seen = new Set<string>();
      while (queue.length > 0 && seen.size < 250) {
        const current = queue.shift() ?? "";
        if (seen.has(current)) continue;
        seen.add(current);
        next.add(current);
        const entries = await loadDirectoryRef.current(current);
        for (const entry of entries) {
          if (entry.type !== "directory") continue;
          if (!showHidden && (entry.hidden || entry.name.startsWith("."))) continue;
          queue.push(entry.path);
        }
      }
      setExpanded(next);
      if (queue.length > 0) {
        toast.message("已展开部分目录", { description: "子目录过多，已停止继续展开" });
      }
    } finally {
      setWorking(null);
    }
  };

  const renderMenu = (entry: FileEntry) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="file-tree-menu"
          aria-label={`${entry.name} 操作`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {entry.type !== "directory" && (
          <DropdownMenuItem onSelect={() => void openPath(entry.path)}>打开</DropdownMenuItem>
        )}
        {entry.type === "directory" ? (
          <>
            <DropdownMenuItem onSelect={() => void expandDirectory(entry.path)}>
              展开全部
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => collapseDirectory(entry.path)}>
              折叠全部
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onSelect={() =>
            setAction({
              type: "create-file",
              directory: entry.type === "directory" ? entry.path : parentProjectPath(entry.path)
            })
          }
        >
          新建文件
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            setAction({
              type: "create-directory",
              directory: entry.type === "directory" ? entry.path : parentProjectPath(entry.path)
            })
          }
        >
          新建目录
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setAction({ type: "rename", entry })}>
          重命名
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAction({ type: "copy", entry })}>
          复制
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAction({ type: "move", entry })}>
          移动
        </DropdownMenuItem>
        {entry.type !== "directory" && (
          <DropdownMenuItem onSelect={() => void downloadEntry(entry)}>下载</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void deleteEntry(entry)}>
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderDirectory = (directory: string, depth: number): ReactNode => {
    const entries = visibleFileEntries(directories[directory] ?? [], {
      query: filter,
      showHidden,
      sort,
      keepPaths: visibleTreePaths
    });
    return entries.map((entry) => {
      const isDirectory = entry.type === "directory";
      const isExpanded = expanded.has(entry.path);
      const isOpen = tabs.some((tab) => tab.path === entry.path);
      const isDirty = dirtyPaths.has(entry.path);
      const isActive = selectedPath === entry.path || activePath === entry.path;
      const isChecked = checkedPaths.has(entry.path);
      return (
        <div key={entry.path}>
          <div
            className={`file-tree-row ${isActive ? "active" : ""} ${multiSelect && isChecked ? "is-checked" : ""}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onContextMenu={(event) => {
              event.preventDefault();
              const trigger =
                event.currentTarget.querySelector<HTMLButtonElement>(".file-tree-menu");
              trigger?.click();
            }}
          >
            {multiSelect ? (
              <input
                type="checkbox"
                className="file-tree-check"
                checked={isChecked}
                aria-label={`选择 ${entry.name}`}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  toggleCheckedPath(entry.path, {
                    range: Boolean((event.nativeEvent as MouseEvent).shiftKey)
                  });
                }}
              />
            ) : null}
            <button
              type="button"
              className="file-tree-main"
              onPointerDown={(event) => {
                if (event.pointerType !== "touch") return;
                const trigger =
                  event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                    ".file-tree-menu"
                  );
                const timer = window.setTimeout(() => {
                  skipClickRef.current = true;
                  trigger?.click();
                }, 520);
                const clear = () => window.clearTimeout(timer);
                event.currentTarget.addEventListener("pointerup", clear, { once: true });
                event.currentTarget.addEventListener("pointercancel", clear, { once: true });
              }}
              onClick={(event) => {
                if (skipClickRef.current) {
                  skipClickRef.current = false;
                  return;
                }
                if (multiSelect && event.shiftKey) {
                  toggleCheckedPath(entry.path, { range: true });
                  setSelectedPath(entry.path);
                  return;
                }
                if (multiSelect && (event.metaKey || event.ctrlKey)) {
                  toggleCheckedPath(entry.path);
                  setSelectedPath(entry.path);
                  return;
                }
                setSelectedPath(entry.path);
                if (isDirectory) toggle(entry);
                else setActiveDirectory(parentProjectPath(entry.path));
              }}
              onDoubleClick={() => (isDirectory ? toggle(entry) : void openPath(entry.path))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (isDirectory) toggle(entry);
                  else void openPath(entry.path);
                }
                if (event.key === "F2") {
                  event.preventDefault();
                  setAction({ type: "rename", entry });
                }
                if (event.key === "Delete") {
                  event.preventDefault();
                  void deleteEntries(checkedPaths.size ? checkedPaths : [entry.path]);
                }
              }}
              title={isDirectory ? entry.path : "双击打开文件"}
            >
              <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
                {isDirectory ? (
                  isExpanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )
                ) : null}
              </span>
              {isDirectory ? (
                isExpanded ? (
                  <FolderOpen className="size-4 text-muted-foreground" />
                ) : (
                  <Folder className="size-4 text-muted-foreground" />
                )
              ) : openingPath === entry.path ? (
                <LoaderCircle className="size-4 animate-spin text-primary" />
              ) : (
                fileIcon(entry.name)
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {isDirty ? (
                <span className="size-1.5 rounded-full bg-amber-500" title="未保存" />
              ) : null}
              {!isDirectory && !isDirty && isOpen ? (
                <span className="size-1.5 rounded-full bg-primary/70" title="已打开" />
              ) : null}
            </button>
            {renderMenu(entry)}
          </div>
          {isDirectory && isExpanded && (
            <>
              {loading.has(entry.path) && (
                <div
                  className="flex h-8 items-center gap-2 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${42 + depth * 14}px` }}
                >
                  <LoaderCircle className="size-3 animate-spin" /> 读取中
                </div>
              )}
              {renderDirectory(entry.path, depth + 1)}
            </>
          )}
        </div>
      );
    });
  };

  const draftSize = activeTab ? new TextEncoder().encode(activeTab.draft).byteLength : 0;
  const tooLarge = draftSize > MAX_EDITABLE_FILE_BYTES;
  const dirty = Boolean(activeTab && activeTab.draft !== activeTab.content);

  return (
    <div
      className="files-workspace"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files);
      }}
    >
      <aside
        className={`files-tree-pane ${mobilePane === "editor" && tabs.length ? "hidden md:flex" : "flex"}`}
      >
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
          <button
            className="panel-icon-button !size-7"
            title="新建文件"
            onClick={() => setAction({ type: "create-file", directory: activeDirectory })}
          >
            <FilePlus className="size-3.5" />
          </button>
          <button
            className="panel-icon-button !size-7"
            title="新建目录"
            onClick={() => setAction({ type: "create-directory", directory: activeDirectory })}
          >
            <FolderPlus className="size-3.5" />
          </button>
          <button
            className="panel-icon-button !size-7"
            title="上传文件"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="size-3.5" />
          </button>
          <button
            className="panel-icon-button !size-7"
            title="刷新"
            onClick={() => void refreshTree()}
            disabled={Boolean(working)}
          >
            <RefreshCw className={`size-3.5 ${loading.has("") || working ? "animate-spin" : ""}`} />
          </button>
          <div className="file-tree-fold">
            <button
              type="button"
              title={`展开 ${activeDirectory || "项目根目录"}`}
              aria-label={`展开 ${activeDirectory || "项目根目录"}`}
              onClick={() => void expandDirectory(activeDirectory)}
              disabled={Boolean(working)}
            >
              <ChevronsDown className="size-3.5" />
            </button>
            <button
              type="button"
              title={`折叠 ${activeDirectory || "项目根目录"}`}
              aria-label={`折叠 ${activeDirectory || "项目根目录"}`}
              onClick={() => collapseDirectory(activeDirectory)}
              disabled={Boolean(working)}
            >
              <ChevronsUp className="size-3.5" />
            </button>
          </div>
          <span
            className="min-w-0 flex-1 truncate px-1 font-mono text-[10px] text-muted-foreground"
            title={project.displayPath}
          >
            {activeDirectory || project.displayPath}
          </span>
        </div>
        <div className="file-lookup">
          <div className="file-lookup-field">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="file-lookup-scope"
                  aria-label="查找范围"
                  title={lookupMode.hint}
                >
                  {fileLookupIcon(fileLookupMode, "size-3.5")}
                  <span>{lookupMode.label}</span>
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {FILE_LOOKUP_MODE_ORDER.map((id) => {
                  const mode = fileLookupMeta(id);
                  return (
                    <DropdownMenuItem
                      key={id}
                      className={cn("items-start", id === fileLookupMode && "bg-accent")}
                      onSelect={() => setFileLookupMode(id)}
                    >
                      {fileLookupIcon(id, "mt-0.5 size-3.5")}
                      <span className="flex min-w-0 flex-col">
                        <span>{mode.label}</span>
                        <span className="text-[11px] text-muted-foreground">{mode.hint}</span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              value={fileLookup}
              onChange={(event) => setFileLookup(event.target.value)}
              placeholder={
                fileLookupMode === "tree"
                  ? "过滤文件名"
                  : fileLookupMode === "content"
                    ? "搜索文件内容"
                    : "搜索文件名"
              }
              title={lookupMode.hint}
              aria-label={lookupMode.label}
              autoComplete="off"
              spellCheck={false}
            />
            {lookupBusy ? (
              <LoaderCircle className="file-lookup-status size-3.5 animate-spin" />
            ) : null}
            {fileLookup ? (
              <button
                type="button"
                className="file-lookup-clear"
                aria-label="清除查找"
                onClick={() => setFileLookup("")}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className="file-lookup-meta">
            {fileLookupMode === "tree" ? (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                    多选
                    <Switch
                      checked={multiSelect}
                      aria-label="多选文件"
                      onCheckedChange={(checked) => {
                        setMultiSelect(checked);
                        if (!checked) {
                          setCheckedPaths(new Set());
                          lastCheckedPath.current = null;
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={cn("file-lookup-option", !showHidden && "is-active")}
                    aria-pressed={!showHidden}
                    title="隐藏以 . 开头的文件"
                    onClick={() => setShowHidden((value) => !value)}
                  >
                    隐藏文件
                  </button>
                </div>
                <Select value={sort} onValueChange={(value) => setSort(value as FileSort)}>
                  <SelectTrigger size="sm" className="h-7 min-w-20" aria-label="排序方式">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">名称</SelectItem>
                    <SelectItem value="type">类型</SelectItem>
                    <SelectItem value="mtime">时间</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : (
              <span className="file-lookup-count">
                {!searchQuery.trim()
                  ? lookupMode.hint
                  : searching
                    ? "搜索中…"
                    : `${searchResult?.matches.length ?? 0} 个结果${
                        searchResult?.truncated ? " · 已截断" : ""
                      }`}
              </span>
            )}
          </div>
        </div>
        {multiSelect && checkedPaths.size ? (
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              已选 {checkedPaths.size} 项
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-8"
              onClick={() => {
                setCheckedPaths(new Set());
                lastCheckedPath.current = null;
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-8"
              disabled={Boolean(working)}
              onClick={() => void deleteEntries(checkedPaths)}
            >
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {searchQuery.trim() ? (
            <div className="px-1">
              {searching && !searchResult?.matches.length && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" /> 搜索中
                </div>
              )}
              {searchResult?.matches.map((match, index) => (
                <button
                  type="button"
                  key={`${match.kind}:${match.path}:${match.line ?? 0}:${index}`}
                  className="file-search-hit"
                  title={match.path}
                  onClick={() => {
                    if (match.type === "directory") {
                      setExpanded((current) => new Set(current).add(match.path));
                      setActiveDirectory(match.path);
                      setSelectedPath(match.path);
                      setFileLookup("");
                      setFileLookupMode("tree");
                      void loadDirectory(match.path);
                      return;
                    }
                    void openPath(match.path, match.line ?? null);
                  }}
                >
                  <span className="truncate font-medium">{fileName(match.path) || match.path}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {match.path}
                    {match.kind === "content" ? ` · L${match.line}` : ""}
                    {match.text ? ` · ${match.text}` : ""}
                  </span>
                </button>
              ))}
              {searchResult && searchResult.matches.length === 0 && !searching && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {error || "没有匹配结果"}
                </p>
              )}
              {searchResult?.truncated && (
                <p className="px-3 py-2 text-[10px] text-muted-foreground">
                  结果已截断，请缩小关键字
                </p>
              )}
            </div>
          ) : (
            <>
              {loading.has("") && !directories[""] && (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" /> 正在读取目录
                </div>
              )}
              {renderDirectory("", 0)}
              {filter.trim() &&
                !filterSearching &&
                (visibleTreePaths?.size ?? 0) === 0 &&
                (directories[""]?.length ?? 0) > 0 && (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    没有匹配的文件
                  </p>
                )}
              {filterSearching && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" /> 正在过滤文件树
                </div>
              )}
              {!loading.has("") && (directories[""]?.length ?? 0) === 0 && (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">目录为空</p>
              )}
            </>
          )}
        </div>
      </aside>
      <section
        className={`files-editor-pane ${mobilePane === "tree" && !activeTab ? "hidden md:flex" : "flex"}`}
        onKeyDownCapture={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (activePath) void saveTab(activePath);
          }
        }}
      >
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-1">
          <button
            type="button"
            className="panel-icon-button !size-7 md:hidden"
            title="返回文件树"
            onClick={() => setMobilePane("tree")}
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <div className="file-tab-bar">
            {tabs.map((tab) => {
              const tabDirty = tab.draft !== tab.content;
              return (
                <button
                  key={tab.path}
                  type="button"
                  className={`file-tab ${tab.path === activePath ? "active" : ""}`}
                  onClick={() => {
                    setActivePath(tab.path);
                    setMobilePane("editor");
                  }}
                  title={tab.path}
                >
                  {tabDirty ? <span className="size-1.5 rounded-full bg-amber-500" /> : null}
                  {!tab.writable ? (
                    <span className="text-[10px] text-muted-foreground">只读</span>
                  ) : null}
                  {tab.conflict ? <AlertTriangle className="size-3 text-amber-500" /> : null}
                  <span className="max-w-[9rem] truncate">{fileName(tab.path)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="grid size-4 place-items-center rounded hover:bg-muted"
                    aria-label={`关闭 ${fileName(tab.path)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.path);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        closeTab(tab.path);
                      }
                    }}
                  >
                    ×
                  </span>
                </button>
              );
            })}
          </div>
          {activeTab && (
            <div className="ml-auto flex shrink-0 items-center gap-1 pr-1">
              {!isMediaPreview(activeTab.previewKind) && (
                <Button
                  type="button"
                  size="sm"
                  variant={activeTab.mode === "edit" ? "secondary" : "ghost"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => updateTab(activeTab.path, { mode: "edit" })}
                >
                  <PencilLine className="size-3.5" /> 编辑
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={activeTab.mode === "preview" ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                onClick={() => updateTab(activeTab.path, { mode: "preview" })}
              >
                <Eye className="size-3.5" /> 预览
              </Button>
              {!isMediaPreview(activeTab.previewKind) && (
                <Button
                  type="button"
                  size="sm"
                  variant={activeTab.mode === "diff" ? "secondary" : "ghost"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => updateTab(activeTab.path, { mode: "diff" })}
                >
                  <GitCompare className="size-3.5" /> Diff
                </Button>
              )}
              <Button
                type="button"
                size="icon"
                variant={outlineOpen ? "secondary" : "ghost"}
                className="size-7"
                title="符号大纲"
                aria-label="符号大纲"
                onClick={() => setOutlineOpen((value) => !value)}
              >
                <ListTree className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                title="转到行"
                aria-label="转到行"
                onClick={() => {
                  setGoToLineValue("");
                  setGoToLineOpen(true);
                }}
              >
                <Hash className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant={activeTab.split ? "secondary" : "ghost"}
                className="size-7"
                title="左右分栏"
                onClick={() => updateTab(activeTab.path, { split: !activeTab.split })}
              >
                <Columns2 className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                title="下载"
                onClick={() =>
                  void downloadEntry({
                    name: fileName(activeTab.path),
                    path: activeTab.path,
                    type: "file"
                  })
                }
              >
                <Download className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={!activeTab.writable || !dirty || Boolean(savingPath) || tooLarge}
                onClick={() => void saveTab(activeTab.path)}
              >
                {savingPath === activeTab.path ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                保存
              </Button>
            </div>
          )}
        </div>
        {activeTab?.conflict && (
          <div className="file-conflict-banner">
            <AlertTriangle className="size-4 text-amber-500" />
            <p className="min-w-0 flex-1 text-xs">
              磁盘上的文件已变化。请选择加载磁盘版本、保留草稿覆盖，或先查看 Diff 再手动合并。
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() =>
                updateTab(activeTab.path, {
                  content: activeTab.conflict?.content ?? activeTab.content,
                  draft: activeTab.conflict?.content ?? activeTab.draft,
                  revision: activeTab.conflict?.revision ?? activeTab.revision,
                  conflict: null,
                  mode: "edit"
                })
              }
            >
              加载磁盘版本
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => void saveTab(activeTab.path, true)}
            >
              保留草稿并覆盖
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => updateTab(activeTab.path, { mode: "diff" })}
            >
              查看 Diff
            </Button>
          </div>
        )}
        {error && (
          <p className="mx-3 mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-600">{error}</p>
        )}
        {activeTab ? (
          <div className="flex min-h-0 flex-1">
            <div
              className={`min-h-0 min-w-0 flex-1 ${activeTab.split ? "grid md:grid-cols-2" : "flex flex-col"}`}
            >
              {!isMediaPreview(activeTab.previewKind) &&
                (activeTab.mode === "edit" || activeTab.split) && (
                  <div className="min-h-0 min-w-0 overflow-hidden">
                    <Suspense
                      fallback={
                        <div className="grid h-full place-items-center text-xs text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <LoaderCircle className="size-4 animate-spin" /> 正在加载编辑器
                          </span>
                        </div>
                      }
                    >
                      <FileCodeEditor
                        value={activeTab.draft}
                        path={activeTab.path}
                        theme={resolvedTheme}
                        editable={activeTab.writable && savingPath !== activeTab.path}
                        line={activeTab.line}
                        diagnostics={language?.diagnostics ?? []}
                        onDefinitionRequest={(line, column) => void requestDefinition(line, column)}
                        onChange={(value) =>
                          updateTab(activeTab.path, { draft: value, line: null })
                        }
                      />
                    </Suspense>
                  </div>
                )}
              {(activeTab.mode === "preview" || activeTab.split) && (
                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-auto border-t border-border md:border-l md:border-t-0">
                  <FilePreviewPane tab={activeTab} theme={resolvedTheme} projectId={project.id} />
                </div>
              )}
              {activeTab.mode === "diff" && !activeTab.split && (
                <GitDiffView diff={activeDiff} path={activeTab.path} fill />
              )}
            </div>
            {outlineOpen && !isMediaPreview(activeTab.previewKind) ? (
              <aside className="hidden w-56 shrink-0 overflow-auto border-l border-border bg-muted/20 p-2 md:block">
                <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  大纲
                </p>
                {language?.symbols.length ? (
                  <SymbolTree
                    symbols={language.symbols}
                    onOpen={(line) => updateTab(activeTab.path, { line, mode: "edit" })}
                  />
                ) : (
                  <p className="px-2 text-xs text-muted-foreground">当前文件没有可识别的符号。</p>
                )}
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground">
            <div>
              <FileCode2 className="mx-auto mb-3 size-10" />
              <p className="text-sm font-medium text-foreground">打开一个文件开始编辑</p>
              <p className="mt-1 text-xs">
                双击文件，或用搜索跳到匹配行。支持多 Tab、未保存标记和磁盘冲突提示。
              </p>
            </div>
          </div>
        )}
        {problemsOpen && (language?.diagnostics.length ?? 0) > 0 ? (
          <div className="max-h-36 overflow-auto border-t border-border bg-muted/20">
            {language?.diagnostics.map((item, index) => (
              <button
                key={`${item.line}:${item.column}:${index}`}
                type="button"
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted"
                onClick={() =>
                  activeTab && updateTab(activeTab.path, { line: item.line, mode: "edit" })
                }
              >
                <CircleAlert
                  className={`mt-0.5 size-3.5 ${item.severity === "error" ? "text-destructive" : "text-amber-500"}`}
                />
                <span className="min-w-0 flex-1">
                  {item.message}
                  <span className="ml-2 text-muted-foreground">
                    {item.line}:{item.column} · {item.source}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 text-[11px] text-muted-foreground">
          <span className={tooLarge ? "text-destructive" : undefined}>
            {!activeTab
              ? "尚未打开文件"
              : !activeTab.writable
                ? "当前文件只读"
                : tooLarge
                  ? "内容超过 2 MB 保存上限"
                  : dirty
                    ? "有未保存的修改"
                    : activeTab.conflict
                      ? "磁盘版本与草稿不一致"
                      : "已与磁盘同步"}
          </span>
          <div className="flex items-center gap-3">
            {language?.diagnostics.length ? (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => setProblemsOpen((value) => !value)}
              >
                {language.diagnostics.filter((item) => item.severity === "error").length} 错误 ·{" "}
                {language.diagnostics.filter((item) => item.severity !== "error").length} 警告
              </button>
            ) : (
              <span className="hidden sm:inline">无诊断</span>
            )}
            <span className="hidden sm:inline">
              Ctrl/⌘ + S 保存 · Ctrl/⌘ + G 转到行 · Ctrl/⌘ + 点击跳转
            </span>
          </div>
        </div>
      </section>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/70 text-sm font-medium">
          松开以上传到 {activeDirectory || "项目根目录"}
        </div>
      )}
      <input
        ref={uploadRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => {
          if (event.target.files) void uploadFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <NameDialog
        action={action}
        onClose={() => setAction(null)}
        onSubmit={(value) => action && void applyAction(action, value)}
      />
      <Dialog
        open={Boolean(pendingDelete?.length)}
        onOpenChange={(open) => {
          if (!open && working !== "delete") setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              {pendingDelete ? deleteConfirmDescription(pendingDelete, directories) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              disabled={working === "delete"}
              onClick={() => setPendingDelete(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={working === "delete"}
              onClick={() => void confirmDelete()}
            >
              {working === "delete" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={goToLineOpen} onOpenChange={setGoToLineOpen}>
        <DialogContent className="max-w-sm" showCloseButton>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = Number(goToLineValue.trim());
              if (!activeTab || !Number.isInteger(next) || next < 1) return;
              updateTab(activeTab.path, { line: next, mode: "edit" });
              setGoToLineOpen(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>转到行</DialogTitle>
              <DialogDescription>跳到当前文件的指定行号。</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              className="mt-4"
              inputMode="numeric"
              value={goToLineValue}
              placeholder="行号"
              onChange={(event) => setGoToLineValue(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setGoToLineOpen(false)}>
                取消
              </Button>
              <Button type="submit">跳转</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ProjectFilesPanel({
  project,
  view,
  onViewChange,
  openFileRequest,
  editorCommand,
  focusCommit,
  onDirtyCount,
  onGitCount,
  onCommandHandled
}: {
  project: Project;
  view: ProjectResourceView;
  onViewChange?: (view: ProjectResourceView) => void;
  openFileRequest?: { path: string; line: number | null } | null | undefined;
  editorCommand?: "goto-line" | "toggle-outline" | null | undefined;
  focusCommit?: string | null | undefined;
  onDirtyCount?: ((count: number) => void) | undefined;
  onGitCount?: ((count: number) => void) | undefined;
  onCommandHandled?: (() => void) | undefined;
}) {
  const [openRequest, setOpenRequest] = useState<{ path: string; line: number | null } | null>(
    openFileRequest ?? null
  );
  useEffect(() => {
    if (!openFileRequest?.path) return;
    setOpenRequest(openFileRequest);
  }, [openFileRequest]);
  return (
    <section className="files-panel relative flex h-full w-full min-w-0 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className={view === "git" ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <FilesWorkspace
          project={project}
          openRequest={openRequest}
          editorCommand={editorCommand}
          onOpened={() => setOpenRequest(null)}
          onCommandHandled={onCommandHandled}
          onDirtyCount={onDirtyCount}
        />
      </div>
      <div className={view === "git" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <GitPanel
          project={project}
          focusCommit={focusCommit}
          onChangeCount={onGitCount}
          onOpenFile={(path, line) => {
            setOpenRequest({ path, line });
            onViewChange?.("files");
          }}
        />
      </div>
    </section>
  );
}
