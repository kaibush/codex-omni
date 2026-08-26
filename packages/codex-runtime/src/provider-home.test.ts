import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertExternalCodexHome, resolveProviderHome } from "./provider-home.js";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("provider home", () => {
  it("rejects relative, missing and invalid external homes", async () => {
    await expect(assertExternalCodexHome("relative/path")).rejects.toThrow("绝对路径");
    await expect(assertExternalCodexHome("/no/such/codex-home-xyz")).rejects.toThrow("不存在");
    await expect(assertExternalCodexHome("/tmp/foo/../bar")).rejects.toThrow("路径无效");
  });

  it("resolves an existing external home without materializing files", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "codex-home-"));
    const home = await resolveProviderHome({
      providersRoot: path.join(dir, "providers"),
      providerId: "p1",
      homeMode: "external",
      codexHomePath: dir
    });
    expect(home).toBe(path.resolve(dir));
  });

  it("materializes managed and api-key homes under the providers root", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "codex-home-"));
    const home = await resolveProviderHome({
      providersRoot: dir,
      providerId: "p1",
      homeMode: "api-key",
      configToml: 'model = "gpt-5"\n',
      authJson: '{"OPENAI_API_KEY":"sk"}'
    });
    expect(home).toBe(path.join(dir, "p1"));
  });
});
