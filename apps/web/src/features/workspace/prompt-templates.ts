export function normalizeTemplateCommand(command: string | null | undefined): string | null {
  const trimmed = command?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function templateInsertText(template: { content: string }): string {
  return template.content;
}

export function joinInsertedTemplate(current: string, insert: string): string {
  if (!insert) return current;
  if (!current) return insert;
  if (current.endsWith("\n") || /\s$/.test(current)) return `${current}${insert}`;
  return `${current}\n${insert}`;
}
