import { expect, test, type Page } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

async function fixture(page: Page) {
  await ensureWorkspace(page);
  const current = await createChatSession(page);
  const other = await createChatSession(page);
  for (const [item, name, title] of [
    [current, "当前工程", "保留当前对话"],
    [other, "浏览工程", "另一个工程的对话"]
  ] as const) {
    item.project.name = `${name} ${item.project.id}`;
    await apiJson(page.request, `/api/projects/${item.project.id}`, {
      method: "PUT",
      csrf: item.csrf,
      data: { name: item.project.name }
    });
    await apiJson(page.request, `/api/sessions/${item.session.id}`, {
      method: "PUT",
      csrf: item.csrf,
      data: { title }
    });
  }
  const currentPath = `/projects/${current.project.id}/sessions/${current.session.id}`;
  await page.goto(currentPath);
  await expect(page.locator(".composer-shell textarea")).toBeVisible();
  const sidebar = page.locator(".workspace-sidebar");
  const currentProject = sidebar.locator(`[data-project-id="${current.project.id}"]`);
  const otherProject = sidebar.locator(`[data-project-id="${other.project.id}"]`);
  return { current, other, currentPath, sidebar, currentProject, otherProject };
}

for (const mobile of [false, true]) {
  test(`browses projects without leaving the conversation on ${mobile ? "mobile" : "desktop"}`, async ({
    page
  }, testInfo) => {
    const { current, other, currentPath, sidebar, currentProject, otherProject } =
      await fixture(page);
    const composer = page.locator(".composer-shell textarea");
    await composer.fill("尚未发送的内容要保留");
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });

    const sessionReads: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith(`/api/sessions/${other.session.id}`)) sessionReads.push(path);
    });
    await currentProject
      .getByRole("button", { name: `展开 ${current.project.name}`, exact: true })
      .click();
    await otherProject.getByRole("button", { name: other.project.name, exact: true }).click();
    await expect(currentProject.getByTitle("保留当前对话", { exact: true })).toBeVisible();
    await expect(otherProject.getByTitle("另一个工程的对话", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${currentPath}$`));
    await expect(composer).toHaveValue("尚未发送的内容要保留");
    await expect(currentProject.locator(".project-row")).toHaveClass(/active/);
    await expect(otherProject.locator(".project-row")).not.toHaveClass(/active/);
    expect(sessionReads).toEqual([]);

    await otherProject.getByRole("button", { name: other.project.name, exact: true }).click();
    await expect(otherProject.getByRole("group")).toHaveCount(0);
    await expect(currentProject.getByTitle("保留当前对话", { exact: true })).toBeVisible();
    await otherProject
      .getByRole("button", { name: `展开 ${other.project.name}`, exact: true })
      .click();
    await expect(otherProject.getByTitle("另一个工程的对话", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${currentPath}$`));

    if (mobile) {
      await expect(page.getByRole("button", { name: "关闭项目侧栏", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390
      );
    } else {
      await sidebar.getByRole("button", { name: "折叠项目侧栏", exact: true }).click();
      const icon = sidebar.getByRole("button", { name: other.project.name, exact: true });
      const bounds = await icon.boundingBox();
      expect(bounds?.width).toBe(32);
      await icon.click();
      await expect(otherProject.getByTitle("另一个工程的对话", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${currentPath}$`));
      await expect(composer).toHaveValue("尚未发送的内容要保留");
      await page.reload();
      await expect(currentProject.getByTitle("保留当前对话", { exact: true })).toBeVisible();
      await expect(otherProject.getByTitle("另一个工程的对话", { exact: true })).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`projects-${mobile ? "mobile" : "desktop"}.png`)
    });
    await otherProject.getByTitle("另一个工程的对话", { exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${other.project.id}/sessions/${other.session.id}$`)
    );
    await expect(page.getByRole("tab", { name: "对话", exact: true })).toHaveAttribute(
      "data-state",
      "active"
    );
    if (mobile) await expect(sidebar).toHaveCount(0);
    else await expect(currentProject.getByTitle("保留当前对话", { exact: true })).toBeVisible();
  });
}

test("renames, archives and bulk deletes sessions in another project without navigating", async ({
  page
}) => {
  const { current, other, currentPath, sidebar, currentProject, otherProject } =
    await fixture(page);
  await currentProject.getByRole("button", { name: current.project.name, exact: true }).click();
  await otherProject.getByRole("button", { name: other.project.name, exact: true }).click();
  await otherProject
    .getByRole("button", { name: "另一个工程的对话 的更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  const rename = otherProject.getByRole("textbox", { name: "重命名 Session", exact: true });
  await rename.fill("浏览时重命名");
  await rename.press("Enter");
  await expect(otherProject.getByTitle("浏览时重命名", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${currentPath}$`));

  await otherProject.getByRole("button", { name: "浏览时重命名 的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(otherProject.getByText("已归档 · 1", { exact: true })).toBeVisible();
  await expect(sidebar.getByTitle("已展开项目中的归档会话", { exact: true })).toHaveText("1");
  await expect(currentProject.getByTitle("保留当前对话", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${currentPath}$`));
  await otherProject.getByRole("button", { name: "浏览时重命名 的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "恢复归档", exact: true }).click();
  await expect(otherProject.getByText("最近 · 1", { exact: true })).toBeVisible();

  await currentProject.getByRole("button", { name: "多选", exact: true }).click();
  await currentProject.getByRole("checkbox", { name: "选择 保留当前对话", exact: true }).check();
  await otherProject.getByRole("button", { name: "多选", exact: true }).click();
  await expect(currentProject.getByRole("checkbox")).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "删除", exact: true })).toBeDisabled();
  await sidebar.getByRole("button", { name: "全选", exact: true }).click();
  await expect(
    otherProject.getByRole("checkbox", { name: "选择 浏览时重命名", exact: true })
  ).toBeChecked();
  await sidebar.getByRole("button", { name: "删除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除对话", exact: true });
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByRole("listitem")).toContainText("浏览时重命名");
  const deletion = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/sessions/bulk-delete") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  const response = await deletion;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().ids).toEqual([other.session.id]);
  await expect(dialog).not.toBeVisible();
  await expect(otherProject.getByTitle("浏览时重命名", { exact: true })).toHaveCount(0);
  await expect(otherProject.getByText("暂无会话", { exact: true })).toBeVisible();
  await expect(currentProject.getByTitle("保留当前对话", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${currentPath}$`));
  const remaining = await apiJson<Array<{ id: string }>>(
    page.request,
    `/api/projects/${current.project.id}/sessions`
  );
  expect(remaining.map((session) => session.id)).toEqual([current.session.id]);
});

test("loads and retries an inactive project independently and can explicitly open an empty project", async ({
  page
}) => {
  const { currentPath, other, otherProject, sidebar } = await fixture(page);
  let releaseResponse!: () => void;
  const heldResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route(`**/api/projects/${other.project.id}/sessions?archived=true`, async (route) => {
    await heldResponse;
    await route.fulfill({ status: 503, json: { message: "暂时无法加载" } });
  });
  await otherProject.getByRole("button", { name: other.project.name, exact: true }).click();
  await expect(otherProject.getByRole("status")).toContainText("正在加载会话");
  await expect(otherProject.getByText("暂无会话", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${currentPath}$`));
  releaseResponse();
  await expect(otherProject.getByRole("alert")).toContainText("会话加载失败");
  await page.unroute(`**/api/projects/${other.project.id}/sessions?archived=true`);
  await otherProject.getByRole("button", { name: "重试", exact: true }).click();
  await expect(otherProject.getByTitle("另一个工程的对话", { exact: true })).toBeVisible();
  await expect(otherProject.getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${currentPath}$`));

  await apiJson(page.request, "/api/sessions/bulk-delete", {
    method: "POST",
    csrf: other.csrf,
    data: { ids: [other.session.id], purgeSource: false }
  });
  await page.reload();
  await expect(otherProject.getByText("暂无会话", { exact: true })).toBeVisible();
  await otherProject
    .getByRole("button", { name: `${other.project.name} 菜单`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "打开项目", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${other.project.id}$`));
  await expect(page.getByRole("heading", { name: "选择对话", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "新建对话", exact: true })).toBeEnabled();
});

test("opens terminal sessions from another project in the terminal conversation tab", async ({
  page
}) => {
  const { other, currentPath, otherProject } = await fixture(page);
  const terminal = await apiJson<{ session: { id: string } }>(
    page.request,
    `/api/projects/${other.project.id}/terminal-sessions`,
    { method: "POST", csrf: other.csrf, data: { title: "另一个工程的终端", profileId: "shell" } }
  );
  await otherProject.getByRole("button", { name: other.project.name, exact: true }).click();
  await expect(otherProject.getByTitle("另一个工程的终端", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${currentPath}$`));
  await otherProject.getByTitle("另一个工程的终端", { exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${other.project.id}/sessions/${terminal.session.id}$`)
  );
  await expect(page.getByRole("tab", { name: "终端对话", exact: true })).toHaveAttribute(
    "data-state",
    "active"
  );
});
