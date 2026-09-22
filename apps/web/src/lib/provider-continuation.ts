export function shouldContinueWithProvider(input: {
  sessionProviderId?: string | null;
  selectedProviderId?: string | null;
  hasConversation: boolean;
  continuationMode?: string | null | undefined;
  threadId?: string | null | undefined;
}) {
  const providerChanged = Boolean(
    input.sessionProviderId &&
    input.selectedProviderId &&
    input.sessionProviderId !== input.selectedProviderId
  );
  if (!providerChanged || !input.hasConversation) return false;
  // Copied fork history is not a native thread. The first turn already carries
  // that snapshot, so the selected provider and model can start in this session.
  if (input.continuationMode === "fork" && !input.threadId?.trim()) return false;
  return true;
}

export function timelineHasConversation(items: Array<{ kind: string }>) {
  return items.some((item) => item.kind === "user" || item.kind === "assistant");
}
