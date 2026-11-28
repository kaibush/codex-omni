import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createChatSession, ensureWorkspace } from "./helpers";

test("runs a multi-file animation outside the project without leaving the conversation", async ({
  page
}) => {
  await ensureWorkspace(page);
  const { project, session, provider } = await createChatSession(page);
  const directory = await mkdtemp(path.join(os.tmpdir(), "omni-animation-"));
  try {
    await mkdir(path.join(directory, "assets"));
    for (const [name, content] of Object.entries({
      "index.html":
        '<link rel="stylesheet" href="assets/main.css"><canvas></canvas><button id="pause">暂停</button><i id="cdn"></i><script type="module" src="assets/main.js"></script><script src="https://cdn.example.test/extra.js"></script>',
      "assets/main.css": '@import "motion.css"; canvas { background-image:url(dot.svg) }',
      "assets/motion.css":
        "@keyframes slide {to {transform:translateX(20px)}} canvas {animation: slide 2s linear infinite}",
      "assets/dot.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><circle r="2" fill="red" /></svg>',
      "assets/main.js":
        'import {draw} from "./draw.mjs"; const {color}=await (await fetch("colors.json")).json(); let frames=0; let running=true; const canvas=document.querySelector("canvas"); function step(){draw(canvas,color);canvas.dataset.frames=String(++frames);if(running)requestAnimationFrame(step)} requestAnimationFrame(step); document.querySelector("#pause").onclick=()=>{ running=false; document.querySelector("#pause").textContent="已暂停"; };',
      "assets/draw.mjs":
        'export function draw(canvas,color){const ctx=canvas.getContext("2d");ctx.fillStyle=color;ctx.fillRect(0,0,10,10)}',
      "colors.json": '{"color":"#ff0000"}'
    }))
      await writeFile(path.join(directory, name), content);
    await page.route(`**/api/sessions/${session.id}?*`, async (route) => {
      const response = await route.fetch();
      const detail = await response.json();
      const timestamp = Date.now();
      await route.fulfill({
        response,
        json: {
          ...detail,
          messages: [
            {
              id: "preview",
              sessionId: session.id,
              role: "assistant",
              content: `[动画示例](${directory}/index.html)`,
              providerId: provider.id,
              eventType: "assistant.completed",
              itemId: "demo:reply:1",
              dataJson: '{"completed":true}',
              createdAt: timestamp,
              updatedAt: timestamp
            }
          ]
        }
      });
    });
    let externalRequests = 0;
    await page.route("https://cdn.example.test/extra.js", (route) => {
      externalRequests++;
      return route.fulfill({
        contentType: "text/javascript",
        body: 'document.querySelector("#cdn").textContent="外部资源已运行"'
      });
    });
    const sessionPath = `/projects/${project.id}/sessions/${session.id}`;
    await page.goto(sessionPath);
    const composer = page.locator(".composer-shell textarea");
    await composer.fill("保留这段草稿");
    await page.getByRole("button", { name: "动画示例", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const frame = dialog.frameLocator("iframe");
    const canvas = frame.locator("canvas");
    await expect
      .poll(() => canvas.evaluate((element) => Number(element.dataset.frames)))
      .toBeGreaterThan(3);
    expect(
      await canvas.evaluate((element: HTMLCanvasElement) =>
        Array.from(element.getContext("2d")!.getImageData(0, 0, 1, 1).data)
      )
    ).toEqual([255, 0, 0, 255]);
    await expect(canvas).toHaveCSS("animation-name", "slide");
    await expect
      .poll(() => canvas.evaluate((element) => Number(element.getAnimations()[0]?.currentTime)))
      .toBeGreaterThan(0);
    await expect(canvas).toHaveCSS("background-image", /data:image\/svg\+xml/);
    await frame.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(frame.getByRole("button", { name: "已暂停" })).toBeVisible();
    await dialog.getByRole("button", { name: "重新运行" }).click();
    await expect(frame.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    expect(externalRequests).toBe(0);
    await dialog.getByRole("button", { name: "允许加载外部资源" }).click();
    await expect(frame.locator("#cdn")).toHaveText("外部资源已运行");
    await dialog.getByRole("button", { name: "关闭预览" }).click();
    await expect(composer).toHaveValue("保留这段草稿");
    expect(new URL(page.url()).pathname).toBe(sessionPath);
    expect(page.context().pages()).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
