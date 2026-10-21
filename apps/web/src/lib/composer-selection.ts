export const COMPOSER_PROVIDER_KEY = "codex-omni:composer-provider";
export const COMPOSER_MODELS_KEY = "codex-omni:composer-models";

export type ProviderOption = {
  id: string;
  isDefault?: boolean;
};

export function loadComposerProviderId(): string {
  try {
    return localStorage.getItem(COMPOSER_PROVIDER_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function persistComposerProviderId(providerId: string) {
  const value = providerId.trim();
  if (!value) return;
  try {
    localStorage.setItem(COMPOSER_PROVIDER_KEY, value);
  } catch {
    // private browsing
  }
}

export function loadComposerModels(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COMPOSER_MODELS_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string" && Boolean(entry[1].trim())
      )
    );
  } catch {
    return {};
  }
}

export function persistComposerModel(providerId: string, model: string) {
  const nextProvider = providerId.trim();
  const nextModel = model.trim();
  if (!nextProvider || !nextModel) return;
  try {
    const current = loadComposerModels();
    current[nextProvider] = nextModel;
    localStorage.setItem(COMPOSER_MODELS_KEY, JSON.stringify(current));
  } catch {
    // private browsing
  }
}

export function fallbackProviderId(
  providers?: ProviderOption[] | null,
  preferred?: string | null
): string {
  const wanted = preferred?.trim() || "";
  if (!providers?.length) return wanted;
  if (wanted && providers.some((provider) => provider.id === wanted)) return wanted;
  return providers.find((provider) => provider.isDefault)?.id ?? providers[0]?.id ?? wanted;
}

export function resolveComposerModel(input: {
  current: string;
  available: string[];
  preferred?: string | null | undefined;
  fallback?: string | null | undefined;
}): string {
  const available = input.available.filter(Boolean);
  if (!available.length) return input.current || input.preferred || input.fallback || "";
  if (input.current && available.includes(input.current)) return input.current;
  if (input.preferred && available.includes(input.preferred)) return input.preferred;
  if (input.fallback && available.includes(input.fallback)) return input.fallback;
  return available[0] ?? "";
}
