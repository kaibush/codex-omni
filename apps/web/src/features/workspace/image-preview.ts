export type ImagePreviewTransform = {
  scale: number;
  x: number;
  y: number;
};

export type ImagePreviewPoint = {
  x: number;
  y: number;
};

export const IMAGE_PREVIEW_MIN_SCALE = 0.5;
export const IMAGE_PREVIEW_MAX_SCALE = 8;
export const IMAGE_PREVIEW_ZOOM_STEP = 1.25;

export function clampImagePreviewScale(scale: number) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(IMAGE_PREVIEW_MAX_SCALE, Math.max(IMAGE_PREVIEW_MIN_SCALE, scale));
}

export function clientPointInView(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number
): ImagePreviewPoint {
  return {
    x: clientX - (rect.left + rect.width / 2),
    y: clientY - (rect.top + rect.height / 2)
  };
}

export function imagePointFromView(
  transform: ImagePreviewTransform,
  point: ImagePreviewPoint
): ImagePreviewPoint {
  const scale = transform.scale || 1;
  return {
    x: (point.x - transform.x) / scale,
    y: (point.y - transform.y) / scale
  };
}

export function imagePreviewTransformForScale(
  anchor: ImagePreviewPoint,
  imagePoint: ImagePreviewPoint,
  nextScale: number
): ImagePreviewTransform {
  const scale = clampImagePreviewScale(nextScale);
  return {
    scale,
    x: anchor.x - imagePoint.x * scale,
    y: anchor.y - imagePoint.y * scale
  };
}

export function zoomImagePreview(
  transform: ImagePreviewTransform,
  anchor: ImagePreviewPoint,
  nextScale: number
) {
  return imagePreviewTransformForScale(anchor, imagePointFromView(transform, anchor), nextScale);
}

export function panImagePreview(
  origin: ImagePreviewTransform,
  dx: number,
  dy: number
): ImagePreviewTransform {
  return {
    scale: origin.scale,
    x: origin.x + dx,
    y: origin.y + dy
  };
}

export function pinchImagePreviewScale(
  startScale: number,
  startDistance: number,
  distance: number
) {
  if (
    !Number.isFinite(startDistance) ||
    startDistance <= 0 ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return clampImagePreviewScale(startScale);
  }
  return clampImagePreviewScale(startScale * (distance / startDistance));
}

export function pointerDistance(a: ImagePreviewPoint, b: ImagePreviewPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointerMidpoint(a: ImagePreviewPoint, b: ImagePreviewPoint): ImagePreviewPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function wheelImagePreviewFactor(deltaY: number) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const delta = Math.max(-120, Math.min(120, deltaY));
  return Math.exp(-delta * 0.002);
}

export function clampImagePreviewOffset(
  transform: ImagePreviewTransform,
  view: { width: number; height: number }
): ImagePreviewTransform {
  if (transform.scale <= 1) return { scale: transform.scale, x: 0, y: 0 };
  const limitX = Math.max(view.width, 1) * transform.scale;
  const limitY = Math.max(view.height, 1) * transform.scale;
  return {
    scale: transform.scale,
    x: Math.min(limitX, Math.max(-limitX, transform.x)),
    y: Math.min(limitY, Math.max(-limitY, transform.y))
  };
}
