import { describe, expect, it } from "vitest";
import {
  PREVIEW_FRAME_CACHE_CHARS,
  PREVIEW_FRAME_CACHE_LIMIT,
  boundedImageSize,
  clearPreviewFrameCache,
  enqueueImageDecode,
  peekPreviewFrame,
  previewFrameCacheKey,
  readPreviewFrame,
  storePreviewFrame
} from "./bounded-image";

describe("boundedImageSize", () => {
  it("keeps small images unchanged", () => {
    expect(boundedImageSize(320, 180)).toEqual({ width: 320, height: 180 });
  });

  it("downscales 4k screenshots to the display budget", () => {
    expect(boundedImageSize(3840, 2160)).toEqual({ width: 455, height: 256 });
  });

  it("honors a wider file-preview budget", () => {
    expect(boundedImageSize(3840, 2160, 1600, 900)).toEqual({ width: 1600, height: 900 });
  });
});

describe("enqueueImageDecode", () => {
  it("runs tasks one at a time and skips aborted work", async () => {
    const order: string[] = [];
    const first = enqueueImageDecode(async () => {
      order.push("a-start");
      await Promise.resolve();
      order.push("a-end");
      return "a";
    });
    const aborted = new AbortController();
    aborted.abort();
    const skipped = enqueueImageDecode(async () => {
      order.push("skip");
      return "skip";
    }, aborted.signal);
    const second = enqueueImageDecode(async () => {
      order.push("b");
      return "b";
    });
    await expect(first).resolves.toBe("a");
    await expect(skipped).resolves.toBeUndefined();
    await expect(second).resolves.toBe("b");
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });
});

describe("preview frame cache", () => {
  it("keeps a decoded preview and refreshes it when viewed again", () => {
    clearPreviewFrameCache();
    const key = previewFrameCacheKey("/shots/a.png", 960, 256);
    storePreviewFrame(key, { src: "data:a", width: 120, height: 80 });
    expect(peekPreviewFrame(key)).toEqual({ src: "data:a", width: 120, height: 80 });
    expect(readPreviewFrame(key)?.src).toBe("data:a");
    expect(readPreviewFrame(previewFrameCacheKey("/missing.png", 960, 256))).toBeUndefined();
  });

  it("drops the least recently viewed preview after the cache is full", () => {
    clearPreviewFrameCache();
    for (let index = 0; index < PREVIEW_FRAME_CACHE_LIMIT; index += 1) {
      storePreviewFrame(`frame-${index}`, { src: `data:${index}`, width: 1, height: 1 });
    }
    expect(readPreviewFrame("frame-0")?.src).toBe("data:0");
    storePreviewFrame("frame-new", { src: "data:new", width: 1, height: 1 });
    expect(peekPreviewFrame("frame-0")?.src).toBe("data:0");
    expect(peekPreviewFrame("frame-1")).toBeUndefined();
    expect(peekPreviewFrame("frame-new")?.src).toBe("data:new");
  });

  it("evicts older previews when the compressed cache exceeds its byte budget", () => {
    clearPreviewFrameCache();
    storePreviewFrame("large-old", {
      src: "a".repeat(PREVIEW_FRAME_CACHE_CHARS),
      width: 2,
      height: 2
    });
    storePreviewFrame("large-new", { src: "b".repeat(20), width: 2, height: 2 });
    expect(peekPreviewFrame("large-old")).toBeUndefined();
    expect(peekPreviewFrame("large-new")?.src).toHaveLength(20);
    clearPreviewFrameCache();
  });
});
