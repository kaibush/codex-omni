export function summarizeMessageText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return { title: "消息摘要", content: "" };
  const headings = [...trimmed.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1]!.trim());
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((part) =>
      part
        .replace(/^#{1,6}\s+/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  const bullets = headings.length
    ? headings.slice(0, 8).map((item) => `- ${item}`)
    : paragraphs.slice(0, 4).map((item) => `- ${item.slice(0, 180)}`);
  const title = (headings[0] || paragraphs[0]?.slice(0, 40) || "消息摘要").slice(0, 80);
  return { title, content: `## ${title}\n\n${bullets.join("\n")}` };
}
