import { describe, expect, it } from "vitest";
import {
  joinInsertedTemplate,
  normalizeTemplateCommand,
  templateInsertText
} from "./prompt-templates";

describe("prompt templates", () => {
  it("normalizes slash commands and drops empty values", () => {
    expect(normalizeTemplateCommand(null)).toBeNull();
    expect(normalizeTemplateCommand("")).toBeNull();
    expect(normalizeTemplateCommand("   ")).toBeNull();
    expect(normalizeTemplateCommand("review")).toBe("/review");
    expect(normalizeTemplateCommand(" /test ")).toBe("/test");
  });

  it("inserts the template content as-is", () => {
    expect(templateInsertText({ content: "ls -la" })).toBe("ls -la");
    expect(templateInsertText({ content: "请审查 {{project}}" })).toBe("请审查 {{project}}");
  });

  it("joins inserted text onto the current draft", () => {
    expect(joinInsertedTemplate("", "ls")).toBe("ls");
    expect(joinInsertedTemplate("pwd", "ls")).toBe("pwd\nls");
    expect(joinInsertedTemplate("pwd\n", "ls")).toBe("pwd\nls");
    expect(joinInsertedTemplate("pwd ", "ls")).toBe("pwd ls");
    expect(joinInsertedTemplate("pwd", "")).toBe("pwd");
  });
});
