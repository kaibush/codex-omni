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
  });
});
