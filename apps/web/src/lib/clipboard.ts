function copyUsingDomSelection(text: string) {
  if (typeof document === "undefined" || !document.body) return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0.01;z-index:-1;";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(textarea);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    selection?.removeAllRanges();
    textarea.remove();
  }
}

export async function copyTextToClipboard(text: string) {
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
