export function mergeToolPayload(existing: unknown, next: Record<string, unknown>) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const input = {
    ...asObject(base.input),
    ...asObject(next.input)
  };
  const path = firstString([next.path, base.path, input.path]);
  return {
    ...base,
    ...next,
    ...(Object.keys(input).length ? { input } : {}),
    ...(path ? { path } : {})
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
