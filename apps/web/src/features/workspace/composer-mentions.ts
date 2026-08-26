export const SLASH_COMMANDS = [
  {
    name: "/review",
    title: "审查变更",
    prompt: "请审查当前工作区的代码变更：指出风险、回归点和建议测试，不要直接提交。"
  },
  {
    name: "/test",
    title: "运行测试",
    prompt: "请运行当前项目测试。若失败，定位原因并修复，最后汇报结果。"
  },
  {
    name: "/commit",
    title: "提交变更",
    prompt: "请查看当前 Git 变更，撰写简洁的提交说明，确认范围后提交。不要 push。"
  },
  {
    name: "/explain",
    title: "解释代码",
    prompt: "请解释当前上下文中的代码或变更，重点说明行为、边界条件和调用关系。"
  }
] as const;

export type SlashCommand = {
  name: string;
  title: string;
  prompt: string;
};

export type SlashExpandContext = {
  projectName?: string | undefined;
  sessionTitle?: string | undefined;
};

const RECENT_SLASH_KEY = "codex-omni:recent-slash:v1";

export function loadRecentSlashCommands() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_SLASH_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function rememberSlashCommand(name: string) {
  try {
    const next = [name, ...loadRecentSlashCommands().filter((item) => item !== name)].slice(0, 8);
    localStorage.setItem(RECENT_SLASH_KEY, JSON.stringify(next));
  } catch {
    // private browsing
  }
}

export function sortSlashCommands(items: SlashCommand[]) {
  const recent = loadRecentSlashCommands();
  return [...items].sort((left, right) => {
    const leftIndex = recent.indexOf(left.name);
    const rightIndex = recent.indexOf(right.name);
    if (leftIndex === -1 && rightIndex === -1) return 0;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

export function expandSlashCommand(
  input: string,
  extra: SlashCommand[] = [],
  context: SlashExpandContext = {}
) {
  const trimmed = input.trim();
  const command = [...SLASH_COMMANDS, ...extra].find(
    (item) => trimmed === item.name || trimmed.startsWith(`${item.name} `)
  );
  if (!command) return input;
  rememberSlashCommand(command.name);
  const rest = trimmed.slice(command.name.length).trim();
  const values: Record<string, string> = {
    input: rest,
    date: new Date().toISOString().slice(0, 10),
    project: context.projectName ?? "",
    session: context.sessionTitle ?? ""
  };
  const expanded = command.prompt.replace(
    /\{\{\s*(input|date|project|session)\s*\}\}/gi,
    (_, key: string) => {
      return values[key.toLowerCase()] ?? "";
    }
  );
  if (rest && !/\{\{\s*input\s*\}\}/i.test(command.prompt)) return `${expanded}\n\n${rest}`;
  return expanded;
}

export function mentionQuery(input: string, caret: number) {
  const before = input.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && /[\w./]/.test(before[at - 1] ?? "")) return null;
  const token = before.slice(at + 1);
  if (token.includes("\n") || token.includes(" ")) return null;
  return { start: at, query: token };
}

export function slashQuery(input: string, caret: number) {
  const before = input.slice(0, caret);
  if (!before.startsWith("/") || before.includes("\n") || before.includes(" ")) return null;
  return before;
}

export function extractMentions(message: string) {
  return [...new Set((message.match(/@[\w./-]+/g) ?? []).map((item) => item.slice(1)))];
}

export function insertAt(input: string, start: number, caret: number, value: string) {
  return `${input.slice(0, start)}${value}${input.slice(caret)}`;
}
