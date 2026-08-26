import { expect, test } from "@playwright/test";
import { ensureWorkspace } from "./helpers";

test("first-time setup lands on the workspace", async ({ page }) => {
  await ensureWorkspace(page);
  await expect(page.getByRole("button", { name: "新建对话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "项目规则" })).toBeVisible();
});
