import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const USER = "admin";
const PASSWORD = "password12";

export async function ensureWorkspace(page: Page) {
  await page.goto("/");
  const setup = page.getByText("设置管理员账户");
  const login = page.getByText("登录工作台");
  await expect(setup.or(login)).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel("账户").fill(USER);
    await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
    await page.getByLabel("确认密码").fill(PASSWORD);
    await page.getByRole("button", { name: "创建并登录" }).click();
  } else {
    await page.getByLabel("账户").fill(USER);
    await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.getByRole("button", { name: "新建对话" })).toBeVisible();
}

export async function apiJson<T>(
  request: APIRequestContext,
  url: string,
  init: { method?: string; data?: unknown; csrf?: string } = {}
) {
  const headers: Record<string, string> = {};
  if (init.csrf) headers["x-csrf-token"] = init.csrf;
  const response = await request.fetch(url, {
    method: init.method ?? "GET",
    headers,
    data: init.data
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

export async function createChatSession(page: Page) {
  const csrf = (await apiJson<{ csrfToken: string }>(page.request, "/api/auth/session")).csrfToken;
  const provider = await apiJson<{ id: string }>(page.request, "/api/providers", {
    method: "POST",
    csrf,
    data: {
      name: "Fake Provider",
      configToml: 'model = "fake-model"\n',
      authJson: '{"OPENAI_API_KEY":"fake"}'
    }
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-omni-e2e-project-"));
  const project = await apiJson<{ id: string; name: string }>(page.request, "/api/projects", {
    method: "POST",
    csrf,
    data: {
      name: "E2E Project",
      path: directory,
      providerId: provider.id
    }
  });
  const session = await apiJson<{ id: string }>(
    page.request,
    `/api/projects/${project.id}/sessions`,
    {
      method: "POST",
      csrf,
      data: { providerId: provider.id }
    }
  );
  return { csrf, provider, project, session, directory };
}
