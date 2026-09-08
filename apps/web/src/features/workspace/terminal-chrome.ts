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

export function encodeTerminalKeyboardSubmit(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n/g, "\r");
  if (!normalized) return "\r";
  return normalized.endsWith("\r") ? normalized : `${normalized}\r`;
}
