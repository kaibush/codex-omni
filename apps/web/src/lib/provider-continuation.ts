export function shouldContinueWithProvider(input: {
  sessionProviderId?: string | null;
  selectedProviderId?: string | null;
  hasConversation: boolean;
}) {
  return Boolean(
    input.hasConversation &&
      input.sessionProviderId &&
      input.selectedProviderId &&
      input.sessionProviderId !== input.selectedProviderId
  );
}

export function timelineHasConversation(items: Array<{ kind: string }>) {
  return items.some((item) => item.kind === "user" || item.kind === "assistant");
}
