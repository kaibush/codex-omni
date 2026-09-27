// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalPrompt } from "./ApprovalPrompt";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Claude interactive approval", () => {
  it("requires answers and sends selected answers to the pending SDK request", () => {
    const onApproval = vi.fn();
    act(() =>
      root.render(
        <ApprovalPrompt
          item={{
            id: "question",
            kind: "approval",
            data: {
              approvalId: "request",
              tool: "AskUserQuestion",
              kind: "question",
              questions: [
                {
                  question: "Language?",
                  options: [{ label: "TypeScript" }, { label: "JavaScript" }]
                }
              ]
            }
          }}
          onApproval={onApproval}
        />
      )
    );
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "提交回答"
    )!;
    expect(submit.disabled).toBe(true);
    act(() => (container.querySelector('input[type="radio"]') as HTMLInputElement).click());
    expect(submit.disabled).toBe(false);
    act(() => submit.click());
    expect(onApproval).toHaveBeenCalledWith("request", "accept", {
      answers: { "Language?": "TypeScript" }
    });
  });

  it("displays the plan for review and prevents acting on expired approvals", () => {
    const onApproval = vi.fn();
    act(() =>
      root.render(
        <ApprovalPrompt
          item={{
            id: "plan",
            kind: "approval",
            data: {
              approvalId: "request",
              tool: "ExitPlanMode",
              plan: "# Proposed plan\n\nCreate the parser.",
              status: "expired"
            }
          }}
          onApproval={onApproval}
        />
      )
    );
    expect(container.querySelector("h1")?.textContent).toBe("Proposed plan");
    expect(container.textContent).toContain("Create the parser.");
    expect(container.textContent).toContain("请求已过期");
    expect(container.querySelector("button")).toBeNull();
  });
});
