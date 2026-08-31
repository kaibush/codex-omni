import { describe, expect, it } from "vitest";
import { mergeToolPayload } from "./tool-payload.js";

describe("mergeToolPayload", () => {
  it("keeps view_image input.path when tool.output omits it", () => {
    const merged = mergeToolPayload(
      {
        tool: "view_image",
        phase: "started",
        input: { path: "/repo/.codex-uploads/shot.png" }
      },
      { tool: "view_image", phase: "completed", status: "completed", output: "" }
    );
    expect(merged).toMatchObject({
      tool: "view_image",
      phase: "completed",
      status: "completed",
      path: "/repo/.codex-uploads/shot.png",
      input: { path: "/repo/.codex-uploads/shot.png" }
    });
  });
});
