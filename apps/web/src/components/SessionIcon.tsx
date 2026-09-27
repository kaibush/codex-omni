import { TerminalSquare } from "lucide-react";
import { ClientIcon } from "@/components/ClientIcon";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";

export function SessionIcon({
  session,
  className,
  labelled = false
}: {
  session: Pick<Session, "kind" | "clientType">;
  className?: string;
  labelled?: boolean;
}) {
  if (session.kind !== "terminal-chat") {
    return <ClientIcon client={session.clientType} className={className} labelled={labelled} />;
  }
  return (
    <TerminalSquare
      className={cn("size-4 shrink-0", className)}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? "终端对话" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled ? <title>终端对话</title> : null}
    </TerminalSquare>
  );
}
