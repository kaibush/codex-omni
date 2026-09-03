import { describe, expect, it } from "vitest";
import { boundedImageSize, enqueueImageDecode } from "./bounded-image";

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
