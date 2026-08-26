import { describe, expect, it } from "vitest";
import { currentAppVersion, normalizeVersion, resolveAppVersion } from "./app-version.js";

describe("normalizeVersion", () => {
  it("keeps empty and dev values, otherwise adds a v prefix", () => {
    expect(normalizeVersion("")).toBe("");
    expect(normalizeVersion("   ")).toBe("");
    expect(normalizeVersion("dev")).toBe("dev");
    expect(normalizeVersion("DEV")).toBe("dev");
    expect(normalizeVersion("0.1.0")).toBe("v0.1.0");
    expect(normalizeVersion("v1.2.3")).toBe("v1.2.3");
    expect(normalizeVersion("V1.2.3")).toBe("V1.2.3");
  });
});

describe("resolveAppVersion", () => {
  it("prefers CODEX_OMNI_VERSION over package.json", () => {
    expect(resolveAppVersion({ CODEX_OMNI_VERSION: " v2.5.0-hotfix.1 " })).toBe("v2.5.0-hotfix.1");
    expect(resolveAppVersion({})).toBe("0.1.0");
  });
});

describe("currentAppVersion", () => {
  it("normalizes the resolved version", () => {
    expect(currentAppVersion({ CODEX_OMNI_VERSION: "0.1.0" })).toBe("v0.1.0");
    expect(currentAppVersion({ CODEX_OMNI_VERSION: "v2.5.0-hotfix.1" })).toBe("v2.5.0-hotfix.1");
    expect(currentAppVersion({})).toBe("v0.1.0");
  });
});
