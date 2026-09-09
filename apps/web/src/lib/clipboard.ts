function copyUsingDomSelection(text: string) {
  if (typeof document === "undefined" || !document.body) return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText =
    "position:fixed;top:0;left:0;width:2em;height:2em;margin:0;padding:0;border:0;outline:0;box-shadow:none;opacity:0.01;z-index:2147483647;font-size:16px;line-height:1;background:transparent;color:transparent;";
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
