export type PaletteGroup = "command" | "session" | "message" | "file" | "git" | "project";

export type PaletteAction =
  | { type: "new-session" }
  | { type: "new-project" }
  | { type: "open-view"; view: "chat" | "files" | "git" | "terminal" }
  | { type: "open-settings" }
  | { type: "open-providers" }
  | { type: "open-running-center" }
  | { type: "open-tasks" }
  | { type: "open-knowledge" }
  | { type: "open-skills" }
  | { type: "open-schedules" }
  | { type: "open-approvals" }
  | { type: "toggle-theme" }
  | { type: "refresh" }
  | { type: "toggle-sidebar" }
  | { type: "goto-line" }
  | { type: "toggle-outline" }
  | { type: "enhance-prompt" }
  | { type: "project"; projectId: string }
  | { type: "session"; projectId: string; sessionId: string }
  | {
      type: "message";
      projectId: string;
      sessionId: string;
      messageId: string;
      hits?: Array<{ projectId: string; sessionId: string; messageId: string }>;
    }
  | { type: "file"; projectId: string; path: string; line: number | null }
  | { type: "git-commit"; projectId: string; hash: string }
  | { type: "git-branch"; projectId: string; name: string };

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  title: string;
  subtitle?: string | undefined;
  snippet?: string | undefined;
  shortcut?: string | undefined;
  keywords: string[];
  action: PaletteAction;
};

export const PALETTE_COMMANDS: PaletteItem[] = [
  {
    id: "cmd:new-session",
    group: "command",
    title: "新建对话",
    subtitle: "在当前工程创建 Session",
    shortcut: "N",
    keywords: ["new", "session", "chat", "对话", "新建", "xjdh", "xj", "xinjian"],
    action: { type: "new-session" }
  },
  {
    id: "cmd:new-project",
    group: "command",
    title: "新建工程",
    subtitle: "打开服务器目录并加入工作台",
    keywords: ["new", "project", "工程", "项目", "xjgc", "gc"],
    action: { type: "new-project" }
  },
  {
    id: "cmd:open-chat",
    group: "command",
    title: "打开对话",
    subtitle: "切换到聊天时间线",
    keywords: ["chat", "对话", "消息", "dkdh", "dh"],
    action: { type: "open-view", view: "chat" }
  },
  {
    id: "cmd:open-files",
    group: "command",
    title: "打开文件",
    subtitle: "切换到文件工作区",
    keywords: ["files", "editor", "文件", "编辑", "dkwj", "wj"],
    action: { type: "open-view", view: "files" }
  },
  {
    id: "cmd:open-git",
    group: "command",
    title: "打开 Git",
    subtitle: "查看变更、分支和提交",
    keywords: ["git", "diff", "commit", "提交", "dkgit"],
    action: { type: "open-view", view: "git" }
  },
  {
    id: "cmd:open-terminal",
    group: "command",
    title: "打开终端",
    subtitle: "切换到内置终端",
    keywords: ["terminal", "shell", "终端", "dkzd", "zd", "ot"],
    action: { type: "open-view", view: "terminal" }
  },
  {
    id: "cmd:open-settings",
    group: "command",
    title: "打开设置",
    subtitle: "工作区、运行权限和发送方式",
    keywords: ["settings", "设置", "配置", "dksz", "sz"],
    action: { type: "open-settings" }
  },
  {
    id: "cmd:open-providers",
    group: "command",
    title: "打开 Provider",
    subtitle: "管理模型供应商",
    keywords: ["provider", "model", "供应商", "模型", "gys"],
    action: { type: "open-providers" }
  },
  {
    id: "cmd:running-center",
    group: "command",
    title: "打开运行中心",
    subtitle: "查看 Worker、PID 和当前 Run",
    keywords: ["run", "worker", "运行中心", "yxzx"],
    action: { type: "open-running-center" }
  },
  {
    id: "cmd:open-tasks",
    group: "command",
    title: "打开任务看板",
    subtitle: "个人任务与计划转任务",
    keywords: ["task", "board", "任务", "看板", "plan", "rwkb"],
    action: { type: "open-tasks" }
  },
  {
    id: "cmd:open-knowledge",
    group: "command",
    title: "打开项目规则",
    subtitle: "AGENTS.md 与可引用笔记",
    keywords: ["rules", "agents", "规则", "笔记", "xmgg"],
    action: { type: "open-knowledge" }
  },
  {
    id: "cmd:open-skills",
    group: "command",
    title: "打开 Skills / MCP",
    subtitle: "管理技能和 MCP 服务器",
    keywords: ["skills", "mcp", "技能", "jn"],
    action: { type: "open-skills" }
  },
  {
    id: "cmd:open-schedules",
    group: "command",
    title: "打开定时任务",
    subtitle: "按计划把 Prompt 写入 Session",
    keywords: ["schedule", "cron", "定时", "dsrw"],
    action: { type: "open-schedules" }
  },
  {
    id: "cmd:open-approvals",
    group: "command",
    title: "打开审批审计",
    subtitle: "筛选历史审批并查看统计",
    keywords: ["approval", "audit", "审批", "审计", "spsj"],
    action: { type: "open-approvals" }
  },
  {
    id: "cmd:toggle-theme",
    group: "command",
    title: "切换主题",
    subtitle: "浅色 / 深色",
    keywords: ["theme", "dark", "light", "主题", "qhzt", "zt"],
    action: { type: "toggle-theme" }
  },
  {
    id: "cmd:refresh",
    group: "command",
    title: "刷新工作台",
    subtitle: "重新拉取工程、会话和设置",
    keywords: ["refresh", "reload", "刷新", "sx"],
    action: { type: "refresh" }
  },
  {
    id: "cmd:toggle-sidebar",
    group: "command",
    title: "切换侧栏",
    subtitle: "显示或收起项目列表",
    keywords: ["sidebar", "侧栏", "qhcl", "cl"],
    action: { type: "toggle-sidebar" }
  },
  {
    id: "cmd:goto-line",
    group: "command",
    title: "转到行",
    subtitle: "跳到当前文件的指定行号",
    shortcut: "G",
    keywords: ["goto", "line", "转到行", "行号", "zdx", "zhuan", "line"],
    action: { type: "goto-line" }
  },
  {
    id: "cmd:toggle-outline",
    group: "command",
    title: "切换符号大纲",
    subtitle: "显示当前文件的函数、类和标题",
    keywords: ["outline", "symbol", "大纲", "符号", "dg", "fh"],
    action: { type: "toggle-outline" }
  },
  {
    id: "cmd:enhance-prompt",
    group: "command",
    title: "强化提示词",
    subtitle: "用当前供应商把草稿改得更具体",
    keywords: ["enhance", "prompt", "强化", "提示词", "qhw", "sparkle"],
    action: { type: "enhance-prompt" }
  }
];

export const PALETTE_GROUP_LABEL: Record<PaletteGroup, string> = {
  command: "命令",
  session: "会话",
  message: "消息",
  file: "文件",
  git: "Git",
  project: "工程"
};

export type PaletteScope = "all" | PaletteGroup;

export const PALETTE_SCOPES: Array<{ id: PaletteScope; label: string }> = [
  { id: "all", label: "全部" },
  { id: "command", label: "命令" },
  { id: "project", label: "工程" },
  { id: "session", label: "会话" },
  { id: "message", label: "消息" },
  { id: "file", label: "文件" },
  { id: "git", label: "Git" }
];

export function itemMatchesScope(item: PaletteItem, scope: PaletteScope) {
  return scope === "all" || item.group === scope;
}

export function nextPaletteScope(scope: PaletteScope, delta: number): PaletteScope {
  const current = PALETTE_SCOPES.findIndex((item) => item.id === scope);
  const index = current < 0 ? 0 : current;
  const next = (index + delta + PALETTE_SCOPES.length) % PALETTE_SCOPES.length;
  return PALETTE_SCOPES[next]!.id;
}

export function searchScopeFor(scope: PaletteScope): Exclude<PaletteScope, "command"> | null {
  if (scope === "command") return null;
  return scope;
}

export function paletteScopeLabel(scope: PaletteScope) {
  return PALETTE_SCOPES.find((item) => item.id === scope)?.label ?? "全部";
}

export function latinInitials(value: string) {
  return value
    .split(/[\s/._-]+/)
    .map((part) => part[0] ?? "")
    .join("")
    .toLowerCase();
}

export function scorePaletteItem(item: PaletteItem, query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 1;
  const title = item.title.toLowerCase();
  const keywords = item.keywords.map((keyword) => keyword.toLowerCase());
  const haystack =
    `${title} ${item.subtitle ?? ""} ${keywords.join(" ")} ${item.snippet ?? ""}`.toLowerCase();
  if (title === trimmed) return 100;
  if (keywords.includes(trimmed)) return 90;
  if (title.startsWith(trimmed)) return 80;
  if (keywords.some((keyword) => keyword.startsWith(trimmed))) return 74;
  const initials = latinInitials(item.title);
  if (initials && (initials === trimmed || initials.startsWith(trimmed))) return 70;
  if (haystack.includes(trimmed)) return 60 - haystack.indexOf(trimmed) / 20;
  if (fuzzyIncludes(haystack, trimmed)) return 30;
  return 0;
}

export function filterPaletteItems(items: PaletteItem[], query: string) {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: scorePaletteItem(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.item.title.localeCompare(right.item.title, "zh-CN")
    )
    .map((entry) => entry.item);
}

export function groupPaletteItems(items: PaletteItem[]) {
  const groups: Array<{ group: PaletteGroup; items: PaletteItem[] }> = [];
  for (const group of Object.keys(PALETTE_GROUP_LABEL) as PaletteGroup[]) {
    const grouped = items.filter((item) => item.group === group);
    if (grouped.length) groups.push({ group, items: grouped });
  }
  return groups;
}

function fuzzyIncludes(haystack: string, query: string) {
  let index = 0;
  for (const char of query) {
    const next = haystack.indexOf(char, index);
    if (next < 0) return false;
    index = next + 1;
  }
  return true;
}
