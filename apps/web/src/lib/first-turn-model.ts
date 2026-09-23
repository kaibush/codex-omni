export const FIRST_TURN_CONFIRMED_KEY = "codex-omni:first-turn-confirmed";

export type FirstTurnKind = "new" | "fork" | "continue";

export function loadConfirmedFirstTurns(): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(FIRST_TURN_CONFIRMED_KEY) ?? "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((item): item is string => typeof item === "string" && Boolean(item)));
  } catch {
    return new Set();
  }
}

export function rememberConfirmedFirstTurn(sessionId: string, current = loadConfirmedFirstTurns()) {
  const id = sessionId.trim();
  if (!id) return current;
  current.add(id);
  try {
    sessionStorage.setItem(FIRST_TURN_CONFIRMED_KEY, JSON.stringify([...current].slice(-200)));
  } catch {
    // private browsing
  }
  return current;
}

export function sessionHasUserMessage(
  events: Array<{ kind: string }>,
  messages?: Array<{ role: string }> | null
) {
  return (
    events.some((item) => item.kind === "user") ||
    Boolean(messages?.some((message) => message.role === "user"))
  );
}

export function firstTurnPromptKind(input: {
  sessionKind?: string | null | undefined;
  threadId?: string | null | undefined;
  continuationMode?: string | null | undefined;
  hasUserMessage: boolean;
  confirmed: boolean;
  hasPendingTurn: boolean;
  hasStartedTurn?: boolean;
}): FirstTurnKind | null {
  if (input.sessionKind === "terminal-chat") return null;
  if (input.confirmed || input.hasPendingTurn || input.hasStartedTurn) return null;
  if (input.threadId?.trim()) return null;
  if (input.continuationMode === "fork") return "fork";
  if (input.hasUserMessage) return null;
  if (input.continuationMode === "portable-context") return "continue";
  if (input.continuationMode) return null;
  return "new";
}
