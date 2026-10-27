/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { applyDocumentIcon, brandIconFileError, normalizeBranding } from "./branding";

describe("brandIconFileError", () => {
  it("accepts a small png and rejects other files", () => {
    expect(brandIconFileError({ name: "logo.PNG", type: "", size: 128 })).toBeNull();
    expect(brandIconFileError({ name: "logo.txt", type: "image/webp", size: 128 })).toBeNull();
    expect(brandIconFileError({ name: "logo.pdf", type: "application/pdf", size: 128 })).toBe(
      "只支持 PNG、JPG、WEBP、GIF、ICO 或 SVG"
    );
    expect(brandIconFileError({ name: "logo.png", type: "image/png", size: 0 })).toBe(
      "图标文件是空的"
    );
    expect(brandIconFileError({ name: "logo.png", type: "image/png", size: 512 * 1024 + 1 })).toBe(
      "图标不能超过 512 KB"
    );
  });
});

describe("normalizeBranding", () => {
  it("keeps only the local icon endpoint", () => {
    expect(
      normalizeBranding({
        iconUrl: "/api/branding/icon?v=3",
        contentType: "image/png",
        updatedAt: 3
      })
    ).toEqual({
      iconUrl: "/api/branding/icon?v=3",
      contentType: "image/png",
      updatedAt: 3
    });
    expect(normalizeBranding({ iconUrl: "https://evil.example/icon.png" })).toEqual({
      iconUrl: null,
      contentType: null,
      updatedAt: null
    });
  });
});

describe("applyDocumentIcon", () => {
  it("replaces every tab icon and can restore the built-in ones", () => {
    document.head.innerHTML = `
      <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2" />
      <link rel="shortcut icon" href="/favicon.ico?v=2" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" />
    `;
    applyDocumentIcon({
      iconUrl: "/api/branding/icon?v=9",
      contentType: "image/png",
      updatedAt: 9
    });
    const links = [...document.head.querySelectorAll("link")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/api/branding/icon?v=9",
      "/api/branding/icon?v=9",
      "/api/branding/icon?v=9"
    ]);
    expect(links.every((link) => link.getAttribute("type") === "image/png")).toBe(true);

    applyDocumentIcon({ iconUrl: null, contentType: null, updatedAt: null });
    expect(
      [...document.head.querySelectorAll("link")].map((link) => link.getAttribute("href"))
    ).toEqual(["/favicon.svg?v=2", "/favicon.ico?v=2", "/apple-touch-icon.png?v=2"]);
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("type")).toBe(
      "image/svg+xml"
    );
  });
});
