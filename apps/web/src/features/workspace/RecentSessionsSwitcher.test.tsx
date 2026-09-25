/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
  reason: null
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
    expect(html).toContain("运行中");
    expect(html).toContain("已完成");
    expect(html).toContain("timeline-recent-item is-active");
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
});
