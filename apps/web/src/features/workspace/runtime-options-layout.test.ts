import { describe, expect, it } from "vitest";
import { placeRuntimeOptionsPanel } from "./runtime-options-layout";

describe("placeRuntimeOptionsPanel", () => {
  it("places the panel above the lock button on a phone", () => {
    expect(
      placeRuntimeOptionsPanel({
        anchor: { top: 700, right: 360, bottom: 732, left: 320, width: 40, height: 32 },
        viewport: { width: 390, height: 750 },
        panelHeight: 320,
        narrow: true
      })
    ).toEqual({
      top: 372,
      left: 12,
      width: 366,
      maxHeight: 448
    });
  });

  it("right-aligns to the lock button on desktop", () => {
    expect(
      placeRuntimeOptionsPanel({
        anchor: { top: 900, right: 980, bottom: 932, left: 820, width: 160, height: 32 },
        viewport: { width: 1280, height: 960 },
        panelHeight: 280,
        narrow: false
      })
    ).toEqual({
      top: 612,
      left: 628,
      width: 352,
      maxHeight: 448
    });
  });

  it("drops below the button when there is not enough room above", () => {
    expect(
      placeRuntimeOptionsPanel({
        anchor: { top: 40, right: 200, bottom: 72, left: 160, width: 40, height: 32 },
        viewport: { width: 390, height: 750 },
        panelHeight: 320,
        narrow: true
      }).top
    ).toBe(80);
  });
});
