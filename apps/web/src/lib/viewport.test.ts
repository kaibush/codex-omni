import { describe, expect, it } from "vitest";
import { applyAppViewport, isStandaloneDisplay, resolveAppViewport } from "./viewport";

const iphone16Pro = {
  innerWidth: 402,
  screenWidth: 402,
  screenHeight: 874
};

describe("isStandaloneDisplay", () => {
  it("treats iOS home-screen web apps as standalone", () => {
    expect(isStandaloneDisplay({ navigatorStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({})).toBe(false);
  });
});

describe("resolveAppViewport", () => {
  it("fills the iOS PWA screen when visualViewport stays on the small viewport", () => {
    expect(
      resolveAppViewport({
        ...iphone16Pro,
        visualHeight: 779,
        visualOffsetTop: 0,
        innerHeight: 779,
        clientHeight: 779,
        standalone: true
      })
    ).toEqual({ height: 874, offsetTop: 0 });
  });

  it("fills Safari the same way so the composer can sit on the screen bottom", () => {
    expect(
      resolveAppViewport({
        ...iphone16Pro,
        visualHeight: 779,
        visualOffsetTop: 0,
        innerHeight: 779,
        clientHeight: 779,
        standalone: false
      })
    ).toEqual({ height: 874, offsetTop: 0 });
  });

  it("does not jump to an implausible screen height", () => {
    expect(
      resolveAppViewport({
        ...iphone16Pro,
        visualHeight: 500,
        visualOffsetTop: 0,
        innerHeight: 500,
        clientHeight: 500,
        screenHeight: 2000,
        standalone: true
      })
    ).toEqual({ height: 500, offsetTop: 0 });
  });

  it("keeps a full-height window even if innerHeight already recovered", () => {
    expect(
      resolveAppViewport({
        ...iphone16Pro,
        visualHeight: 779,
        visualOffsetTop: 0,
        innerHeight: 874,
        clientHeight: 874,
        standalone: false
      })
    ).toEqual({ height: 874, offsetTop: 0 });
  });

  it("uses the short screen side in landscape", () => {
    expect(
      resolveAppViewport({
        visualHeight: 320,
        visualOffsetTop: 0,
        innerWidth: 874,
        innerHeight: 320,
        clientHeight: 320,
        screenWidth: 402,
        screenHeight: 874,
        standalone: true
      })
    ).toEqual({ height: 402, offsetTop: 0 });
  });

  it("ignores a stale visualViewport offset when the keyboard is closed", () => {
    expect(
      resolveAppViewport({
        ...iphone16Pro,
        visualHeight: 779,
        visualOffsetTop: 47,
        innerHeight: 874,
        clientHeight: 874,
        standalone: false
      })
    ).toEqual({ height: 874, offsetTop: 0 });
  });

  it("shrinks to the visual viewport when the keyboard is open", () => {
    expect(
      resolveAppViewport({
        ...iphone16Pro,
        visualHeight: 430,
        visualOffsetTop: 0,
        innerHeight: 874,
        clientHeight: 874,
        standalone: true
      })
    ).toEqual({ height: 430, offsetTop: 0 });
  });

  it("keeps the keyboard offset so the focused composer stays visible", () => {
    expect(
      resolveAppViewport({
        ...iphone16Pro,
        visualHeight: 430,
        visualOffsetTop: 86,
        innerHeight: 874,
        clientHeight: 874,
        standalone: false
      })
    ).toEqual({ height: 430, offsetTop: 86 });
  });
});

describe("applyAppViewport", () => {
  it("writes CSS custom properties for the layout shell", () => {
    const values = new Map<string, string>();
    const target = {
      style: {
        setProperty: (key: string, value: string) => {
          values.set(key, value);
        },
        getPropertyValue: (key: string) => values.get(key) ?? ""
      }
    } as unknown as HTMLElement;
    applyAppViewport(target, { height: 874, offsetTop: 12 });
    expect(target.style.getPropertyValue("--app-viewport-height")).toBe("874px");
    expect(target.style.getPropertyValue("--app-viewport-offset-top")).toBe("12px");
  });
});
