import { describe, expect, it } from "vitest";
import {
  buildSystemUpdatePreview,
  localDateKey,
  parseDismissedUpdate,
  shouldSuppressUpdateDialog,
  SYSTEM_UPDATE_COMMANDS,
  SYSTEM_UPDATE_DOCKER_COMMANDS,
  SYSTEM_UPDATE_GITHUB_COMMAND,
  SYSTEM_UPDATE_NPM_COMMAND,
  type SystemVersionInfo
} from "./system-update";

const current: SystemVersionInfo = {
  status: "up_to_date",
  updateAvailable: false,
  currentVersion: "v0.1.0",
  latestVersion: "v0.1.0",
  releaseUrl: "https://github.com/kaibush/codex-omni/releases",
  releaseNotes: "",
  publishedAt: "",
  checkedAt: "",
  error: ""
};

describe("localDateKey", () => {
  it("formats a local calendar date", () => {
    expect(localDateKey(new Date(2026, 7, 6, 23, 15))).toBe("2026-08-06");
  });
});

describe("parseDismissedUpdate", () => {
  it("reads a stored version and date", () => {
    expect(parseDismissedUpdate(JSON.stringify({ version: "v1.1.0", date: "2026-08-26" }))).toEqual(
      {
        version: "v1.1.0",
        date: "2026-08-26"
      }
    );
  });

  it("ignores a previous session-only version string", () => {
    expect(parseDismissedUpdate("v1.1.0")).toBeNull();
    expect(parseDismissedUpdate(null)).toBeNull();
    expect(parseDismissedUpdate(JSON.stringify({ version: "v1.1.0" }))).toBeNull();
  });
});

describe("shouldSuppressUpdateDialog", () => {
  it("suppresses the same version dismissed today", () => {
    expect(shouldSuppressUpdateDialog("v1.1.0", { version: "v1.1.0", date: localDateKey() })).toBe(
      true
    );
  });

  it("does not suppress a different version or an old date", () => {
    expect(shouldSuppressUpdateDialog("v1.2.0", { version: "v1.1.0", date: localDateKey() })).toBe(
      false
    );
    expect(shouldSuppressUpdateDialog("v1.1.0", { version: "v1.1.0", date: "1999-01-01" })).toBe(
      false
    );
    expect(shouldSuppressUpdateDialog("v1.1.0", null)).toBe(false);
    expect(shouldSuppressUpdateDialog("", { version: "v1.1.0", date: localDateKey() })).toBe(false);
  });
});

describe("buildSystemUpdatePreview", () => {
  it("bumps the patch version for a local preview", () => {
    const preview = buildSystemUpdatePreview(current);
    expect(preview.status).toBe("update_available");
    expect(preview.updateAvailable).toBe(true);
    expect(preview.currentVersion).toBe("v0.1.0");
    expect(preview.latestVersion).toBe("v0.1.1");
    expect(preview.releaseUrl).toBe("https://github.com/kaibush/codex-omni/releases");
    expect(preview.releaseNotes).toContain("本地界面预览");
  });

  it("falls back to vNEXT when the current version is not semver", () => {
    expect(buildSystemUpdatePreview({ ...current, currentVersion: "dev" }).latestVersion).toBe(
      "vNEXT"
    );
  });
});

describe("SYSTEM_UPDATE_COMMANDS", () => {
  it("includes the npm package, GitHub tarball and Docker alternative", () => {
    expect(SYSTEM_UPDATE_NPM_COMMAND).toBe("npm i -g @kaibush/codex-omni");
    expect(SYSTEM_UPDATE_GITHUB_COMMAND).toContain("codex-omni.tgz");
    expect(SYSTEM_UPDATE_DOCKER_COMMANDS).toContain("docker compose pull");
    expect(SYSTEM_UPDATE_COMMANDS).toContain(SYSTEM_UPDATE_NPM_COMMAND);
    expect(SYSTEM_UPDATE_COMMANDS).toContain(SYSTEM_UPDATE_GITHUB_COMMAND);
    expect(SYSTEM_UPDATE_COMMANDS).toContain("docker compose up -d");
  });
});
