import {
  Children,
  isValidElement,
  memo,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Copy,
  Download,
  FileCode2,
  FilePlus,
  GitFork,
  Image,
  Info,
  Keyboard,
  Link2,
  ListChecks,
  LoaderCircle,
  Pencil,
  Quote,
  RotateCcw,
  ScrollText,
  SquareTerminal,
  Star,
  StickyNote,
  TextSelect,
  User,
  Wrench,
  ShieldQuestion,
  type LucideIcon
} from "lucide-react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useTheme } from "@/context/theme-provider";
import { formatDateTime, formatMessageTime } from "@/lib/utils";
import {
  classifyRuntimeNotice,
  collabCardDetails,
  collabToolLabel,
  isCollabTool,
  isCommandTool,
  isCompactionTool,
  isPlanTool,
  isRuntimePlaceholder,
  isUserInputTool,
  isViewImageTool,
  isWriteStdinTool,
  parsePlanItems,
  parseUserInputQuestions,
  toolCallOutput,
  toolCallRequest,
  toolCallTitle,
  viewImagePath,
  writeStdinDetails
} from "@/lib/tool-event";
import type { TimelineItem } from "@/types";
import { GitDiffView } from "./GitDiffView";
import { MermaidBlock } from "./MermaidBlock";
import { VirtualLog } from "./VirtualLog";
import { fileChangeEntries } from "./file-change";
import { toProjectRelativePath } from "./file-workspace";
import {
  downloadTextFile,
  linkFileRefs,
  parseCodexFileHref,
  snippetFileName
} from "./markdown-refs";

function EventTime({ value, className }: { value: number; className?: string }) {
  return (
    <time
      className={["event-time", className].filter(Boolean).join(" ")}
      dateTime={new Date(value).toISOString()}
      title={formatDateTime(value)}
    >
      {formatMessageTime(value)}
    </time>
  );
}

function CollapseIcon({ open }: { open: boolean }) {
  return (
    <span className="collapse-icon" aria-hidden="true">
      <ChevronRight className={`transition-transform ${open ? "rotate-90" : ""}`} />
    </span>
  );
}

type CopyButtonVariant = "message" | "code" | "tool";

function CopyButton({ text, variant = "tool" }: { text: string; variant?: CopyButtonVariant }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    []
  );
  const label = variant === "message" ? "复制整条消息" : variant === "code" ? "复制代码" : "复制";
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      className={variant === "tool" ? "tool-copy-btn" : `copy-button copy-button-${variant}`}
      aria-label={copied ? `${label}成功` : label}
      title={copied ? "已复制" : label}
      disabled={!text}
      onClick={(event) => {
        event.stopPropagation();
        void copyTextToClipboard(text).then((success) => {
          if (!success) return;
          setCopied(true);
          if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
          resetTimer.current = window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      <Icon aria-hidden="true" />
      {variant !== "message" ? <span>{copied ? "已复制" : "复制"}</span> : null}
    </button>
  );
}

function reactNodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child))
        return reactNodeText(child.props.children);
      return "";
    })
    .join("");
}

function hastNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { value?: unknown; children?: unknown[] };
  if (typeof value.value === "string") return value.value;
  return Array.isArray(value.children) ? value.children.map(hastNodeText).join("") : "";
}

function codeLanguage(children: ReactNode) {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ className?: string }>(child)) continue;
    const match = /(?:^|\s)language-([^\s]+)/.exec(child.props.className ?? "");
    if (match?.[1]) return match[1];
  }
  return "代码";
}

const PRISM_LANGUAGE: Record<string, Language> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  tsx: "tsx",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  python: "python",
  json: "json",
  css: "css",
  html: "markup",
  xml: "markup",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  diff: "diff",
  go: "go",
  sql: "sql"
};

function MarkdownCodeBlock({
  children,
  node,
  onCreateFile
}: ComponentProps<"pre"> &
  ExtraProps & { onCreateFile?: ((content: string, language: string) => void) | undefined }) {
  const { resolvedTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const code = (hastNodeText(node) || reactNodeText(children)).replace(/\n$/, "");
  const language = codeLanguage(children);
  const lines = code.split("\n");
  const collapsed = lines.length > 24 && !expanded;
  const shown = collapsed ? lines.slice(0, 24).join("\n") : code;
  const compactSingleLine = lines.length === 1 && code.length <= 160;
  if (language.toLowerCase() === "mermaid") {
    return (
      <div className="markdown-code-block mermaid-code-block">
        <div className="markdown-code-head">
          <span className="markdown-code-language">mermaid</span>
          <CopyButton text={code} variant="code" />
        </div>
        <MermaidBlock code={code} />
      </div>
    );
  }
  if (compactSingleLine) {
    return (
      <div className="markdown-code-inline-block">
        <code>{code}</code>
        <CopyButton text={code} variant="code" />
      </div>
    );
  }
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span className="markdown-code-language">{language}</span>
        <span className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{lines.length} 行</span>
          {lines.length > 24 ? (
            <button
              type="button"
              className="copy-button copy-button-code"
              onClick={() => setExpanded((value) => !value)}
            >
              {collapsed ? `展开 ${lines.length} 行` : "收起"}
            </button>
          ) : null}
          <button
            type="button"
            className="copy-button copy-button-code"
            aria-label="下载代码"
            onClick={() => downloadTextFile(snippetFileName(language), code)}
          >
            <Download className="size-3" />
            下载
          </button>
          {onCreateFile ? (
            <button
              type="button"
              className="copy-button copy-button-code"
              aria-label="在项目中创建文件"
              title="在项目中创建文件"
              onClick={() => onCreateFile(code, language)}
            >
              <FilePlus className="size-3" />
              创建
            </button>
          ) : null}
          <CopyButton text={code} variant="code" />
        </span>
      </div>
      <Highlight
        theme={resolvedTheme === "dark" ? themes.oneDark : themes.oneLight}
        code={shown}
        language={PRISM_LANGUAGE[language.toLowerCase()] ?? "markup"}
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={className} style={style}>
            {tokens.map((line, lineIndex) => (
              <div key={lineIndex} {...getLineProps({ line })}>
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

function hasMarkdownMath(text: string) {
  return /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\[|\\\(/.test(text);
}

const MarkdownContent = memo(function MarkdownContent({
  text,
  streaming = false,
  onOpenFile,
  onCreateFile
}: {
  text: string;
  streaming?: boolean | undefined;
  onOpenFile?: ((path: string, line: number | null) => void) | undefined;
  onCreateFile?: ((content: string, language: string) => void) | undefined;
}) {
  const components = useMemo<Components>(
    () => ({
      pre: streaming
        ? ({ children }) => <pre className="markdown-stream-pre">{children}</pre>
        : (props) => <MarkdownCodeBlock {...props} onCreateFile={onCreateFile} />,
      a: ({ href, children }) => {
        const file = parseCodexFileHref(href);
        if (file && onOpenFile) {
          return (
            <button
              type="button"
              className="file-ref-link"
              onClick={() => onOpenFile(file.path, file.line)}
            >
              {children}
            </button>
          );
        }
        return <a href={href}>{children}</a>;
      }
    }),
    [onCreateFile, onOpenFile, streaming]
  );
  const enableMath = !streaming && hasMarkdownMath(text);
  const source = streaming && text.length > 24_000 ? text.slice(text.length - 24_000) : text;
  return (
    <ReactMarkdown
      remarkPlugins={enableMath ? [remarkGfm, remarkMath] : [remarkGfm]}
      rehypePlugins={enableMath ? [rehypeKatex] : []}
      urlTransform={(url) => url}
      components={components}
    >
      {linkFileRefs(source)}
    </ReactMarkdown>
  );
});

function ToolSection({
  icon: Icon,
  label,
  text,
  variant
}: {
  icon: LucideIcon;
  label: string;
  text: string;
  variant: "request" | "output";
}) {
  return (
    <section className={`tool-shell${variant === "output" ? " tool-shell-output" : ""}`}>
      <header className="tool-shell-head">
        <span className="tool-label">
          <Icon className="size-4" />
          {label}
        </span>
        <CopyButton text={text} />
      </header>
      {variant === "output" || text.length > 4000 || text.split("\n").length >= 80 ? (
        <VirtualLog text={text} label={label} />
      ) : (
        <pre className="tool-shell-body">{text}</pre>
      )}
    </section>
  );
}

function PlanCard({ data }: { data: unknown }) {
  const items = parsePlanItems(data);
  return (
    <div className="plan-card">
      {items.length ? (
        <ul className="plan-card-list">
          {items.map((item, index) => (
            <li key={`${item.text}-${index}`} className={`plan-card-item is-${item.status}`}>
              {item.status === "completed" ? (
                <Check className="size-3.5" />
              ) : item.status === "in_progress" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <span className="plan-card-dot" />
              )}
              <span className="plan-card-text">{item.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="plan-card-empty">暂无计划步骤。</p>
      )}
    </div>
  );
}

function CollabCard({
  data,
  onOpenThread
}: {
  data: unknown;
  onOpenThread?: ((threadId: string) => boolean | void) | undefined;
}) {
  const details = collabCardDetails(data);
  if (!details.prompt && !details.receivers.length && !details.result) return null;
  return (
    <div className="plan-card">
      {details.receivers.length ? (
        <div className="flex flex-wrap gap-1.5">
          {details.receivers.map((threadId) => (
            <button
              key={threadId}
              type="button"
              className="h-8 max-w-full truncate rounded-lg border border-border bg-card px-2.5 font-mono text-xs text-muted-foreground"
              title={onOpenThread ? "打开子代理线程" : "复制线程 ID"}
              onClick={() => {
                if (!onOpenThread?.(threadId)) void copyTextToClipboard(threadId);
              }}
            >
              {threadId}
            </button>
          ))}
        </div>
      ) : null}
      {details.prompt ? <p className="plan-card-prompt">{details.prompt}</p> : null}
      {details.result && details.result !== details.prompt ? (
        <p className="plan-card-prompt">{details.result}</p>
      ) : null}
    </div>
  );
}

function projectImageSrc(
  projectId: string | undefined,
  path: string,
  projectPath?: string | undefined
) {
  if (!projectId || !path) return "";
  const relative = toProjectRelativePath(path, projectPath);
  if (!relative) return "";
  return `/api/projects/${encodeURIComponent(projectId)}/files/download?path=${encodeURIComponent(relative)}&inline=1`;
}

function ViewImageCard({
  path,
  projectId,
  projectPath,
  onOpenFile
}: {
  path: string;
  projectId?: string | undefined;
  projectPath?: string | undefined;
  onOpenFile?: ((path: string, line: number | null) => void) | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const src = projectImageSrc(projectId, path, projectPath);
  const name = path.split("/").filter(Boolean).at(-1) || path;
  const openPath = toProjectRelativePath(path, projectPath) ?? path;
  return (
    <div className="plan-card">
      {src && !failed ? (
        <img src={src} alt={name} className="notice-image" onError={() => setFailed(true)} />
      ) : null}
      <p className="plan-card-prompt font-mono text-xs text-muted-foreground">{path}</p>
      {onOpenFile ? (
        <button
          type="button"
          className="h-8 self-start rounded-lg border border-border bg-card px-3 text-xs disabled:opacity-50"
          disabled={!openPath.trim()}
          onClick={() => {
            if (openPath.trim()) onOpenFile(openPath, null);
          }}
        >
          在文件中打开
        </button>
      ) : null}
    </div>
  );
}

function UserInputCard({
  data,
  onReply
}: {
  data: unknown;
  onReply?: ((text: string) => void) | undefined;
}) {
  const questions = parseUserInputQuestions(data);
  if (!questions.length) return <p className="plan-card-empty">暂无选项。</p>;
  return (
    <div className="plan-card">
      {questions.map((question) => (
        <section key={question.id || question.question} className="space-y-2">
          {question.header ? (
            <p className="text-xs font-medium text-muted-foreground">{question.header}</p>
          ) : null}
          <p className="plan-card-prompt">{question.question}</p>
          <div className="flex flex-col gap-1.5">
            {question.options.map((option) => (
              <button
                key={option.label}
                type="button"
                className="h-auto min-h-8 rounded-lg border border-border bg-card px-3 py-1.5 text-left text-xs"
                onClick={() => {
                  const answer = option.label;
                  if (onReply) onReply(answer);
                  else void copyTextToClipboard(answer);
                }}
              >
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block text-muted-foreground">{option.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function NoticeCard({ message, level }: { message: string; level: "info" | "warning" | "error" }) {
  return <p className={`notice-card-body${level === "error" ? " is-error" : ""}`}>{message}</p>;
}

type EventCardProps = {
  item: TimelineItem;
  providerName?: string | undefined;
  defaultOpen?: boolean;
  hidden?: boolean;
  showProviderLabel?: boolean;
  highlighted?: boolean | undefined;
  projectId?: string | undefined;
  projectPath?: string | undefined;
  onApproval?: (requestId: string, decision: "accept" | "acceptForSession" | "decline") => void;
  onFork?: (() => void) | undefined;
  onOpenFile?: ((path: string, line: number | null) => void) | undefined;
  onOpenThread?: ((threadId: string) => boolean | void) | undefined;
  onReply?: ((text: string) => void) | undefined;
  onEdit?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onQuote?: (() => void) | undefined;
  onCopyLink?: (() => void) | undefined;
  onCreateFile?: ((content: string, language: string) => void) | undefined;
  starred?: boolean | undefined;
  onStar?: (() => void) | undefined;
  onSaveNote?: (() => void) | undefined;
  onSummarize?: (() => void) | undefined;
};

function sameHandler<T>(left: T | undefined, right: T | undefined) {
  return Boolean(left) === Boolean(right);
}

function areEventCardPropsEqual(prev: EventCardProps, next: EventCardProps) {
  return (
    prev.item.id === next.item.id &&
    prev.item.kind === next.item.kind &&
    prev.item.text === next.item.text &&
    prev.item.streaming === next.item.streaming &&
    prev.item.providerId === next.item.providerId &&
    prev.item.messageId === next.item.messageId &&
    prev.item.createdAt === next.item.createdAt &&
    prev.item.data === next.item.data &&
    prev.highlighted === next.highlighted &&
    prev.defaultOpen === next.defaultOpen &&
    prev.hidden === next.hidden &&
    prev.showProviderLabel === next.showProviderLabel &&
    prev.providerName === next.providerName &&
    prev.projectId === next.projectId &&
    prev.projectPath === next.projectPath &&
    prev.starred === next.starred &&
    sameHandler(prev.onApproval, next.onApproval) &&
    sameHandler(prev.onFork, next.onFork) &&
    sameHandler(prev.onOpenFile, next.onOpenFile) &&
    sameHandler(prev.onOpenThread, next.onOpenThread) &&
    sameHandler(prev.onReply, next.onReply) &&
    sameHandler(prev.onEdit, next.onEdit) &&
    sameHandler(prev.onRetry, next.onRetry) &&
    sameHandler(prev.onQuote, next.onQuote) &&
    sameHandler(prev.onCopyLink, next.onCopyLink) &&
    sameHandler(prev.onCreateFile, next.onCreateFile) &&
    sameHandler(prev.onStar, next.onStar) &&
    sameHandler(prev.onSaveNote, next.onSaveNote) &&
    sameHandler(prev.onSummarize, next.onSummarize)
  );
}

function EventCardComponent({
  item,
  providerName,
  defaultOpen = true,
  hidden = false,
  showProviderLabel = true,
  highlighted = false,
  projectId,
  projectPath,
  onApproval,
  onFork,
  onOpenFile,
  onOpenThread,
  onReply,
  onEdit,
  onRetry,
  onQuote,
  onCopyLink,
  onCreateFile,
  starred,
  onStar,
  onSaveNote,
  onSummarize
}: EventCardProps) {
  const notice = classifyRuntimeNotice(item.data, item.text, item.kind);
  const [open, setOpen] = useState(() => {
    if (item.kind === "reasoning") return defaultOpen;
    if (isRuntimePlaceholder(item.data, item.text)) return false;
    if (notice && notice.level !== "error") return false;
    if (item.kind === "tool" && isWriteStdinTool(item.data))
      return Boolean(writeStdinDetails(item.data).text);
    if (
      item.kind === "tool" &&
      (isPlanTool(item.data) ||
        isCollabTool(item.data) ||
        isUserInputTool(item.data) ||
        isViewImageTool(item.data))
    )
      return true;
    return defaultOpen;
  });
  if (hidden) return null;
  if (isRuntimePlaceholder(item.data, item.text)) return null;
  const highlightClass = highlighted ? " is-highlighted" : "";
  if (item.kind === "user")
    return (
      <article data-message-id={item.id} className={`event-card event-card-user${highlightClass}`}>
        <header className="event-title message-event-title min-w-0">
          <User className="size-4" />
          <span>你</span>
          {showProviderLabel && providerName && (
            <span className="provider-pill max-w-40 truncate">{providerName}</span>
          )}
          {item.createdAt ? <EventTime value={item.createdAt} className="ml-auto" /> : null}
          <span className="message-actions">
            {onEdit ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="编辑并重新发送"
                title="编辑并重新发送"
                onClick={onEdit}
              >
                <Pencil aria-hidden="true" />
              </button>
            ) : null}
            {onRetry ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="重试本 turn"
                title="重试本 turn"
                onClick={onRetry}
              >
                <RotateCcw aria-hidden="true" />
              </button>
            ) : null}
            {onQuote ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="引用到输入框"
                title="引用到输入框"
                onClick={onQuote}
              >
                <Quote aria-hidden="true" />
              </button>
            ) : null}
            {onFork ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="从此处分叉"
                title="从此处分叉"
                onClick={onFork}
              >
                <GitFork aria-hidden="true" />
              </button>
            ) : null}
            {onCopyLink ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="复制消息链接"
                title="复制消息链接"
                onClick={onCopyLink}
              >
                <Link2 aria-hidden="true" />
              </button>
            ) : null}
            {onStar ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label={starred ? "取消收藏" : "收藏消息"}
                title={starred ? "取消收藏" : "收藏消息"}
                onClick={onStar}
              >
                <Star
                  aria-hidden="true"
                  className={starred ? "fill-amber-400 text-amber-400" : ""}
                />
              </button>
            ) : null}
            {onSaveNote ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="标记为项目笔记"
                title="标记为项目笔记"
                onClick={onSaveNote}
              >
                <StickyNote aria-hidden="true" />
              </button>
            ) : null}
            {onSummarize ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="生成摘要"
                title="生成摘要"
                onClick={onSummarize}
              >
                <TextSelect aria-hidden="true" />
              </button>
            ) : null}
            <CopyButton text={item.text ?? ""} variant="message" />
          </span>
        </header>
        <div className="markdown">
          <MarkdownContent
            text={item.text ?? ""}
            streaming={item.streaming}
            onOpenFile={onOpenFile}
            onCreateFile={onCreateFile}
          />
        </div>
      </article>
    );
  if (item.kind === "assistant")
    return (
      <article data-message-id={item.id} className={`event-card event-card-bot${highlightClass}`}>
        <header className="event-title message-event-title min-w-0">
          <Bot className="size-4" />
          <span>Codex</span>
          {showProviderLabel && providerName && (
            <span className="provider-pill max-w-40 truncate">{providerName}</span>
          )}
          {item.streaming && <span className="stream-dot" />}
          {item.createdAt ? <EventTime value={item.createdAt} className="ml-auto" /> : null}
          <span className="message-actions">
            {onQuote ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="引用到输入框"
                title="引用到输入框"
                onClick={onQuote}
              >
                <Quote aria-hidden="true" />
              </button>
            ) : null}
            {onCopyLink ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="复制消息链接"
                title="复制消息链接"
                onClick={onCopyLink}
              >
                <Link2 aria-hidden="true" />
              </button>
            ) : null}
            {onStar ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label={starred ? "取消收藏" : "收藏消息"}
                title={starred ? "取消收藏" : "收藏消息"}
                onClick={onStar}
              >
                <Star
                  aria-hidden="true"
                  className={starred ? "fill-amber-400 text-amber-400" : ""}
                />
              </button>
            ) : null}
            {onSaveNote ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="标记为项目笔记"
                title="标记为项目笔记"
                onClick={onSaveNote}
              >
                <StickyNote aria-hidden="true" />
              </button>
            ) : null}
            {onSummarize ? (
              <button
                type="button"
                className="copy-button copy-button-message"
                aria-label="生成摘要"
                title="生成摘要"
                onClick={onSummarize}
              >
                <TextSelect aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              className="copy-button copy-button-message"
              aria-label="导出消息"
              title="导出消息"
              onClick={() => downloadTextFile(`${item.id}.md`, item.text ?? "")}
            >
              <Download aria-hidden="true" />
            </button>
            <CopyButton text={item.text ?? ""} variant="message" />
          </span>
        </header>
        <div className="markdown">
          <MarkdownContent
            text={item.text ?? ""}
            streaming={item.streaming}
            onOpenFile={onOpenFile}
            onCreateFile={onCreateFile}
          />
        </div>
      </article>
    );
  if (item.kind === "approval")
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot border-amber-300/70 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/20${highlightClass}`}
      >
        <header className="event-title min-w-0">
          <ShieldQuestion className="size-4 text-amber-600" />
          <span>等待操作确认</span>
          {item.createdAt ? <EventTime value={item.createdAt} className="ml-auto" /> : null}
        </header>
        <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-200">
          {item.data?.command ?? item.text}
        </pre>
        {item.data?.status && item.data.status !== "pending" ? (
          <p className="text-xs font-medium text-muted-foreground">
            {item.data.status === "declined"
              ? "已拒绝该命令"
              : item.data.status === "cancelled"
                ? "确认已取消"
                : item.data.status === "expired"
                  ? "确认请求已过期"
                  : "已允许该命令"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white"
              onClick={() => onApproval?.(item.data.approvalId, "accept")}
            >
              本次允许
            </button>
            <button
              className="rounded-lg border bg-card px-3 py-2 text-xs font-medium"
              onClick={() => onApproval?.(item.data.approvalId, "acceptForSession")}
            >
              本会话允许
            </button>
            <button
              className="rounded-lg border border-red-200 bg-card px-3 py-2 text-xs font-medium text-red-600"
              onClick={() => onApproval?.(item.data.approvalId, "decline")}
            >
              拒绝
            </button>
          </div>
        )}
      </article>
    );
  if (item.kind === "activity") {
    const groupedItems = Array.isArray(item.data?.items) ? (item.data.items as TimelineItem[]) : [];
    const toolCount = groupedItems.filter((entry) => entry.kind === "tool").length;
    const fileCount = groupedItems.filter((entry) => entry.kind === "file").length;
    const labels = groupedItems
      .map((entry) =>
        entry.kind === "file"
          ? fileChangeEntries(entry.data, entry.text)
              .map((entry) => entry.path)
              .join(", ")
          : toolCallTitle(entry.data)
      )
      .filter(Boolean)
      .slice(0, 3);
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className="icon-muted">
            <Wrench />
          </span>
          <span className="min-w-0 truncate">执行过程</span>
          <span className="text-xs text-muted-foreground">
            {toolCount ? `${toolCount} 个工具` : ""}
            {toolCount && fileCount ? " · " : ""}
            {fileCount ? `${fileCount} 个文件变更` : ""}
          </span>
          {item.streaming ? <span className="stream-dot" /> : null}
        </button>
        {open ? (
          <div className="space-y-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
            {labels.map((label, index) => (
              <p key={`${label}-${index}`} className="truncate">
                {label}
              </p>
            ))}
            {groupedItems.length > labels.length ? (
              <p>还有 {groupedItems.length - labels.length} 项</p>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }
  const isTool = item.kind === "tool";
  if (notice) {
    const failed = notice.level === "error";
    const Icon = failed ? CircleAlert : Info;
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact notice-card${failed ? " is-error" : ""}${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className={`icon-muted${failed ? " text-red-500" : ""}`}>
            <Icon />
          </span>
          <span className="min-w-0 truncate">{notice.title}</span>
          {!open ? (
            <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
              {notice.message}
            </span>
          ) : null}
          {item.createdAt ? <EventTime value={item.createdAt} className="ml-auto" /> : null}
        </button>
        {open ? <NoticeCard message={notice.message} level={notice.level} /> : null}
      </article>
    );
  }
  if (isTool && isUserInputTool(item.data)) {
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className="icon-muted">
            <CircleHelp />
          </span>
          <span className="min-w-0 truncate">需要你选择</span>
          {item.createdAt ? <EventTime value={item.createdAt} className="ml-auto" /> : null}
        </button>
        {open ? <UserInputCard data={item.data} onReply={onReply} /> : null}
      </article>
    );
  }
  if (isTool && isViewImageTool(item.data)) {
    const path = viewImagePath(item.data);
    const name = path.split("/").filter(Boolean).at(-1) || path || "图片";
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className="icon-muted">
            <Image />
          </span>
          <span className="min-w-0 truncate">查看图片</span>
          <span className="min-w-0 truncate font-mono text-[13px] font-normal text-muted-foreground">
            {name}
          </span>
          {item.createdAt ? <EventTime value={item.createdAt} className="ml-auto" /> : null}
        </button>
        {open ? (
          <ViewImageCard
            path={path}
            projectId={projectId}
            projectPath={projectPath}
            onOpenFile={onOpenFile}
          />
        ) : null}
      </article>
    );
  }
  if (isTool && isWriteStdinTool(item.data)) {
    const details = writeStdinDetails(item.data);
    const status = typeof item.data?.status === "string" ? item.data.status : "";
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className="icon-muted">
            <Keyboard />
          </span>
          <span className="min-w-0 truncate">向命令输入</span>
          {details.sessionId ? (
            <span className="font-mono text-[13px] font-normal text-muted-foreground">
              #{details.sessionId}
            </span>
          ) : null}
          {status === "in_progress" ? (
            <LoaderCircle className="ml-auto size-3.5 animate-spin text-muted-foreground" />
          ) : item.createdAt ? (
            <EventTime value={item.createdAt} className="ml-auto" />
          ) : null}
        </button>
        {open ? (
          <div className="plan-card">
            {details.text ? (
              <pre className="plan-card-prompt">{details.text}</pre>
            ) : (
              <p className="plan-card-empty">等待命令输出</p>
            )}
          </div>
        ) : null}
      </article>
    );
  }
  if (isTool && isCompactionTool(item.data)) {
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact notice-card${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className="icon-muted">
            <Info />
          </span>
          <span className="min-w-0 truncate">上下文压缩</span>
          {item.createdAt ? <EventTime value={item.createdAt} className="ml-auto" /> : null}
        </button>
        {open ? (
          <NoticeCard message="上下文已压缩。长会话会降低准确性，建议新开对话。" level="warning" />
        ) : null}
      </article>
    );
  }
  if (isTool && isPlanTool(item.data)) {
    const status = typeof item.data?.status === "string" ? item.data.status : "";
    const items = parsePlanItems(item.data);
    const completed = items.filter((entry) => entry.status === "completed").length;
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className="icon-muted">
            <ListChecks />
          </span>
          <span className="min-w-0 truncate">计划</span>
          {items.length ? (
            <span className="text-xs font-normal text-muted-foreground">
              {completed}/{items.length}
            </span>
          ) : null}
          {status === "in_progress" ? (
            <LoaderCircle className="ml-auto size-3.5 animate-spin text-muted-foreground" />
          ) : item.createdAt ? (
            <EventTime value={item.createdAt} className="ml-auto" />
          ) : null}
        </button>
        {open ? <PlanCard data={item.data} /> : null}
      </article>
    );
  }
  if (isTool && isCollabTool(item.data)) {
    const status = typeof item.data?.status === "string" ? item.data.status : "";
    const details = collabCardDetails(item.data);
    const title = details.nickname
      ? `${collabToolLabel(item.data)} · ${details.nickname}`
      : collabToolLabel(item.data);
    return (
      <article
        data-message-id={item.id}
        className={`event-card event-card-bot compact${highlightClass}`}
      >
        <button className="event-title w-full min-w-0" onClick={() => setOpen((value) => !value)}>
          <CollapseIcon open={open} />
          <span className="icon-muted">
            <Bot />
          </span>
          <span className="min-w-0 truncate">{title}</span>
          {status === "in_progress" ? (
            <LoaderCircle className="ml-auto size-3.5 animate-spin text-muted-foreground" />
          ) : item.createdAt ? (
            <EventTime value={item.createdAt} className="ml-auto" />
          ) : null}
        </button>
        {open ? <CollabCard data={item.data} onOpenThread={onOpenThread} /> : null}
      </article>
    );
  }
  const commandTool = isTool && isCommandTool(item.data);
  const request = isTool ? toolCallRequest(item.data) : "";
  const output = isTool ? toolCallOutput(item.data, item.text) : "";
  const fileEntries = item.kind === "file" ? fileChangeEntries(item.data, item.text) : [];
  const icon =
    item.kind === "reasoning" ? (
      <Brain />
    ) : item.kind === "file" ? (
      <FileCode2 />
    ) : item.kind === "error" ? (
      <CircleAlert />
    ) : item.kind === "system" ? (
      <User />
    ) : commandTool ? (
      <SquareTerminal />
    ) : (
      <Wrench />
    );
  const title =
    item.kind === "reasoning"
      ? "Thinking"
      : item.kind === "file"
        ? "File changes"
        : item.kind === "error"
          ? "运行失败"
          : item.kind === "system"
            ? "Provider continuation"
            : commandTool
              ? "执行命令"
              : "调用";
  const summary = isTool
    ? toolCallTitle(item.data)
    : item.kind === "file"
      ? fileEntries.map((entry) => entry.path).join("、")
      : "";
  const status = typeof item.data?.status === "string" ? item.data.status : "";

  return (
    <article
      data-message-id={item.id}
      className={`event-card event-card-bot compact ${item.kind === "error" ? "border-red-200 bg-red-50/60" : ""}${highlightClass}`}
    >
      <button className="event-title w-full min-w-0" onClick={() => setOpen((v) => !v)}>
        <CollapseIcon open={open} />
        <span className="icon-muted">{icon}</span>
        <span className="min-w-0 truncate" title={isTool ? request || summary : title}>
          {title}
          {summary && summary !== title ? (
            <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </span>
        {showProviderLabel && providerName && (
          <span className="provider-pill max-w-28 truncate">{providerName}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {item.createdAt ? <EventTime value={item.createdAt} /> : null}
          {status === "in_progress" ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : status === "failed" ? (
            <CircleAlert className="size-3.5 text-red-500" />
          ) : null}
        </span>
      </button>
      {open &&
        (isTool ? (
          <div className="tool-panel">
            {request ? (
              <ToolSection
                icon={commandTool ? SquareTerminal : Wrench}
                label={commandTool ? "执行命令" : "调用"}
                text={request}
                variant="request"
              />
            ) : null}
            {output ? (
              <ToolSection
                icon={ScrollText}
                label={commandTool ? "输出" : "结果"}
                text={output}
                variant="output"
              />
            ) : status === "in_progress" ? (
              <p className="text-xs text-muted-foreground">正在执行…</p>
            ) : null}
            {!request && !output && status !== "in_progress" ? (
              <pre className="tool-pre">{JSON.stringify(item.data, null, 2)}</pre>
            ) : null}
          </div>
        ) : item.kind === "file" ? (
          <div className="space-y-3">
            {fileEntries.length ? (
              fileEntries.map((entry) =>
                entry.diff ? (
                  <GitDiffView
                    key={entry.path}
                    diff={entry.diff}
                    path={entry.path}
                    onOpenFile={onOpenFile}
                  />
                ) : (
                  <p key={entry.path} className="font-mono text-xs text-muted-foreground">
                    {entry.kind} {entry.path}
                  </p>
                )
              )
            ) : (
              <pre className="tool-pre">{item.text ?? JSON.stringify(item.data, null, 2)}</pre>
            )}
          </div>
        ) : (
          <pre className="tool-pre">{item.text ?? JSON.stringify(item.data, null, 2)}</pre>
        ))}
    </article>
  );
}

export const EventCard = memo(EventCardComponent, areEventCardPropsEqual);
EventCard.displayName = "EventCard";
