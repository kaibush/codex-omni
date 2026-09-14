export function nextNumberedTitle(existingTitles: readonly string[], baseTitle: string) {
  const base = baseTitle.trim() || "终端";
  const used = new Set(existingTitles.map((title) => title.trim()).filter(Boolean));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function numberedDuplicateTitles(
  items: readonly { id: string; title: string; createdAt: number }[]
): Map<string, string> {
  const groups = new Map<string, Array<{ id: string; createdAt: number }>>();
  for (const item of items) {
    const title = item.title.trim() || "终端";
    const group = groups.get(title) ?? [];
    group.push({ id: item.id, createdAt: item.createdAt });
    groups.set(title, group);
  }
  const labels = new Map<string, string>();
  for (const [title, group] of groups) {
    if (group.length === 1) {
      labels.set(group[0]!.id, title);
      continue;
    }
    const ordered = [...group].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    ordered.forEach((item, index) => {
      labels.set(item.id, `${title} ${index + 1}`);
    });
  }
  return labels;
}
