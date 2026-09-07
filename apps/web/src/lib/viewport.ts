const KEYBOARD_INSET_PX = 120;

export type AppViewportMetrics = {
  visualHeight: number;
  visualOffsetTop: number;
  innerWidth: number;
  innerHeight: number;
  clientHeight: number;
  screenWidth: number;
  screenHeight: number;
  standalone: boolean;
};

export type AppViewport = {
  height: number;
  offsetTop: number;
};

function positive(value: number | undefined | null) {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
}

export function isStandaloneDisplay(input: {
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
}) {
  return Boolean(input.displayModeStandalone || input.navigatorStandalone);
}

export function readAppViewportMetrics(): AppViewportMetrics {
  const visual = window.visualViewport;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return {
    visualHeight: visual?.height ?? 0,
    visualOffsetTop: visual?.offsetTop ?? 0,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientHeight: document.documentElement.clientHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    standalone: isStandaloneDisplay({
      displayModeStandalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches,
      navigatorStandalone: Boolean(navigatorWithStandalone.standalone)
    })
  };
}

export function resolveAppViewport(metrics: AppViewportMetrics): AppViewport {
  const visualHeight = positive(metrics.visualHeight);
  const innerHeight = positive(metrics.innerHeight);
  const clientHeight = positive(metrics.clientHeight);
  const visualOffsetTop = positive(metrics.visualOffsetTop);
  const layoutHeight = Math.max(innerHeight, clientHeight, visualHeight);
  const keyboardOpen = visualHeight > 0 && layoutHeight - visualHeight > KEYBOARD_INSET_PX;

  if (keyboardOpen) {
    return { height: visualHeight, offsetTop: visualOffsetTop };
  }

  if (metrics.standalone) {
    const landscape = positive(metrics.innerWidth) > innerHeight;
    const screenHeight = landscape
      ? Math.min(positive(metrics.screenWidth), positive(metrics.screenHeight))
      : Math.max(positive(metrics.screenWidth), positive(metrics.screenHeight));
    const visibleHeight = Math.max(layoutHeight, visualHeight + visualOffsetTop);
    const chromeGap = screenHeight - visibleHeight;
    return {
      height: chromeGap > 0 && chromeGap <= 140 ? screenHeight : visibleHeight,
      offsetTop: 0
    };
  }

  if (visualHeight > 0) {
    return { height: visualHeight, offsetTop: visualOffsetTop };
  }
  return { height: layoutHeight, offsetTop: 0 };
}

export function applyAppViewport(
  target: HTMLElement,
  viewport: AppViewport = resolveAppViewport(readAppViewportMetrics())
) {
  if (viewport.height <= 0) return;
  target.style.setProperty("--app-viewport-height", `${viewport.height}px`);
  target.style.setProperty("--app-viewport-offset-top", `${viewport.offsetTop}px`);
}

export function bindAppViewport(target: HTMLElement = document.documentElement) {
  let frame = 0;
  const sync = () => {
    frame = 0;
    applyAppViewport(target);
  };
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(sync);
  };
  sync();
  const delayed = window.setTimeout(sync, 250);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("pageshow", schedule);
  return () => {
    window.clearTimeout(delayed);
    if (frame) window.cancelAnimationFrame(frame);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("pageshow", schedule);
  };
}
