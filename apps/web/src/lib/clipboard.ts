function execCopyCommand() {
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  }
}

function restoreSelection(previousRange: Range | null) {
  const selection = document.getSelection();
  selection?.removeAllRanges();
  if (previousRange) selection?.addRange(previousRange);
}

function copyUsingTextarea(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("inputmode", "none");
  textarea.style.cssText =
    "position:fixed;top:0;left:0;width:2em;height:2em;margin:0;padding:0;border:0;outline:0;box-shadow:none;opacity:0.01;z-index:2147483647;font-size:16px;line-height:1;background:transparent;color:transparent;-webkit-user-select:text;user-select:text;";
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
  const mark = document.createElement("span");
  mark.textContent = text;
  mark.setAttribute("contenteditable", "true");
  mark.tabIndex = -1;
  mark.style.cssText =
    "position:fixed;top:0;left:0;max-width:80vw;margin:0;padding:0;border:0;outline:0;opacity:0.01;z-index:2147483647;font-size:16px;line-height:1;white-space:pre;background:transparent;color:transparent;-webkit-user-select:text;user-select:text;";
  document.body.appendChild(mark);
  const range = document.createRange();
  range.selectNodeContents(mark);
  selection.removeAllRanges();
  selection.addRange(range);
  mark.focus({ preventScroll: true });
  const success = execCopyCommand();
  mark.remove();
  return success;
}

function copyUsingDomSelection(text: string) {
  if (typeof document === "undefined" || !document.body) return false;
  const selection = document.getSelection();
  const previousRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  try {
    if (copyUsingTextarea(text)) return true;
    return copyUsingSelectableMark(text);
  } finally {
    restoreSelection(previousRange);
  }
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  return (
    /iPad|iPhone|iPod/.test(platform) ||
    /iPad|iPhone|iPod/.test(ua) ||
    ((platform === "MacIntel" || ua.includes("Mac")) && navigator.maxTouchPoints > 1)
  );
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText : undefined;
  if (writeText) {
    try {
      // Invoke Clipboard API before yielding so iOS keeps the originating gesture.
      const pending = writeText.call(navigator.clipboard, text);
      const synchronousFallback = isIosDevice() ? copyUsingDomSelection(text) : false;
      try {
        await pending;
        return true;
      } catch {
        // iOS Safari, HTTP, and permission policies may block the Clipboard API.
        if (synchronousFallback) return true;
      }
    } catch {
      // Some WebViews throw synchronously when Clipboard API is unavailable.
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
    onSelect: () => {
      copyFromMenuGesture(text, onDone);
    }
  };
}
