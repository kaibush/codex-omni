import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type SkillInfo = {
  id: string;
  name: string;
  source: "provider" | "project";
  path: string;
  description: string;
};

const SKILL_DIRS = [".codex/skills", ".agents/skills", "skills"];

async function readSkillDescription(skillFile: string) {
  try {
    const content = await readFile(skillFile, "utf8");
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const summary = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("---"));
    return (heading || summary || "").slice(0, 240);
  } catch {
    return "";
  }
}

async function listSkillDir(root: string, source: SkillInfo["source"], relativeRoot: string) {
  const directory = path.join(root, relativeRoot);
  let entries: string[] = [];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const skills: SkillInfo[] = [];
  for (const name of entries) {
    const skillDir = path.join(directory, name);
    let info;
    try {
      info = await stat(skillDir);
    } catch {
      continue;
    }
    if (!info.isDirectory()) continue;
    const skillFile = path.join(skillDir, "SKILL.md");
    try {
      const fileInfo = await stat(skillFile);
      if (!fileInfo.isFile()) continue;
    } catch {
      continue;
    }
    skills.push({
      id: `${source}:${name}`,
      name,
      source,
      path: path.posix.join(relativeRoot, name, "SKILL.md"),
      description: await readSkillDescription(skillFile)
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listProviderSkills(codexHome: string) {
  return listSkillDir(codexHome, "provider", "skills");
}

export async function listProjectSkills(projectRoot: string) {
  const groups = await Promise.all(
    SKILL_DIRS.map((directory) => listSkillDir(projectRoot, "project", directory))
  );
  const seen = new Set<string>();
  const skills: SkillInfo[] = [];
  for (const group of groups) {
    for (const skill of group) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  return skills;
}
