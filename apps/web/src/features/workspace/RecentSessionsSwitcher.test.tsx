/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCompactDateTime } from "@/lib/utils";
import type { RecentRun } from "@/types";
import { RecentSessionsPanel, RecentSessionsToggle } from "./RecentSessionsSwitcher";

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
  it("renders a fixed recent-sessions button beside the outline", () => {
    const html = renderToStaticMarkup(<RecentSessionsToggle open={false} onToggle={() => undefined} />);
    expect(html).toContain("最近对话");
    expect(html).toContain("timeline-recent-toggle");
    expect(html).toContain('aria-expanded="false"');
  });

  it("lists running-center sessions and marks the active one", () => {
    const html = renderToStaticMarkup(
      <RecentSessionsPanel
        open
        items={[run, { ...run, id: "run-2", sessionId: "session-2", sessionTitle: "看部署", status: "completed" }]}
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
    expect(renderToStaticMarkup(
      <RecentSessionsPanel
        open={false}
        items={[run]}
        pending={false}
        error=""
        onOpen={() => undefined}
        onClose={() => undefined}
      />
    )).toBe("");
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
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../styles/index.css"), "utf8");
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
});
