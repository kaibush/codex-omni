import { describe, expect, it } from "vitest";
import { buildCodexVersionWarnings, isLargeCodexVersionDrift } from "./codex-runtime-info.js";

describe("codex version drift", () => {
  it("treats a two-minor gap or major change as large drift", () => {
    expect(isLargeCodexVersionDrift("0.153.4", "0.154.0")).toBe(false);
    expect(isLargeCodexVersionDrift("0.153.4", "0.155.0")).toBe(true);
    expect(isLargeCodexVersionDrift("0.154.0", "1.0.0")).toBe(true);
    expect(isLargeCodexVersionDrift("0.154.0", "0.154.9")).toBe(false);
  });

  it("warns when SDK/CLI pins diverge or versions drift too far", () => {
    expect(
      buildCodexVersionWarnings({
        sdkVersion: "0.154.0",
        bundledCliVersion: "0.153.4",
        pathCliVersion: null,
        npmLatestVersion: null
      })
    ).toEqual([expect.stringContaining("不一致")]);
    expect(
      buildCodexVersionWarnings({
        sdkVersion: "0.152.0",
        bundledCliVersion: "0.152.0",
        pathCliVersion: "0.154.0",
        npmLatestVersion: "0.155.0-alpha.9"
      }).join("\n")
    ).toContain("PATH 上的 codex");
    expect(
      buildCodexVersionWarnings({
        sdkVersion: "0.152.0",
        bundledCliVersion: "0.152.0",
        pathCliVersion: null,
        npmLatestVersion: "0.154.0"
      }).join("\n")
    ).toContain("npm 最新稳定版");
  });
});
