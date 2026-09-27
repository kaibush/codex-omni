import { createProjectEntry, readProjectTextFile, writeProjectTextFile } from "./project-file.js";

export const AGENTS_MD_PATH = "AGENTS.md";

export async function readAgentsMarkdown(
  rootPath: string,
  rulesFile: "AGENTS.md" | "CLAUDE.md" = AGENTS_MD_PATH
) {
  try {
    const file = await readProjectTextFile(rootPath, rulesFile);
    return { ...file, exists: true as const };
  } catch (reason) {
    const status = (reason as { statusCode?: number }).statusCode;
    if (status === 404) {
      return {
        path: rulesFile,
        content: "",
        size: 0,
        revision: "",
        writable: true,
        exists: false as const
      };
    }
    throw reason;
  }
}

export async function writeAgentsMarkdown(
  rootPath: string,
  content: string,
  revision?: string,
  rulesFile: "AGENTS.md" | "CLAUDE.md" = AGENTS_MD_PATH
) {
  const current = await readAgentsMarkdown(rootPath, rulesFile);
  if (!current.exists) {
    await createProjectEntry({
      rootPath,
      relativePath: rulesFile,
      type: "file",
      content
    });
    return readAgentsMarkdown(rootPath, rulesFile);
  }
  return writeProjectTextFile({
    rootPath,
    relativePath: rulesFile,
    content,
    expectedRevision: revision || current.revision
  });
}
