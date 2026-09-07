export type RuntimeOptionsAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type RuntimeOptionsBox = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const MARGIN = 12;
const GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function placeRuntimeOptionsPanel(input: {
  anchor: RuntimeOptionsAnchor;
  viewport: { width: number; height: number };
  panelHeight?: number;
  narrow?: boolean;
}): RuntimeOptionsBox {
  const viewportWidth = Math.max(0, input.viewport.width);
  const viewportHeight = Math.max(0, input.viewport.height);
  const width = input.narrow
    ? Math.max(0, viewportWidth - MARGIN * 2)
    : Math.min(352, Math.max(0, viewportWidth - MARGIN * 2));
  const maxHeight = Math.min(viewportHeight * 0.7, 448);
  const panelHeight = Math.min(
    input.panelHeight && input.panelHeight > 0 ? input.panelHeight : Math.min(maxHeight, 320),
    maxHeight || 320
  );
  const left = input.narrow
    ? MARGIN
    : clamp(input.anchor.right - width, MARGIN, Math.max(MARGIN, viewportWidth - width - MARGIN));
  const topIfAbove = input.anchor.top - panelHeight - GAP;
  const topIfBelow = input.anchor.bottom + GAP;
  let top = topIfAbove >= MARGIN ? topIfAbove : topIfBelow;
  const maxTop = Math.max(MARGIN, viewportHeight - panelHeight - MARGIN);
  top = clamp(top, MARGIN, maxTop);
  return { top, left, width, maxHeight };
}
