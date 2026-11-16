import { expect, test, type Page } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

async function fixture(page: Page) {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  const title = "我同步了上游https://github（分叉）";
  await apiJson(page.request, `/api/sessions/${created.session.id}`, {
    method: "PUT",
    csrf: created.csrf,
    data: { title }
  });
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  const header = page.locator(".workspace-header");
  await expect(header.getByTitle("双击重命名", { exact: true })).toHaveText(title);
  const project = page.locator(`.workspace-sidebar [data-project-id="${created.project.id}"]`);
  const expand = project.getByRole("button", { name: `展开 ${created.project.name}`, exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(project.getByTitle(title, { exact: true })).toBeVisible();
  return { ...created, title, header, project };
}

for (const location of ["header", "sidebar"] as const) {
  for (const entry of ["double click", "menu"] as const) {
    test(`${location} ${entry} keeps a single focused title editor with the active session expanded`, async ({
      page
    }) => {
      const { session, title, header, project } = await fixture(page);
      const edits: string[] = [];
      page.on("request", (request) => {
        if (request.url().endsWith(`/api/sessions/${session.id}`) && request.method() === "PUT") {
          const data = request.postDataJSON() as { title?: string };
          if (data.title !== undefined) edits.push(data.title);
        }
      });
      const editor = page.getByRole("textbox", {
        name: location === "header" ? "编辑 Session 标题" : "重命名 Session",
        exact: true
      });
      const otherEditor = page.getByRole("textbox", {
        name: location === "header" ? "重命名 Session" : "编辑 Session 标题",
        exact: true
      });
      const openEditor = async () => {
        if (entry === "double click") {
          if (location === "header")
            await header.getByTitle("双击重命名", { exact: true }).dblclick();
          else
            await project
              .locator("button[title]")
              .filter({ has: page.locator(".truncate") })
              .filter({ hasText: title })
              .dblclick();
        } else {
          if (location === "header")
            await header.getByRole("button", { name: "Session 更多操作", exact: true }).click();
          else
            await project.getByRole("button", { name: `${title} 的更多操作`, exact: true }).click();
          await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
        }
        await expect(editor).toBeVisible({ timeout: 5_000 });
        await expect(editor).toBeFocused();
        await expect(otherEditor).toHaveCount(0);
      };

      await openEditor();
      await editor.fill("取消时不要保存");
      await editor.press("Escape");
      await expect(editor).toHaveCount(0);
      await expect(header.getByTitle("双击重命名", { exact: true })).toHaveText(title);
      expect(edits).toEqual([]);

      await openEditor();
      const renamed = `${location} ${entry} 已重命名`;
      await editor.fill(renamed);
      await editor.press("Enter");
      await expect(header.getByTitle("双击重命名", { exact: true })).toHaveText(renamed);
      await expect(project.getByTitle(renamed, { exact: true })).toBeVisible();
      expect(edits).toEqual([renamed]);
      await page.reload();
      await expect(header.getByTitle("双击重命名", { exact: true })).toHaveText(renamed);

      // A subsequent blur saves once and updates both locations.
      await header.getByTitle("双击重命名", { exact: true }).dblclick();
      const headerEditor = header.getByRole("textbox", { name: "编辑 Session 标题", exact: true });
      await headerEditor.fill(`${renamed} · 失焦保存`);
      await page.locator(".composer-shell textarea").click();
      await expect(header.getByTitle("双击重命名", { exact: true })).toHaveText(
        `${renamed} · 失焦保存`
      );
      expect(edits).toEqual([renamed, `${renamed} · 失焦保存`]);
    });
  }
}
