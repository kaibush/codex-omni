import { expect, test, type Page } from "@playwright/test";
import type { RecentRun, Session } from "../apps/web/src/types";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

async function homeFixture(page: Page) {
  await ensureWorkspace(page);
  const codex = await createChatSession(page);
  const claude = await createChatSession(page);
  await apiJson(page.request, `/api/projects/${codex.project.id}`, {
    method: "PUT",
    csrf: codex.csrf,
    data: { name: "前端工程" }
  });
  await apiJson(page.request, `/api/projects/${claude.project.id}`, {
    method: "PUT",
    csrf: claude.csrf,
    data: { name: "服务工程" }
  });
  await apiJson(page.request, `/api/sessions/${codex.session.id}`, {
    method: "PUT",
    csrf: codex.csrf,
    data: { title: "检查首页布局" }
  });
  const provider = await apiJson<{ id: string }>(page.request, "/api/providers", {
    method: "POST",
    csrf: claude.csrf,
    data: {
      name: "Claude Provider",
      kind: "claude-code",
      homeMode: "api-key",
      apiKey: "fixture-key",
      baseUrl: "http://127.0.0.1:1",
      model: "sonnet"
    }
  });
  const session = await apiJson<Session>(
    page.request,
    `/api/projects/${claude.project.id}/sessions`,
    {
      method: "POST",
      csrf: claude.csrf,
      data: { title: "修复 Markdown 渲染", clientType: "claude-code", providerId: provider.id }
    }
  );
  const now = Date.now();
  const recent: RecentRun[] = [
    {
      id: "run-claude",
      sessionId: session.id,
      sessionTitle: session.title,
      projectId: claude.project.id,
      projectName: "服务工程",
      providerId: provider.id,
      providerName: "Claude Provider",
      kind: "chat",
      clientType: "claude-code",
      threadId: null,
      status: "completed",
      model: "sonnet",
      cwd: claude.directory,
      startedAt: now,
      endedAt: now,
      reason: null,
      sessionCreatedAt: now
    },
    {
      id: "run-codex",
      sessionId: codex.session.id,
      sessionTitle: "检查首页布局",
      projectId: codex.project.id,
      projectName: "前端工程",
      providerId: codex.provider.id,
      providerName: "Codex Provider",
      kind: "chat",
      clientType: "codex",
      threadId: null,
      status: "completed",
      model: "fake-model",
      cwd: codex.directory,
      startedAt: now - 60_000,
      endedAt: now - 60_000,
      reason: null,
      sessionCreatedAt: now - 120_000
    }
  ];
  await page.route("**/api/runs/recent-sessions*", (route) => route.fulfill({ json: recent }));
  return { recent, codex, claude: { project: claude.project, session } };
}

for (const mobile of [false, true]) {
  test(`opens the recent conversation home before any project on ${mobile ? "mobile" : "desktop"}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const fixture = await homeFixture(page);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const opened: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        /^\/api\/sessions\/[^/]+$/.test(pathname) ||
        /^\/api\/projects\/[^/]+\/sessions$/.test(pathname)
      )
        opened.push(pathname);
    });
    await page.goto("/");
    const list = page.getByRole("list", { name: "最近对话列表" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".project-row.active")).toHaveCount(0);
    await expect(page.locator(".composer-shell")).toHaveCount(0);
    expect(opened).toEqual([]);
    await expect(list.getByRole("img", { name: "Claude Code", exact: true })).toHaveCount(1);
    await expect(list.getByRole("img", { name: "Codex", exact: true })).toHaveCount(1);
    await expect(list.getByRole("listitem").first()).toContainText("修复 Markdown 渲染");
    await expect(list.getByRole("listitem").last()).toContainText("前端工程");
    const search = page.getByRole("searchbox", { name: "搜索最近对话" });
    await search.fill("服务工程");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await search.fill("does-not-exist");
    await expect(page.getByText("没有匹配的最近对话")).toBeVisible();
    await search.clear();
    await page.reload();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page).toHaveURL(/\/$/);
    expect(opened).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("recent-conversations-home.png") });

    await list.getByRole("button", { name: /修复 Markdown 渲染/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${fixture.claude.project.id}/sessions/${fixture.claude.session.id}$`)
    );
    await expect(page.getByRole("combobox", { name: "客户端", exact: true })).toContainText(
      "Claude Code"
    );
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/sessions/${fixture.claude.session.id}$`));
    await expect(page.locator(".composer-shell textarea")).toBeVisible();
    await page.goBack();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page).toHaveURL(/\/$/);

    await list.getByRole("button", { name: /检查首页布局/ }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${fixture.codex.session.id}$`));
    if (mobile) await page.getByRole("button", { name: "打开项目侧栏", exact: true }).click();
    else await page.getByRole("button", { name: "折叠项目侧栏", exact: true }).click();
    await page.getByRole("button", { name: "最近对话首页", exact: true }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page).toHaveURL(/\/$/);
    if (mobile)
      await expect(page.getByRole("button", { name: "关闭项目侧栏", exact: true })).toHaveCount(0);

    await page.goto("/projects/project-no-longer-exists");
    await expect(page).toHaveURL(/\/$/);
    await expect(list.getByRole("listitem")).toHaveCount(2);
  });
}

test("keeps project selection manual when there are no recent conversations", async ({ page }) => {
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  await page.route("**/api/runs/recent-sessions*", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  const home = page.getByRole("region", { name: "最近对话", exact: true });
  await expect(home.getByText("暂无最近对话")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await home.getByRole("button", { name: new RegExp(created.directory) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${created.project.id}$`));
  await expect(page.getByRole("heading", { name: "选择对话", exact: true })).toBeVisible();
  await expect(page.locator(".project-row.active")).toHaveCount(1);
});
