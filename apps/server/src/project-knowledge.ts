import { createProjectEntry, readProjectTextFile, writeProjectTextFile } from "./project-file.js";

export const AGENTS_MD_PATH = "AGENTS.md";

export async function readAgentsMarkdown(rootPath: string) {
  try {
    const file = await readProjectTextFile(rootPath, AGENTS_MD_PATH);
    return { ...file, exists: true as const };
  } catch (reason) {
    const status = (reason as { statusCode?: number }).statusCode;
    if (status === 404) {
      return {
        path: AGENTS_MD_PATH,
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

export async function writeAgentsMarkdown(rootPath: string, content: string, revision?: string) {
  const current = await readAgentsMarkdown(rootPath);
  if (!current.exists) {
    await createProjectEntry({
      rootPath,
      relativePath: AGENTS_MD_PATH,
      type: "file",
      content
    });
    return readAgentsMarkdown(rootPath);
  }
  return writeProjectTextFile({
    rootPath,
    relativePath: AGENTS_MD_PATH,
    content,
    expectedRevision: revision || current.revision
  });
}
