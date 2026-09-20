/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimelineOutline } from "./TimelineOutline";
import { TIMELINE_OUTLINE_STORAGE_KEY } from "./timeline-outline";

describe("TimelineOutline", () => {
  it("lists every user question and hides empty outlines", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    localStorage.setItem(TIMELINE_OUTLINE_STORAGE_KEY, "open");
    const html = renderToStaticMarkup(
      <TimelineOutline
        items={[
          { id: "u1", title: "第一个问题", createdAt: 1 },
          { id: "u2", title: "第二个问题", createdAt: 2 }
        ]}
        activeId="u2"
        onJump={() => undefined}
      />
    );
    expect(html).toContain('aria-label="对话大纲"');
    expect(html).toContain("timeline-outline-scrim");
    expect(html).toContain("timeline-outline-heading");
    expect(html).toContain("第一个问题");
    expect(html).toContain("第二个问题");
    expect(html).toContain("kind-user");
    expect(html).not.toContain("Codex：");
    expect(html).not.toContain("思考：");
    expect(renderToStaticMarkup(<TimelineOutline items={[]} onJump={() => undefined} />)).toBe("");
  });

  it("still renders the mobile toggle when the outline starts closed", () => {
    localStorage.setItem(TIMELINE_OUTLINE_STORAGE_KEY, "closed");
    const html = renderToStaticMarkup(
      <TimelineOutline
        items={[{ id: "u1", title: "第一个问题", createdAt: 1 }]}
        onJump={() => undefined}
      />
    );
    expect(html).toContain("打开对话大纲");
    expect(html).not.toContain('aria-label="对话大纲"');
  });
});

describe("timeline chrome layout", () => {
  it("keeps mobile fold/outline controls out of the message copy row", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const timeline = readFileSync(join(dir, "WorkspaceTimeline.tsx"), "utf8");
    const css = readFileSync(join(dir, "../../styles/index.css"), "utf8");
    expect(timeline).toContain("timeline-chrome");
    expect(timeline).toContain("TimelineOutlineToggle");
    expect(timeline).toContain("timeline-view-toggle");
    expect(timeline).not.toMatch(/chat-content-width[\s\S]*timeline-view-float/);
    expect(css).toContain(".chat-pane:has(.timeline-chrome) .chat-scroll");
    expect(css).toContain("top: 3rem;");
    expect(css).toContain(".timeline-chrome:has(.timeline-outline-toggle) .timeline-view-float");
  });
});
