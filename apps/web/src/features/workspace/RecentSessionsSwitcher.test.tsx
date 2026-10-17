/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCompactDateTime } from "@/lib/utils";
import type { RecentRun } from "@/types";
import {
  RecentSessionsToggle as ConnectedRecentSessionsToggle,
  RecentSessionsPanel,
  RecentSessionsToggleView as RecentSessionsToggle
} from "./RecentSessionsSwitcher";

const run: RecentRun = {
  id: "run-1",
  sessionId: "session-1",
  sessionTitle: "修登录",
  projectId: "project-1",
  projectName: "codex-omni",
  providerId: null,
  providerName: "Provider",
  threadId: null,
  status: "running",
  model: "gpt",
  cwd: "/work",
  startedAt: Date.UTC(2026, 8, 24, 8, 30),
  endedAt: null,
  reason: null,
  sessionCreatedAt: Date.UTC(2026, 0, 2, 9, 0)
};

describe("RecentSessionsSwitcher", () => {
  it("reads the shared active-runs cache while closed and reflects completion", () => {
    const client = new QueryClient();
    const render = () =>
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <ConnectedRecentSessionsToggle open={false} tone="header" onToggle={() => undefined} />
        </QueryClientProvider>
      );
    client.setQueryData(["active-runs"], [{ id: "run-1" }, { id: "run-2" }]);
    expect(render()).toContain('aria-label="最近对话，运行中 2"');
    client.setQueryData(["active-runs"], []);
    expect(render()).not.toContain('data-slot="badge"');
    client.clear();
  });

  it("shows the active run count even when the recent list is closed", () => {
    const html = renderToStaticMarkup(
      <RecentSessionsToggle
        open={false}
        tone="header"
        runningCount={3}
        onToggle={() => undefined}
      />
    );
    expect(html).toContain('aria-label="最近对话，运行中 3"');
    expect(html).toContain('data-slot="badge"');
    const idle = renderToStaticMarkup(
      <RecentSessionsToggle
        open={false}
        tone="header"
        runningCount={0}
        onToggle={() => undefined}
      />
    );
    expect(idle).not.toContain('data-slot="badge"');
  });

  it("renders a fixed recent-sessions button beside the outline", () => {
    const html = renderToStaticMarkup(
      <RecentSessionsToggle open={false} onToggle={() => undefined} />
    );
    expect(html).toContain("最近对话");
    expect(html).toContain("timeline-recent-toggle");
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders a compact header button for pages outside the chat timeline", () => {
    const html = renderToStaticMarkup(
      <RecentSessionsToggle open={false} tone="header" onToggle={() => undefined} />
    );
    expect(html).toContain("最近对话");
    expect(html).toContain("最近");
    expect(html).toContain("rounded-lg");
    expect(html).not.toContain("timeline-recent-toggle");
  });

  it("keeps the recent list mounted on the workspace shell, not only the chat timeline", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const workspace = readFileSync(join(dir, "Workspace.tsx"), "utf8");
    const header = readFileSync(join(dir, "WorkspaceHeader.tsx"), "utf8");
    const settings = readFileSync(join(dir, "SystemSettingsPage.tsx"), "utf8");
    const timeline = readFileSync(join(dir, "WorkspaceTimeline.tsx"), "utf8");
    const css = readFileSync(join(dir, "../../styles/index.css"), "utf8");
    expect(header).toContain('tone="header"');
    expect(workspace).toContain("<RecentSessionsOverlay");
    expect(settings).toContain("<RecentSessionsOverlay");
    expect(timeline).not.toContain("RecentSessionsToggle");
    expect(timeline).not.toContain("recent-run-sessions");
    expect(css).toMatch(/\.workspace-recent-layer \{[\s\S]*pointer-events: none;/);
    expect(css).toMatch(
      /\.workspace-recent-layer \.timeline-recent\.timeline-outline \{[\s\S]*top: 0\.5rem;/
    );
  });

  it("lists running-center sessions and marks the active one", () => {
    const html = renderToStaticMarkup(
      <RecentSessionsPanel
        open
        items={[
          run,
          {
            ...run,
            id: "run-2",
            sessionId: "session-2",
            sessionTitle: "看部署",
            status: "completed"
          }
        ]}
        pending={false}
        error=""
        activeSessionId="session-2"
        onOpen={() => undefined}
        onClose={() => undefined}
      />
    );
    expect(html).toContain('aria-label="最近对话"');
    expect(html).toContain("timeline-outline-scrim");
    expect(html).toContain("修登录");
    expect(html).toContain("看部署");
    expect(html).toContain("codex-omni");
    expect(html).toContain("timeline-recent-provider");
    expect(html).toContain("Provider");
    expect(html).toContain("创建时间");
    expect(html).toContain("创建于");
    expect(html).toContain(formatCompactDateTime(run.sessionCreatedAt));
    expect(html).not.toContain(formatCompactDateTime(run.startedAt));
    expect(html).toContain("运行中");
    expect(html).toContain("已完成");
    expect(html).toContain('role="button"');
    expect(html).toContain("timeline-recent-item is-active");
    expect(html).toContain("timeline-recent-copy");
    expect(html).toContain("timeline-recent-row");
    expect(
      renderToStaticMarkup(
        <RecentSessionsPanel
          open={false}
          items={[run]}
          pending={false}
          error=""
          onOpen={() => undefined}
          onClose={() => undefined}
        />
      )
    ).toBe("");
  });

  it("switches the visible time when sorting by the latest run", () => {
    const html = renderToStaticMarkup(
      <RecentSessionsPanel
        open
        items={[run]}
        pending={false}
        error=""
        sort="updated"
        onOpen={() => undefined}
        onClose={() => undefined}
      />
    );
    expect(html).toContain("更新时间");
    expect(html).toContain("更新于");
    expect(html).toContain(formatCompactDateTime(run.startedAt));
    expect(html).not.toContain(formatCompactDateTime(run.sessionCreatedAt));
  });

  it("shows loading and empty states without leaving the overlay", () => {
    expect(
      renderToStaticMarkup(
        <RecentSessionsPanel
          open
          items={[]}
          pending
          error=""
          onOpen={() => undefined}
          onClose={() => undefined}
        />
      )
    ).toContain("正在读取最近对话");
    expect(
      renderToStaticMarkup(
        <RecentSessionsPanel
          open
          items={[]}
          pending={false}
          error="最近对话加载失败"
          onOpen={() => undefined}
          onClose={() => undefined}
        />
      )
    ).toContain("最近对话加载失败");
  });

  it("stacks title and meta so mobile rows cannot overlap", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../styles/index.css"),
      "utf8"
    );
    expect(css).toMatch(/\.timeline-recent\.timeline-outline\.is-open \{\s*display: block;/);
    expect(css).toMatch(/\.timeline-recent-copy \{[\s\S]*display: block;/);
    expect(css).toMatch(/\.timeline-recent-row \{[\s\S]*display: grid;/);
    expect(css).toMatch(/\.timeline-recent-meta \{[\s\S]*display: flex;/);
    expect(css).toMatch(/\.timeline-recent-provider \{[\s\S]*text-overflow: ellipsis;/);
    expect(css).toMatch(/\.timeline-recent-item \{[\s\S]*border-radius: 0\.55rem;/);
    expect(css).toMatch(/\.timeline-recent-item \{[\s\S]*min-height: 2\.6rem;/);
    expect(css).toMatch(/\.timeline-recent-title \{[\s\S]*font-weight: 400;/);
    expect(css).toMatch(/\.timeline-recent-title \{[\s\S]*color: inherit;/);
    expect(css).not.toMatch(/\.timeline-recent-item \{[^}]*min-height: 0/);
  });

  it("keeps recent actions on the first mobile row and moves the raw terminal tab aside", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const header = readFileSync(join(dir, "WorkspaceHeader.tsx"), "utf8");
    const sidebar = readFileSync(join(dir, "WorkspaceSidebar.tsx"), "utf8");
    const settings = readFileSync(join(dir, "SystemSettingsPage.tsx"), "utf8");
    const css = readFileSync(join(dir, "../../styles/index.css"), "utf8");
    expect(header).not.toContain('value="terminal"');
    expect(header).toContain("workspace-header-actions");
    expect(header).toContain("workspace-header-views");
    expect(header).toContain("sm:order-3");
    expect(header).toContain('aria-current="page"');
    expect(header).toContain("打开终端");
    expect(sidebar).toContain('aria-label="打开终端"');
    expect(settings).toContain("settings-page-header");
    expect(settings).toContain("sm:w-auto");
    expect(css).toMatch(/\.settings-page-header \{[\s\S]*safe-area-inset-top/);
    expect(css).toMatch(/\.workspace-header-views \{[\s\S]*overflow-x: auto/);
    expect(css).toMatch(
      /\.workspace-recent-layer \.timeline-outline \{[\s\S]*safe-area-inset-bottom/
    );
  });
});
