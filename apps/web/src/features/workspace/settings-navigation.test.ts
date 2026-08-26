import { describe, expect, it } from "vitest";
import {
  defaultSettingsSection,
  findSettingsSection,
  settingsNavGroups,
  settingsParentOf,
  settingsSections
} from "./settings-navigation";

describe("settings navigation", () => {
  it("nests leaf pages under collapsible parents", () => {
    const group = settingsNavGroups[0];
    expect(group?.title).toBe("系统管理");
    expect(group?.items.map((item) => item.title)).toEqual(["工作台", "连接", "内容", "账户"]);
    expect(settingsSections.map((item) => item.id)).toEqual([
      "system-info",
      "runtime",
      "appearance",
      "updates",
      "providers",
      "templates",
      "account"
    ]);
  });

  it("falls back to system information", () => {
    expect(findSettingsSection().id).toBe(defaultSettingsSection);
    expect(findSettingsSection("missing").id).toBe("system-info");
    expect(settingsParentOf("runtime").title).toBe("工作台");
    expect(settingsParentOf("providers").title).toBe("连接");
  });
});
