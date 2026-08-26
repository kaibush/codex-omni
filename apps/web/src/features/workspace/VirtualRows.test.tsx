import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VirtualRows } from "./VirtualRows";

describe("VirtualRows", () => {
  it("renders short lists in full", () => {
    const html = renderToStaticMarkup(
      <VirtualRows
        items={["a", "b"]}
        itemHeight={20}
        height={80}
        renderItem={(item) => <div key={item}>{item}</div>}
      />
    );
    expect(html).toContain("a");
    expect(html).toContain("b");
    expect(html).not.toContain("virtual-rows");
  });
});
