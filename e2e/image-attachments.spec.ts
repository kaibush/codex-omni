import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { apiJson, createChatSession, ensureWorkspace } from "./helpers";

const MAX_BYTES = 2 * 1024 * 1024;
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function makeImage(page: Page, mime: "image/jpeg" | "image/png") {
  const base64 = await page.evaluate((type) => {
    const canvas = document.createElement("canvas");
    canvas.width = type === "image/jpeg" ? 4032 : 1800;
    canvas.height = type === "image/jpeg" ? 3024 : 1600;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 123456;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >>> 8) & 255;
      pixels.data[i + 2] = (seed >>> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    if (type === "image/png") context.clearRect(0, 0, 100, 100);
    return canvas.toDataURL(type, 0.95).split(",")[1]!;
  }, mime);
  const bytes = Buffer.from(base64, "base64");
  expect(bytes.length).toBeGreaterThan(MAX_BYTES);
  if (mime !== "image/jpeg") return bytes;
  // A phone JPEG stored sideways with EXIF orientation 6 must remain upright.
  const orientation = Buffer.from([
    0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0,
    0, 0, 6, 0, 0, 0, 0, 0, 0, 0
  ]);
  return Buffer.concat([bytes.subarray(0, 2), orientation, bytes.subarray(2)]);
}

async function fixture(page: Page, client = "codex") {
  // The shared login helper waits for the desktop sidebar's new-chat button.
  await page.setViewportSize({ width: 1280, height: 900 });
  await ensureWorkspace(page);
  const created = await createChatSession(page);
  let session = created.session;
  if (client === "claude-code") {
    const provider = await apiJson<{ id: string }>(page.request, "/api/providers", {
      method: "POST",
      csrf: created.csrf,
      data: {
        name: `Photo Claude ${created.session.id}`,
        kind: "claude-code",
        homeMode: "api-key",
        apiKey: "fixture-key",
        baseUrl: "http://127.0.0.1:1",
        model: "sonnet",
        models: ["sonnet"]
      }
    });
    session = await apiJson<{ id: string }>(
      page.request,
      `/api/projects/${created.project.id}/sessions`,
      {
        method: "POST",
        csrf: created.csrf,
        data: { clientType: client, providerId: provider.id }
      }
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${created.project.id}/sessions/${session.id}`);
  await expect(page.getByPlaceholder(/询问 (Codex|Claude Code)/)).toBeVisible();
  return { ...created, session };
}

async function previewInfo(page: Page, index = 0) {
  const preview = page.locator(".composer-attachment img").nth(index);
  await expect(preview).toBeVisible();
  return preview.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const blob = await (await fetch(element.src)).blob();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(element, 0, 0);
    return {
      size: blob.size,
      mime: blob.type,
      width: element.naturalWidth,
      height: element.naturalHeight,
      alpha: context.getImageData(0, 0, 1, 1).data[3]
    };
  });
}

async function holdImageEncoding(page: Page) {
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    const read = File.prototype.arrayBuffer;
    (window as any).completedPhotoReads = [];
    File.prototype.arrayBuffer = function () {
      const result = read.call(this);
      if (this.type.startsWith("image/") && this.size <= 2 * 1024 * 1024) {
        void result.then(() => {
          setTimeout(() => (window as any).completedPhotoReads.push(this.name), 0);
        });
      }
      return result;
    };
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as any).releaseImageEncoding = release;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      void ready.then(() => original.apply(this, args));
    };
  });
}

for (const client of ["codex", "claude-code"]) {
  test(`compresses and uploads an upright phone photo in ${client}`, async ({ page }, testInfo) => {
    const created = await fixture(page, client);
    const photo = await makeImage(page, "image/jpeg");
    await holdImageEncoding(page);
    const composer = page.getByPlaceholder(/询问 (Codex|Claude Code)/);
    await composer.fill("看看这张照片");
    await page.locator('footer input[type="file"]').setInputFiles({
      name: "camera.jpg",
      mimeType: "image/jpeg",
      buffer: photo
    });
    await expect(page.getByRole("status").filter({ hasText: "正在处理附件" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "正在处理附件，请稍候", exact: true })
    ).toBeDisabled();
    await composer.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => (window as any).releaseImageEncoding());
    const image = await previewInfo(page);
    expect(image.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(image.mime).toBe("image/jpeg");
    expect(image.height).toBeGreaterThan(image.width);
    expect(image.height).toBeLessThanOrEqual(2560);
    expect(image.width / image.height).toBeCloseTo(3 / 4, 2);
    await expect(page.getByRole("status").filter({ hasText: "正在处理附件" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("compressed-photo-mobile.png") });

    const uploaded = page.waitForResponse(
      (response) =>
        response.url().includes("/files/upload?") && response.request().method() === "PUT"
    );
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const confirm = page.getByRole("button", { name: "使用该模型发送", exact: true });
    await Promise.race([
      uploaded,
      confirm.waitFor({ state: "visible" }).then(() => confirm.click())
    ]);
    const response = await uploaded;
    expect(response.status()).toBe(200);
    const payload = response.request().postDataBuffer()!;
    expect(payload.length).toBe(image.size);
    const savedPath = new URL(response.url()).searchParams.get("path")!;
    expect(savedPath).toMatch(/\.codex-uploads\/.*-camera\.jpg$/);
    expect(await readFile(path.join(created.directory, savedPath))).toEqual(payload);
    await expect(page.locator(".composer-attachment")).toHaveCount(0);
  });
}

test("compresses pasted and dropped PNGs while preserving transparency", async ({ page }) => {
  await fixture(page);
  const png = await makeImage(page, "image/png");
  for (const entry of ["paste", "drop"]) {
    await page.evaluate(
      ({ base64, entry }) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], `${entry}.png`, { type: "image/png" }));
        const target = document.querySelector("footer textarea")!;
        target.dispatchEvent(
          entry === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true
              })
            : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true })
        );
      },
      { base64: png.toString("base64"), entry }
    );
    await expect(page.locator(".composer-attachment")).toHaveCount(entry === "paste" ? 1 : 2);
  }
  for (let index = 0; index < 2; index++) {
    const image = await previewInfo(page, index);
    expect(image.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(["image/webp", "image/png"]).toContain(image.mime);
    expect(image.alpha).toBe(0);
    await expect(page.locator(".composer-attachment").nth(index)).toContainText(
      `${index === 0 ? "paste" : "drop"}.${image.mime === "image/webp" ? "webp" : "png"}`
    );
  }
});

test("a broken photo releases the composer and preserves existing attachments", async ({
  page
}) => {
  await fixture(page);
  const input = page.locator('footer input[type="file"]');
  await input.setInputFiles({
    name: "note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("keep this")
  });
  await expect(page.locator(".composer-attachment")).toContainText("note.txt");
  await input.setInputFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(MAX_BYTES + 1)
  });
  await expect(
    page.getByText("broken.jpg 无法读取，请改用 JPG、PNG 或 WebP 图片", { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "正在处理附件" })).toHaveCount(0);
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
  await input.setInputFiles({
    name: "next.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("next")
  });
  await expect(page.locator(".composer-attachment")).toHaveCount(2);
});

test("finishing photo processing does not add it to a different conversation", async ({ page }) => {
  const created = await fixture(page);
  const photo = await makeImage(page, "image/jpeg");
  await holdImageEncoding(page);
  await page
    .locator('footer input[type="file"]')
    .setInputFiles({ name: "old.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("status").filter({ hasText: "正在处理附件" })).toBeVisible();
  const next = await apiJson<{ id: string }>(
    page.request,
    `/api/projects/${created.project.id}/sessions`,
    {
      method: "POST",
      csrf: created.csrf,
      data: { providerId: created.provider.id }
    }
  );
  // Use client-side navigation so the original compression is still pending.
  await page.evaluate((url) => {
    history.pushState(null, "", url);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/projects/${created.project.id}/sessions/${next.id}`);
  await expect(page.getByRole("status").filter({ hasText: "正在处理附件" })).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseImageEncoding());
  await expect(page.locator(".composer-attachment")).toHaveCount(0);
  // A new attachment can be added while the old session's encoding completes.
  await page
    .locator('footer input[type="file"]')
    .setInputFiles({ name: "new.txt", mimeType: "text/plain", buffer: Buffer.from("new session") });
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).completedPhotoReads))
    .toContain("old.jpg");
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
  await expect(page.locator(".composer-attachment")).toContainText("new.txt");
});

test("terminal photo uploads also use the compressed bytes", async ({ page }) => {
  const created = await fixture(page);
  const photo = await makeImage(page, "image/jpeg");
  const terminal = await apiJson<{ session: { id: string } }>(
    page.request,
    `/api/projects/${created.project.id}/terminal-sessions`,
    {
      method: "POST",
      csrf: created.csrf,
      data: { title: "Photo terminal", profileId: "shell" }
    }
  );
  await page.goto(`/projects/${created.project.id}/sessions/${terminal.session.id}`);
  await expect(page.getByRole("textbox", { name: "发送到终端", exact: true })).toBeVisible();
  await holdImageEncoding(page);
  const input = page.locator('footer input[type="file"]');
  await input.setInputFiles({ name: "terminal.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("status").filter({ hasText: "正在处理附件" })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送到终端", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).releaseImageEncoding());
  const image = await previewInfo(page);
  expect(image.size).toBeLessThanOrEqual(MAX_BYTES);
  const uploaded = page.waitForResponse(
    (response) => response.url().includes("/files/upload?") && response.request().method() === "PUT"
  );
  await page.getByRole("button", { name: "发送到终端", exact: true }).click();
  const response = await uploaded;
  expect(response.status()).toBe(200);
  const savedPath = new URL(response.url()).searchParams.get("path")!;
  expect((await readFile(path.join(created.directory, savedPath))).length).toBe(image.size);
  await expect(page.getByRole("textbox", { name: "发送到终端", exact: true })).toHaveValue(
    new RegExp("terminal\\.jpg")
  );
});
