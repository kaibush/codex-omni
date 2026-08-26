import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function isSafeHref(href: string | undefined) {
  return Boolean(href && !/^\s*javascript:/i.test(href));
}

export function ReleaseNotesMarkdown({ text }: { text: string }) {
  const notes = text.trim();
  if (!notes) return null;

  return (
    <div className="markdown text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            isSafeHref(href) ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            )
        }}
      >
        {notes}
      </ReactMarkdown>
    </div>
  );
}
