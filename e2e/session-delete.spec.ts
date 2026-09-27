import { expect, test, type Page } from "@playwright/test";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

type DeleteEntry = "sidebar" | "header" | "bulk";

async function fixture(page: Page) {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  const projectName = `删除测试 ${created.project.id}`;
  await apiJson(page.request, `/api/projects/${created.project.id}`, {
    method: "PUT",
    csrf: created.csrf,
    data: { name: projectName }
  });
  const targets = [created.session];
  for (let index = 0; index < 2; index++) {
    targets.push(
      await apiJson<{ id: string }>(page.request, `/api/projects/${created.project.id}/sessions`, {
        method: "POST",
        csrf: created.csrf,
        data: { providerId: created.provider.id }
      })
    );
  }
  const titles = ["待删除的对话一", "待删除的对话二", "保留的对话"];
  for (const [index, session] of targets.entries()) {
    await apiJson(page.request, `/api/sessions/${session.id}`, {
      method: "PUT",
      csrf: created.csrf,
      data: { title: titles[index] }
    });
  }
  await page.goto(`/projects/${created.project.id}/sessions/${created.session.id}`);
  await expect(page.getByRole("button", { name: "Session 更多操作", exact: true })).toBeVisible();
  const expand = page.getByRole("button", { name: `展开 ${projectName}`, exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(
    page.getByRole("button", { name: `${titles[0]} 的更多操作`, exact: true })
  ).toBeVisible();
  return { ...created, targets, titles };
}

async function openDelete(page: Page, entry: DeleteEntry, titles: string[]) {
  if (entry === "bulk") {
    const multiSelect = page.getByRole("button", { name: "多选", exact: true });
    if (await multiSelect.isVisible()) await multiSelect.click();
    for (const title of titles.slice(0, 2)) {
      await page.getByRole("checkbox", { name: `选择 ${title}`, exact: true }).check();
    }
    await page
      .locator(".workspace-sidebar")
      .getByRole("button", { name: "删除", exact: true })
      .click();
  } else {
    await page
      .getByRole("button", {
        name: entry === "header" ? "Session 更多操作" : `${titles[0]} 的更多操作`,
        exact: true
      })
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  }
  const dialog = page.getByRole("dialog", { name: "删除对话", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(entry === "bulk" ? 2 : 1);
  return dialog;
}

async function confirmDelete(page: Page, expectedIds: string[], purgeSource: boolean) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/sessions/bulk-delete") && response.request().method() === "POST"
  );
  const dialog = page.getByRole("dialog", { name: "删除对话", exact: true });
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const submitted = response.request().postDataJSON() as { ids: string[]; purgeSource: boolean };
  expect(submitted.ids.sort()).toEqual([...expectedIds].sort());
  expect(submitted.purgeSource).toBe(purgeSource);
  expect((await response.json()).deleted.sort()).toEqual([...expectedIds].sort());
  await expect(dialog).not.toBeVisible();
}

for (const entry of ["sidebar", "header", "bulk"] as const) {
  test(`${entry} deletion defaults to local cleanup on every opening`, async ({ page }) => {
    const created = await fixture(page);
    const requests: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/sessions/bulk-delete") && request.method() === "POST") {
        requests.push(request.postDataJSON());
      }
    });
    let dialog = await openDelete(page, entry, created.titles);
    const checkbox = dialog.getByRole("checkbox", { name: "同时删除本地数据", exact: true });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(requests).toEqual([]);

    dialog = await openDelete(page, entry, created.titles);
    await expect(
      dialog.getByRole("checkbox", { name: "同时删除本地数据", exact: true })
    ).toBeChecked();
    const expectedIds = created.targets
      .slice(0, entry === "bulk" ? 2 : 1)
      .map((session) => session.id);
    await confirmDelete(page, expectedIds, true);
    const remaining = await apiJson<Array<{ id: string }>>(
      page.request,
      `/api/projects/${created.project.id}/sessions`
    );
    expect(remaining.map((session) => session.id).sort()).toEqual(
      created.targets
        .filter((session) => !expectedIds.includes(session.id))
        .map((session) => session.id)
        .sort()
    );
    if (entry === "bulk") {
      await expect(page.getByRole("button", { name: "多选", exact: true })).toBeVisible();
    }
  });
}

for (const entry of ["sidebar", "bulk"] as const) {
  test(`${entry} deletion allows opting out of local cleanup`, async ({ page }) => {
    const created = await fixture(page);
    const dialog = await openDelete(page, entry, created.titles);
    await dialog.getByRole("checkbox", { name: "同时删除本地数据", exact: true }).uncheck();
    await expect(
      dialog.getByText("仅删除工作台中的对话，客户端目录中的原始数据会保留。")
    ).toBeVisible();
    await confirmDelete(
      page,
      created.targets.slice(0, entry === "bulk" ? 2 : 1).map((session) => session.id),
      false
    );
  });
}

for (const mobile of [false, true]) {
  test(`terminal tab deletion defaults to local cleanup on ${mobile ? "mobile" : "desktop"}`, async ({
    page
  }, testInfo) => {
    const created = await fixture(page);
    const title = "待删除的终端对话";
    const terminal = await apiJson<{ session: { id: string } }>(
      page.request,
      `/api/projects/${created.project.id}/terminal-sessions`,
      { method: "POST", csrf: created.csrf, data: { title, profileId: "shell" } }
    );
    await page.goto(`/projects/${created.project.id}/sessions/${terminal.session.id}`);
    await page.getByRole("tab", { name: "终端对话", exact: true }).click();
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "折叠项目侧栏", exact: true }).click();
      await page.getByRole("button", { name: "选择终端对话", exact: true }).click();
    }
    await page.getByRole("button", { name: `关闭 ${title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "删除对话", exact: true });
    await expect(
      dialog.getByRole("checkbox", { name: "同时删除本地数据", exact: true })
    ).toBeChecked();
    await expect(dialog.getByText("关联的终端进程也会停止。", { exact: true })).toBeVisible();
    if (mobile) {
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await page.screenshot({ path: testInfo.outputPath("delete-mobile.png") });
    }
    await confirmDelete(page, [terminal.session.id], true);
    const remaining = await apiJson<{ items: Array<{ sessionId: string }> }>(
      page.request,
      `/api/projects/${created.project.id}/terminal-sessions`
    );
    expect(remaining.items).toEqual([]);
  });
}
