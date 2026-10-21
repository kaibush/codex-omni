/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Provider, Session } from "@/types";
import { persistComposerModel, persistComposerProviderId } from "./composer-selection";
import { useComposerSelection } from "./use-composer-selection";

const providers = [
  { id: "p", kind: "codex", models: ["x", "y"], model: "x", isDefault: true },
  { id: "q", kind: "codex", models: ["x", "y"], model: "y" },
  { id: "c", kind: "claude-code", models: ["claude"], model: "claude" }
] as Provider[];
function session(id: string, model: string, providerId = "p"): Session {
  return {
    id,
    model,
    providerId,
    projectId: "project",
    clientType: "codex",
    title: id,
    threadId: null,
    status: "idle",
    createdAt: 1,
    updatedAt: 1
  };
}
type Input = Parameters<typeof useComposerSelection>[0];
let root: Root;
let selection: ReturnType<typeof useComposerSelection>;
function Harness(props: Input) {
  selection = useComposerSelection(props);
  return (
    <output>
      {selection.providerId}:{selection.model}
    </output>
  );
}
function render(id: string, value?: Session, available: Provider[] | undefined = providers) {
  act(() =>
    root.render(
      <Harness sessionId={id} session={value} providers={available} projectProviderId="p" />
    )
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
});

describe("conversation composer selection", () => {
  it("restores A/x and B/y independently under the same provider, including empty chats", () => {
    persistComposerModel("p", "y");
    render("a", session("a", "x"));
    expect(selection.model).toBe("x");
    render("b", session("b", "y"));
    expect(selection.model).toBe("y");
    render("a", session("a", "x"));
    expect(selection).toMatchObject({ providerId: "p", model: "x" });
    render("b", session("b", "y"));
    expect(selection.model).toBe("y");
  });

  it("keeps unsent choices while saves and conversation loads are still pending", () => {
    render("a", session("a", "y"));
    act(() => selection.setModel("x"));
    render("b", session("b", "x"));
    act(() => selection.setModel("y"));
    render("a");
    expect(selection).toMatchObject({ providerId: "p", model: "x" });
    render("a", session("a", "y"));
    expect(selection.model).toBe("x");
    render("b", session("b", "x"));
    expect(selection.model).toBe("y");
  });

  it("restores the saved provider even without a native thread", () => {
    persistComposerProviderId("q");
    render("a", session("a", "x"));
    expect(selection.providerId).toBe("p");
    render("b", session("b", "y", "q"));
    expect(selection.providerId).toBe("q");
    render("a", session("a", "x"));
    expect(selection.providerId).toBe("p");
  });

  it("clears the old pair while loading and restores correctly when providers arrive last", () => {
    render("a", session("a", "x"));
    render("b");
    expect(selection).toMatchObject({ ready: false, providerId: "", model: "" });
    act(() =>
      root.render(
        <Harness
          sessionId="b"
          session={session("b", "y")}
          providers={undefined}
          projectProviderId="p"
        />
      )
    );
    expect(selection.ready).toBe(false);
    render("b", session("b", "y"));
    expect(selection).toMatchObject({ ready: true, providerId: "p", model: "y" });
  });

  it("does not let a delayed provider switch in A alter B, even with overlapping model catalogs", () => {
    render("a", session("a", "x"));
    const finishSwitchInA = selection.selectProvider;
    render("b", session("b", "x"));
    act(() => finishSwitchInA("q", "y"));
    expect(selection).toMatchObject({ providerId: "p", model: "x" });
    render("a", session("a", "y", "q"));
    expect(selection).toMatchObject({ providerId: "q", model: "y" });
  });

  it("restores persisted choices after remount and preserves models omitted from a catalog", () => {
    render("a", session("a", "custom-model"));
    expect(selection.model).toBe("custom-model");
    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    render("a", session("a", "custom-model"), [{ ...providers[0]!, models: ["y"] }]);
    expect(selection.model).toBe("custom-model");
  });

  it("restores a Claude conversation when providers arrive before session details", () => {
    render("c");
    render("c", { ...session("c", "claude", "c"), clientType: "claude-code" });
    expect(selection).toMatchObject({
      clientType: "claude-code",
      providerId: "c",
      model: "claude"
    });
  });
});
