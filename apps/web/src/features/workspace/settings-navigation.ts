import { KeyRound, LayoutDashboard, Sparkles, UserRound, type LucideIcon } from "lucide-react";

export type SettingsSectionId =
  "system-info" | "runtime" | "appearance" | "updates" | "providers" | "templates" | "account";

export type SettingsLeaf = {
  id: SettingsSectionId;
  href: `/settings/${SettingsSectionId}`;
  title: string;
  description: string;
};

export type SettingsCollapsible = {
  title: string;
  icon: LucideIcon;
  items: SettingsLeaf[];
};

export type SettingsNavGroup = {
  id: string;
  title: string;
  items: SettingsCollapsible[];
};

export const defaultSettingsSection: SettingsSectionId = "system-info";

export const settingsNavGroups: readonly SettingsNavGroup[] = [
  {
    id: "system-administration",
    title: "系统管理",
    items: [
      {
        title: "工作台",
        icon: LayoutDashboard,
        items: [
          {
            id: "system-info",
            href: "/settings/system-info",
            title: "系统信息",
            description: "工作台标识、CODEX_HOME 和当前运行策略"
          },
          {
            id: "runtime",
            href: "/settings/runtime",
            title: "运行与权限",
            description: "文件权限、审批策略和 Plan / Execute"
          },
          {
            id: "appearance",
            href: "/settings/appearance",
            title: "界面与对话",
            description: "主题、字号、消息和工具显示"
          },
          {
            id: "updates",
            href: "/settings/updates",
            title: "版本更新",
            description: "当前版本、GitHub Release 与更新说明"
          }
        ]
      },
      {
        title: "连接",
        icon: KeyRound,
        items: [
          {
            id: "providers",
            href: "/settings/providers",
            title: "供应商与模型",
            description: "连接信息、默认模型和 CODEX_HOME"
          }
        ]
      },
      {
        title: "内容",
        icon: Sparkles,
        items: [
          {
            id: "templates",
            href: "/settings/templates",
            title: "Prompt 模板",
            description: "管理常用斜杠命令"
          }
        ]
      },
      {
        title: "账户",
        icon: UserRound,
        items: [
          {
            id: "account",
            href: "/settings/account",
            title: "登录与退出",
            description: "当前登录状态与退出"
          }
        ]
      }
    ]
  }
];

export const settingsSections: readonly SettingsLeaf[] = settingsNavGroups.flatMap((group) =>
  group.items.flatMap((item) => item.items)
);

export function findSettingsSection(id?: string) {
  return (
    settingsSections.find((item) => item.id === id) ??
    settingsSections.find((item) => item.id === defaultSettingsSection)!
  );
}

export function settingsParentOf(id: SettingsSectionId) {
  for (const group of settingsNavGroups) {
    for (const item of group.items) {
      if (item.items.some((leaf) => leaf.id === id)) return item;
    }
  }
  return settingsNavGroups[0]!.items[0]!;
}
