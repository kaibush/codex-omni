import { describe, expect, it } from "vitest";
import { defaultWorkspaceView, settingsPath, workspacePath } from "./routes";

describe("workspacePath", () => {
  it("builds project and session URLs", () => {
    expect(workspacePath()).toBe("/");
    expect(workspacePath(null, "session")).toBe("/");
    expect(workspacePath("proj")).toBe("/projects/proj");
    expect(workspacePath("proj", "")).toBe("/projects/proj");
    expect(workspacePath("proj", "sess")).toBe("/projects/proj/sessions/sess");
  });

  it("encodes reserved characters", () => {
    expect(workspacePath("a/b", "c d")).toBe("/projects/a%2Fb/sessions/c%20d");
  });
});

describe("settingsPath", () => {
  it("builds global and project settings routes", () => {
    expect(settingsPath()).toBe("/settings/system-info");
    expect(settingsPath("runtime")).toBe("/settings/runtime");
    expect(settingsPath("templates")).toBe("/settings/templates");
  });
});

describe("defaultWorkspaceView", () => {
  it("opens chat for a project and a session", () => {
    expect(defaultWorkspaceView()).toBe("chat");
    expect(defaultWorkspaceView("")).toBe("chat");
    expect(defaultWorkspaceView("sess")).toBe("chat");
  });
});
