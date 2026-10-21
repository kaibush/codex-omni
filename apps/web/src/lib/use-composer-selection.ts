import { useRef, useState } from "react";
import { clientType, type ClientType } from "@codex-omni/protocol";
import type { Provider, Session } from "@/types";
import {
  fallbackProviderId,
  loadComposerModels,
  loadComposerProviderId,
  resolveComposerModel
} from "./composer-selection";

type Selection = {
  sessionId: string;
  providerId: string;
  model: string;
  clientType: ClientType;
  ready: boolean;
};
type Input = {
  sessionId: string;
  session: Session | undefined;
  projectProviderId: string | null | undefined;
  providers: Provider[] | undefined;
};

function providerModel(provider: Provider | undefined) {
  return resolveComposerModel({
    current: "",
    available: provider?.models ?? [],
    preferred: provider ? loadComposerModels()[provider.id] : null,
    fallback: provider?.model
  });
}

function restoreSelection(input: Input): Selection {
  const session = input.session?.id === input.sessionId ? input.session : undefined;
  const kind = clientType(session?.clientType);
  const ready = Boolean(input.providers && (!input.sessionId || session));
  const providers = input.providers?.filter((provider) => clientType(provider.kind) === kind);
  const providerId = ready
    ? fallbackProviderId(
        providers,
        session?.providerId || input.projectProviderId || loadComposerProviderId()
      )
    : "";
  const provider = providers?.find((item) => item.id === providerId);
  return {
    sessionId: input.sessionId,
    providerId,
    // A saved model remains valid even when a refreshed catalog omits it.
    model:
      session?.providerId === providerId && session?.model
        ? session.model
        : providerModel(provider),
    clientType: kind,
    ready
  };
}

export function useComposerSelection(input: Input) {
  const drafts = useRef(new Map<string, Selection>());
  const [selection, setSelection] = useState(() => restoreSelection(input));
  let current = selection;
  const compatible = input.providers?.filter(
    (provider) => clientType(provider.kind) === selection.clientType
  );
  const providerMissing = Boolean(
    compatible?.length && !compatible.some((provider) => provider.id === selection.providerId)
  );
  if (
    selection.sessionId !== input.sessionId ||
    (selection.ready && providerMissing) ||
    (!selection.ready &&
      input.providers &&
      (!input.sessionId || input.session?.id === input.sessionId))
  ) {
    const draft = drafts.current.get(input.sessionId);
    current =
      draft?.ready &&
      (!input.providers || input.providers.some((provider) => provider.id === draft.providerId))
        ? draft
        : restoreSelection(input);
    // Reset the pair before rendering the new conversation or running effects.
    setSelection(current);
  }
  const provider = input.providers?.find((item) => item.id === current.providerId);
  const fallbackModel = current.ready && !current.model ? providerModel(provider) : "";
  if (fallbackModel) {
    current = { ...current, model: fallbackModel };
    setSelection(current);
  }

  const update = (patch: Partial<Selection>) => {
    drafts.current.set(input.sessionId, {
      ...(drafts.current.get(input.sessionId) ?? current),
      ...patch
    });
    setSelection((previous) =>
      previous.sessionId === input.sessionId ? { ...previous, ...patch } : previous
    );
  };
  return {
    ...current,
    selectProvider: (providerId: string, model?: string) => {
      const provider = input.providers?.find((item) => item.id === providerId);
      update({
        providerId,
        model: model ?? providerModel(provider),
        clientType: clientType(provider?.kind)
      });
    },
    setModel: (model: string) => update({ model }),
    setComposerClient: (kind: ClientType) => update({ clientType: kind })
  };
}
