import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundledCodexCliPath, bundledCodexVersions } from "./codex-versions.js";

describe("bundled Codex versions", () => {
  it("reads matching SDK and CLI versions from the installed packages", () => {
    const versions = bundledCodexVersions();
    expect(versions.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions.cliVersion).toBe(versions.sdkVersion);
  });

  it("resolves the bundled CLI binary", () => {
    const cliPath = bundledCodexCliPath();
    expect(cliPath).toMatch(/codex(?:\.exe)?$/);
    expect(existsSync(cliPath)).toBe(true);
  });
});
