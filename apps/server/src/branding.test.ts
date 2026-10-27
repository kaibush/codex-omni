import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_BRAND_ICON_BYTES,
  clearBrandIcon,
  detectBrandIcon,
  readBrandIconFile,
  readBranding,
  saveBrandIcon
} from "./branding.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("detectBrandIcon", () => {
  it("accepts common raster icons and a plain svg", () => {
    expect(detectBrandIcon(png).contentType).toBe("image/png");
    expect(detectBrandIcon(Buffer.from([0xff, 0xd8, 0xff, 0x00])).contentType).toBe("image/jpeg");
    expect(detectBrandIcon(Buffer.from("GIF89a", "ascii")).contentType).toBe("image/gif");
    expect(
      detectBrandIcon(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))
        .contentType
    ).toBe("image/webp");
    expect(detectBrandIcon(Buffer.from([0, 0, 1, 0, 1, 0])).contentType).toBe("image/x-icon");
    expect(
      detectBrandIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8"))
        .contentType
    ).toBe("image/svg+xml");
  });

  it("rejects empty, oversized, scripted svg and unknown files", () => {
    expect(() => detectBrandIcon(Buffer.alloc(0))).toThrow("图标文件是空的");
    expect(() => detectBrandIcon(Buffer.alloc(MAX_BRAND_ICON_BYTES + 1))).toThrow(
      "图标不能超过 512 KB"
    );
    expect(() =>
      detectBrandIcon(Buffer.from("<svg><script>alert(1)</script></svg>", "utf8"))
    ).toThrow("SVG 图标包含不受支持的内容");
    expect(() => detectBrandIcon(Buffer.from("<html></html>", "utf8"))).toThrow(
      "只支持 PNG、JPG、WEBP、GIF、ICO 或 SVG"
    );
  });
});

describe("brand icon storage", () => {
  it("saves one icon, serves its public descriptor, then clears it", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "omni-brand-"));
    expect(await readBranding(directory)).toEqual({
      iconUrl: null,
      contentType: null,
      updatedAt: null
    });

    const saved = await saveBrandIcon(directory, png);
    expect(saved.contentType).toBe("image/png");
    expect(saved.iconUrl).toBe(`/api/branding/icon?v=${saved.updatedAt}`);
    expect(await readBranding(directory)).toEqual(saved);

    const file = await readBrandIconFile(directory);
    expect(file?.buffer.equals(png)).toBe(true);
    expect(file?.contentType).toBe("image/png");

    expect(await clearBrandIcon(directory)).toEqual({
      iconUrl: null,
      contentType: null,
      updatedAt: null
    });
    expect(await readBrandIconFile(directory)).toBeNull();
  });
});
