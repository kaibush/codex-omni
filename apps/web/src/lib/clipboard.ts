function copyUsingDomSelection(text: string) {
  if (typeof document === "undefined" || !document.body) return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText =
    "position:fixed;top:0;left:0;width:2px;height:2px;margin:0;padding:0;border:0;opacity:0;z-index:2147483647;font-size:16px;line-height:1;background:transparent;color:transparent;pointer-events:none;";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.platform) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // Keep the synchronous fallback inside the originating click/touch gesture.
  // iOS Safari may reject Clipboard API calls after the gesture has completed.
  if (isIosDevice() && copyUsingDomSelection(text)) return true;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // iOS Safari, HTTP, and permission policies may block the Clipboard API.
    }
  }
  return copyUsingDomSelection(text);
}
