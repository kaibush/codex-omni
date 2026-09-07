import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderRuntimeFields } from "./ProviderRuntimeFields";

describe("provider runtime fields", () => {
  it("renders optional compact numeric controls without a guessed default", () => {
    const html = renderToStaticMarkup(
      <ProviderRuntimeFields value={{}} onChange={() => undefined} />
    );
    expect(html.match(/type="number"/g)).toHaveLength(2);
    expect(html).toContain("h-8 rounded-lg");
    expect(html).toContain("不再按模型名称猜测容量");
    expect(html).not.toContain("256000");
  });
  it("renders persisted provider-specific limits", () => {
    const html = renderToStaticMarkup(
      <ProviderRuntimeFields
        value={{ contextWindow: 32000, autoCompactTokenLimit: 28000 }}
        onChange={() => undefined}
      />
    );
    expect(html).toContain('value="32000"');
    expect(html).toContain('value="28000"');
  });
});
