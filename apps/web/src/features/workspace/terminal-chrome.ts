export function sliceVisibleLines(
  lines: readonly string[],
  viewportY: number,
  rows: number
): string[] {
  if (rows <= 0 || lines.length === 0) return [];
  const start = Math.min(Math.max(0, viewportY), lines.length);
  return lines.slice(start, start + rows);
}

export function joinVisibleLines(lines: readonly string[]): string {
  return lines.join("\n").replace(/\s+$/u, "");
}

export function visibleBufferText(
  lines: readonly string[],
  viewportY: number,
  rows: number
): string {
  return joinVisibleLines(sliceVisibleLines(lines, viewportY, rows));
}

export function terminalCopyPayload(
  selection: string,
  visibleText: string
): { text: string; message: string } {
  if (selection) return { text: selection, message: "已复制选中内容" };
  if (visibleText) return { text: visibleText, message: "已复制当前屏幕" };
  return { text: "", message: "没有可复制的内容" };
}

export function isCoarsePointer(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia
): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    return Boolean(matchMedia("(pointer: coarse)").matches);
  } catch {
    return false;
  }
}

export function shouldFocusTerminalAfterChromeAction(
  options: {
    pointerType?: string | undefined;
    coarsePointer?: boolean | undefined;
  } = {}
): boolean {
  const pointerType = options.pointerType ?? "";
  if (pointerType === "touch" || pointerType === "pen") return false;
  if (options.coarsePointer) return false;
  return true;
}

export function isDuplicateChromeClick(detail: number, pointerType: string | undefined): boolean {
  return detail > 0 && pointerType != null && pointerType !== "mouse";
}

export function chromePointerMovedTooFar(startX: number, endX: number, threshold = 12) {
  return Math.abs(endX - startX) > threshold;
}

export function isTouchLikePointer(pointerType: string | undefined): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

export function shouldPreventChromePointerDefault(pointerType: string | undefined): boolean {
  return !isTouchLikePointer(pointerType);
}

export const terminalKeyboardFieldProps = {
  type: "text" as const,
  inputMode: "text" as const,
  enterKeyHint: "send" as const,
  autoCapitalize: "none" as const,
  autoCorrect: "off" as const,
  autoComplete: "off" as const,
  spellCheck: false as const,
  lang: "zh-CN",
  name: "codex-omni-terminal-keyboard"
};

export function shouldSubmitTerminalKeyboard(event: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.isComposing || event.nativeEvent?.isComposing) return false;
  const keyCode = event.keyCode ?? event.nativeEvent?.keyCode;
  if (keyCode === 229) return false;
  return true;
}

export function encodeTerminalComposerPayload(value: string, autoEnter = true): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n/g, "\r");
  if (!autoEnter) return normalized.replace(/\r+$/g, "");
  if (!normalized) return "\r";
  return normalized.endsWith("\r") ? normalized : `${normalized}\r`;
}

export function encodeTerminalKeyboardSubmit(value: string): string {
  return encodeTerminalComposerPayload(value, true);
}

export function quoteShellArg(value: string): string {
  if (!value) return "''";
  if (/^[A-Za-z0-9_./:@%=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function composeTerminalAttachmentCommand(
  draft: string,
  paths: readonly string[]
): { command: string; submit: boolean } {
  const quoted = paths.map(quoteShellArg).join(" ");
  const trimmed = draft.trim();
  if (!quoted) return { command: draft, submit: Boolean(trimmed) };
  if (!trimmed) return { command: quoted, submit: false };
  if (paths.some((path) => draft.includes(path) || draft.includes(quoteShellArg(path)))) {
    return { command: draft, submit: true };
  }
  return { command: `${draft.trimEnd()} ${quoted}`, submit: true };
}

export type TerminalInputModifiers = {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

const CSI_CURSOR: Record<string, string> = {
  "\x1b[A": "A",
  "\x1b[B": "B",
  "\x1b[C": "C",
  "\x1b[D": "D",
  "\x1b[H": "H",
  "\x1b[F": "F"
};

export function encodeTerminalModifiedInput(
  rawData: string,
  modifiers: TerminalInputModifiers = {}
): string {
  if (!rawData) return rawData;
  const ctrl = Boolean(modifiers.ctrl);
  const alt = Boolean(modifiers.alt);
  const shift = Boolean(modifiers.shift);
  if (!ctrl && !alt && !shift) return rawData;
  if (rawData === "\t" && shift && !ctrl && !alt) return "\x1b[Z";
  const cursor = CSI_CURSOR[rawData];
  if (cursor) {
    const bits = (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
    return bits ? `\x1b[1;${bits + 1}${cursor}` : rawData;
  }
  let data = rawData;
  if (shift && data.length === 1 && data.charCodeAt(0) < 128) data = data.toUpperCase();
  if (ctrl && data.length === 1) {
    const code = data.toUpperCase().charCodeAt(0);
    if (code < 128) data = String.fromCharCode(code & 31);
  }
  if (alt) data = `\x1b${data}`;
  return data;
}

export function filterCommandHistory(items: readonly string[], query: string, limit = 50) {
  const needle = query.trim().toLowerCase();
  const matched = needle ? items.filter((item) => item.toLowerCase().includes(needle)) : [...items];
  return matched.slice(0, limit);
}

export function touchScrollLines(dy: number, lineHeight: number, leftover: number) {
  const height = Math.max(1, lineHeight);
  const next = leftover + dy / height;
  const lines = next > 0 ? Math.floor(next) : Math.ceil(next);
  return { lines, leftover: next - lines };
}

export function attachTerminalTouchScroll(
  element: HTMLElement,
  getTerminal: () => { rows: number; scrollLines: (count: number) => void } | null
) {
  let lastY = 0;
  let leftover = 0;
  let tracking = false;
  const onStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      tracking = false;
      leftover = 0;
      return;
    }
    tracking = true;
    leftover = 0;
    lastY = event.touches[0]!.clientY;
  };
  const onMove = (event: TouchEvent) => {
    if (!tracking || event.touches.length !== 1) return;
    const term = getTerminal();
    if (!term || term.rows <= 0) return;
    const y = event.touches[0]!.clientY;
    const dy = lastY - y;
    lastY = y;
    const { lines, leftover: nextLeftover } = touchScrollLines(
      dy,
      element.clientHeight / term.rows,
      leftover
    );
    leftover = nextLeftover;
    if (lines === 0) return;
    term.scrollLines(lines);
    event.preventDefault();
  };
  const onEnd = () => {
    tracking = false;
    leftover = 0;
  };
  element.addEventListener("touchstart", onStart, { passive: true });
  element.addEventListener("touchmove", onMove, { passive: false });
  element.addEventListener("touchend", onEnd);
  element.addEventListener("touchcancel", onEnd);
  return () => {
    element.removeEventListener("touchstart", onStart);
    element.removeEventListener("touchmove", onMove);
    element.removeEventListener("touchend", onEnd);
    element.removeEventListener("touchcancel", onEnd);
  };
}

export function xtermTheme(theme: "light" | "dark") {
  return theme === "dark"
    ? {
        background: "#090d14",
        foreground: "#dce5f2",
        cursor: "#7dd3fc",
        selectionBackground: "#1d4ed880"
      }
    : {
        background: "#fbfdff",
        foreground: "#172033",
        cursor: "#0369a1",
        selectionBackground: "#93c5fd80"
      };
}
