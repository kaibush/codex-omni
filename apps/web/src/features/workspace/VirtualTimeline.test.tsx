import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VirtualTimeline } from "./VirtualTimeline";

describe("VirtualTimeline", () => {
  it("renders short lists in full", () => {
    const html = renderToStaticMarkup(
      <VirtualTimeline
        items={[
          { id: "a", kind: "user", text: "hi" },
          { id: "b", kind: "assistant", text: "hello" }
        ]}
        scrollRef={{ current: null }}
        renderItem={(item) => <div>{item.id}</div>}
      />
    );
    expect(html).toContain('data-virtualized="0"');
    expect(html).toContain("a");
    expect(html).toContain("b");
  });

  it("windows a long timeline instead of mounting every card", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `m-${index}`,
      kind: "assistant" as const,
      text: "hi"
    }));
    const html = renderToStaticMarkup(
      <VirtualTimeline
        items={items}
        scrollRef={{ current: null }}
        renderItem={(item) => <div>{item.id}</div>}
      />
    );
    expect(html).toContain('data-virtualized="1"');
    expect(html).toContain("m-0");
    expect(html).not.toContain("m-39");
    expect(html).not.toContain("正在显示后续消息");
  });

  it("pins a long timeline to the newest cards while sticking to bottom", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `m-${index}`,
      kind: "assistant" as const,
      text: "hi"
    }));
    const html = renderToStaticMarkup(
      <VirtualTimeline
        items={items}
        scrollRef={{ current: null }}
        stickToBottom={{ current: true }}
        renderItem={(item) => <div>{item.id}</div>}
      />
    );
    expect(html).toContain('data-virtualized="1"');
    expect(html).toContain("m-39");
    expect(html).not.toContain("m-0");
  });

  it("keeps the locked card in the window after older messages are prepended", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `m-${index}`,
      kind: "assistant" as const,
      text: "hi"
    }));
    const html = renderToStaticMarkup(
      <VirtualTimeline
        items={items}
        scrollRef={{ current: null }}
        lockItemId="m-20"
        renderItem={(item) => <div>{item.id}</div>}
      />
    );
    expect(html).toContain("m-20");
    expect(html).not.toContain("m-0");
    expect(html).not.toContain("m-39");
  });

  it("keeps a later assistant visible when the raw lock is a hidden reasoning event", () => {
    const items = [
      { id: "assistant-old", kind: "assistant", text: "older" },
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `tool-${index}`,
        kind: "activity" as const
      })),
      { id: "assistant-item_88", kind: "assistant", text: "anchor" },
      ...Array.from({ length: 16 }, (_, index) => ({
        id: `tail-${index}`,
        kind: "activity" as const
      }))
    ];
    const html = renderToStaticMarkup(
      <VirtualTimeline
        items={items}
        scrollRef={{ current: null }}
        lockItemId="assistant-item_88"
        renderItem={(item) => <div>{item.id}</div>}
      />
    );
    expect(html).toContain("assistant-item_88");
    expect(html).not.toContain("assistant-old");
  });

  it("locks onto a grouped activity child after history prepend", () => {
    const items = [
      { id: "activity-group-old", kind: "activity", data: { items: [{ id: "tool-old" }] } },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `m-${index}`,
        kind: "assistant" as const,
        text: "hi"
      })),
      {
        id: "activity-group-live",
        kind: "activity",
        data: { items: [{ id: "tool-live-1" }, { id: "tool-live-2" }] }
      }
    ];
    const html = renderToStaticMarkup(
      <VirtualTimeline
        items={items}
        scrollRef={{ current: null }}
        lockItemId="tool-live-1"
        renderItem={(item) => <div>{item.id}</div>}
      />
    );
    expect(html).toContain("activity-group-live");
    expect(html).not.toContain("activity-group-old");
  });
});
