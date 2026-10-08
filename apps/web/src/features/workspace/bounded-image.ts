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

export type PreviewFrame = {
  src: string;
  width: number;
  height: number;
};

export const PREVIEW_FRAME_CACHE_LIMIT = 160;
export const PREVIEW_FRAME_CACHE_CHARS = 32_000_000;

const previewFrames = new Map<string, PreviewFrame>();

export function previewFrameCacheKey(src: string, maxWidth: number, maxHeight: number) {
  return `${Math.round(maxWidth)}x${Math.round(maxHeight)}:${src}`;
}

export function peekPreviewFrame(key: string) {
  return previewFrames.get(key);
}

export function readPreviewFrame(key: string) {
  const hit = previewFrames.get(key);
  if (!hit) return undefined;
  previewFrames.delete(key);
  previewFrames.set(key, hit);
  return hit;
}

export function storePreviewFrame(key: string, frame: PreviewFrame) {
  if (!key || !frame.src) return;
  if (previewFrames.has(key)) previewFrames.delete(key);
  previewFrames.set(key, frame);
  let chars = 0;
  for (const item of previewFrames.values()) chars += item.src.length;
  while (
    previewFrames.size > 1 &&
    (previewFrames.size > PREVIEW_FRAME_CACHE_LIMIT || chars > PREVIEW_FRAME_CACHE_CHARS)
  ) {
    const oldest = previewFrames.keys().next().value;
    if (!oldest) break;
    chars -= previewFrames.get(oldest)?.src.length ?? 0;
    previewFrames.delete(oldest);
  }
}

export function clearPreviewFrameCache() {
  previewFrames.clear();
}
