function execCopyCommand() {
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  }
}

function restoreSelection(previousRange: Range | null) {
  if (typeof document === "undefined") return;
  const selection = document.getSelection();
  selection?.removeAllRanges();
  if (previousRange) selection?.addRange(previousRange);
}

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  return (
    /iPad|iPhone|iPod/.test(platform) ||
    /iPad|iPhone|iPod/.test(ua) ||
    ((platform === "MacIntel" || ua.includes("Mac")) && navigator.maxTouchPoints > 1)
  );
}

function withCopyEvent(text: string, run: () => boolean) {
  if (typeof document === "undefined") return run();
  let eventCopied = false;
  const onCopy = (event: Event) => {
    const clipboardEvent = event as ClipboardEvent;
    const data = clipboardEvent.clipboardData;
    if (!data) return;
    try {
      data.setData("text/plain", text);
      data.setData("text", text);
      clipboardEvent.preventDefault();
      eventCopied = true;
    } catch {
      // Some WebViews expose clipboardData but reject setData.
    }
  };
  document.addEventListener("copy", onCopy, true);
  try {
    const commandOk = run();
    if (eventCopied) return true;
    // iOS often reports execCommand success while the pasteboard stays empty.
    if (isIosDevice()) return false;
    return commandOk;
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
}

function copyUsingTextarea(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("inputmode", "none");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("spellcheck", "false");
  if (isIosDevice()) {
    textarea.contentEditable = "true";
    textarea.readOnly = false;
  } else {
    textarea.readOnly = true;
    textarea.setAttribute("readonly", "");
  }
  textarea.style.cssText = isIosDevice()
    ? "position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;outline:0;overflow:hidden;z-index:2147483647;font-size:16px;line-height:1;background:#fff;color:#000;clip:rect(0,0,0,0);-webkit-user-select:text;user-select:text;"
    : "position:fixed;top:0;left:0;width:2em;height:2em;margin:0;padding:0;border:0;outline:0;box-shadow:none;opacity:0.01;z-index:2147483647;font-size:16px;line-height:1;background:transparent;color:transparent;-webkit-user-select:text;user-select:text;";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const success = execCopyCommand();
  textarea.remove();
  return success;
}

function copyUsingSelectableMark(text: string) {
  const selection = document.getSelection();
  if (!selection) return false;
  const previousRange = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const mark = document.createElement("span");
  mark.textContent = text;
  mark.setAttribute("contenteditable", "true");
  mark.tabIndex = -1;
  mark.style.cssText =
    "position:fixed;top:0;left:0;width:auto;max-width:80vw;margin:0;padding:8px;border:0;outline:0;overflow:hidden;z-index:2147483647;font-size:16px;line-height:1.2;white-space:pre;background:#fff;color:#000;clip:rect(0,0,0,0);-webkit-user-select:text;user-select:text;";
  document.body.appendChild(mark);
  const range = document.createRange();
  range.selectNodeContents(mark);
  selection.removeAllRanges();
  selection.addRange(range);
  mark.focus({ preventScroll: true });
  const success = execCopyCommand();
  mark.remove();
  if (isIosDevice()) selection.removeAllRanges();
  else restoreSelection(previousRange);
  return success;
}

function copyUsingDomSelection(text: string) {
  if (typeof document === "undefined" || !document.body) return false;
  return withCopyEvent(text, () => {
    if (copyUsingTextarea(text)) return true;
    return copyUsingSelectableMark(text);
  });
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // iOS Safari often resolves writeText without putting text on the pasteboard,
  // and a late Clipboard API write can overwrite a successful execCommand copy.
  if (!isIosDevice()) {
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText : undefined;
    if (writeText) {
      try {
        await writeText.call(navigator.clipboard, text);
        return true;
      } catch {
        // HTTP and permission policies may block the Clipboard API.
      }
    }
  }
  if (copyUsingDomSelection(text)) return true;
  return false;
}

let lastMenuCopyText = "";
let lastMenuCopyAt = 0;

function copyFromMenuGesture(text: string, onDone?: (copied: boolean) => void) {
  if (!text) {
    onDone?.(false);
    return;
  }
  const now = Date.now();
  if (text === lastMenuCopyText && now - lastMenuCopyAt < 500) return;
  lastMenuCopyText = text;
  lastMenuCopyAt = now;
  if (isIosDevice()) {
    if (copyUsingDomSelection(text)) {
      onDone?.(true);
      return;
    }
    const result = typeof window !== "undefined" ? window.prompt("请长按全选后复制", text) : null;
    onDone?.(result !== null);
    return;
  }
  void copyTextToClipboard(text).then((copied) => onDone?.(copied));
}

/**
 * Copy during a real user activation:
 * iOS treats pointerup/click as activation, not Radix onSelect custom events.
 */
export function copyMenuItemProps(text: string, onDone?: (copied: boolean) => void) {
  return {
    onPointerUp: (event: { button?: number; pointerType?: string }) => {
      if ((event.button ?? 0) !== 0) return;
      if (event.pointerType === "mouse") return;
      copyFromMenuGesture(text, onDone);
    },
    onClick: () => {
      copyFromMenuGesture(text, onDone);
    },
    onSelect: (event?: { preventDefault?: () => void }) => {
      if (isIosDevice()) event?.preventDefault?.();
      copyFromMenuGesture(text, onDone);
    }
  };
}

export function preventIosMenuAutoFocus(event: Event) {
  if (isIosDevice()) event.preventDefault();
}
