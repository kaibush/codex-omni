import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeProjectDocument } from "./project-language.js";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("project language tools", () => {
  it("reports JSON parse errors", () => {
    const result = analyzeProjectDocument({
      rootPath: "/tmp",
      relativePath: "config.json",
      content: '{ "ok": true, }'
    });
    expect(result.diagnostics[0]?.source).toBe("json");
    expect(result.diagnostics[0]?.severity).toBe("error");
  });

  it("extracts markdown headings and python symbols", () => {
    expect(
      analyzeProjectDocument({
        rootPath: "/tmp",
        relativePath: "README.md",
        content: "# Title\n\n## Setup\n"
      }).symbols.map((item) => item.name)
    ).toEqual(["Title", "Setup"]);
    expect(
      analyzeProjectDocument({
        rootPath: "/tmp",
        relativePath: "app.py",
        content: "class Worker:\n    def run(self):\n        return 1\n"
      }).symbols.map((item) => `${item.kind}:${item.name}`)
    ).toEqual(["class:Worker", "function:run"]);
  });

  it("analyzes TypeScript symbols, diagnostics and same-file definitions", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "codex-lang-"));
    const relativePath = "src/math.ts";
    const content = `export function add(left: number, right: number) {
  return left + right;
}

export const total = add(1, 2);
const broken: number = "nope";
`;
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, relativePath), content);
    const result = analyzeProjectDocument({
      rootPath: dir,
      relativePath,
      content,
      line: 5,
      column: 22
    });
    expect(result.symbols.some((item) => item.name === "add")).toBe(true);
    expect(result.diagnostics.some((item) => item.source === "typescript")).toBe(true);
    expect(result.definition).toMatchObject({ path: relativePath, line: 1 });
  });
});
