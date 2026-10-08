import { describe, expect, it } from "vitest";
import {
  IMAGE_PREVIEW_MAX_SCALE,
  IMAGE_PREVIEW_MIN_SCALE,
  clampImagePreviewOffset,
  clientPointInView,
  imagePointFromView,
  panImagePreview,
  pinchImagePreviewScale,
  pointerDistance,
  pointerMidpoint,
  wheelImagePreviewFactor,
  zoomImagePreview
} from "./image-preview";

describe("image preview transform", () => {
  it("zooms toward the pointer instead of the viewport center", () => {
    const next = zoomImagePreview({ scale: 1, x: 0, y: 0 }, { x: 40, y: -20 }, 2);
    expect(next.scale).toBe(2);
    expect(next).toEqual({ scale: 2, x: -40, y: 20 });
    expect(imagePointFromView(next, { x: 40, y: -20 })).toEqual({ x: 40, y: -20 });
  });

  it("keeps the pinch anchor fixed while the distance changes", () => {
    const start = { scale: 2, x: -40, y: 20 };
    const anchor = { x: 40, y: -20 };
    const imagePoint = imagePointFromView(start, anchor);
    const scale = pinchImagePreviewScale(start.scale, 100, 150);
    const next = zoomImagePreview(start, anchor, scale);
    expect(scale).toBe(3);
    expect(imagePointFromView(next, anchor)).toEqual(imagePoint);
  });

  it("clamps pinch scale and recenters once zoomed back to fit", () => {
    expect(pinchImagePreviewScale(6, 20, 80)).toBe(IMAGE_PREVIEW_MAX_SCALE);
    expect(pinchImagePreviewScale(0.8, 80, 20)).toBe(IMAGE_PREVIEW_MIN_SCALE);
    expect(
      clampImagePreviewOffset({ scale: 1, x: 30, y: -12 }, { width: 200, height: 100 })
    ).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("pans from the gesture origin and maps wheel deltas to a zoom factor", () => {
    expect(panImagePreview({ scale: 2, x: 4, y: 6 }, 10, -3)).toEqual({ scale: 2, x: 14, y: 3 });
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pointerMidpoint({ x: 0, y: 2 }, { x: 4, y: 6 })).toEqual({ x: 2, y: 4 });
    expect(clientPointInView({ left: 10, top: 20, width: 100, height: 80 }, 60, 60)).toEqual({
      x: 0,
      y: 0
    });
    expect(wheelImagePreviewFactor(-100)).toBeGreaterThan(1);
    expect(wheelImagePreviewFactor(100)).toBeLessThan(1);
  });
});
