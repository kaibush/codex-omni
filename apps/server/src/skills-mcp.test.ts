import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listProjectSkills, listProviderSkills } from "./skills-mcp.js";

describe("skills discovery", () => {
  it("reads SKILL.md from provider and project directories", async () => {
    const providerRoot = await mkdtemp(path.join(os.tmpdir(), "codex-omni-skills-provider-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "codex-omni-skills-project-"));
    await mkdir(path.join(providerRoot, "skills", "review"), { recursive: true });
    await writeFile(path.join(providerRoot, "skills", "review", "SKILL.md"), "# 审查\n指出风险。\n");
    await mkdir(path.join(projectRoot, ".codex", "skills", "test"), { recursive: true });
    await writeFile(path.join(projectRoot, ".codex", "skills", "test", "SKILL.md"), "# 测试\n跑测试。\n");
    expect(await listProviderSkills(providerRoot)).toEqual([
      expect.objectContaining({ name: "review", source: "provider" })
    ]);
    expect(await listProjectSkills(projectRoot)).toEqual([
      expect.objectContaining({ name: "test", source: "project" })
    ]);
  });
});
