export const BOUNDED_IMAGE_MAX_WIDTH = 960;
export const BOUNDED_IMAGE_MAX_HEIGHT = 256;
export const FILE_PREVIEW_IMAGE_MAX_WIDTH = 1600;
export const FILE_PREVIEW_IMAGE_MAX_HEIGHT = 900;

let decodeChain: Promise<void> = Promise.resolve();

export function boundedImageSize(
  width: number,
  height: number,
  maxWidth = BOUNDED_IMAGE_MAX_WIDTH,
  maxHeight = BOUNDED_IMAGE_MAX_HEIGHT
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function enqueueImageDecode<T>(
  task: () => Promise<T>,
  signal?: AbortSignal
): Promise<T | undefined> {
  const run = decodeChain.then(async () => {
    if (signal?.aborted) return undefined;
    return task();
  });
  decodeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
