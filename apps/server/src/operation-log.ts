import type { Store } from "@codex-omni/db";
import { captureGitCheckpoint, restoreGitCheckpoint } from "./project-git.js";

export type GitUndoSnapshot = {
  type: "git-checkpoint";
  isRepository: boolean;
  head: string | null;
  branch: string | null;
  status: string;
  patch: string;
  files: string[];
};

export async function snapshotForUndo(rootPath: string): Promise<GitUndoSnapshot> {
  const snapshot = await captureGitCheckpoint(rootPath);
  return {
    type: "git-checkpoint",
    isRepository: snapshot.isRepository,
    head: snapshot.head,
    branch: snapshot.branch,
    status: snapshot.status,
    patch: snapshot.patch,
    files: snapshot.files
  };
}

export function recordOperation(
  store: Store,
  input: {
    projectId: string;
    sessionId?: string | null;
    kind: string;
    title: string;
    detail?: unknown;
    undo?: unknown;
  }
) {
  return store.addOperationEvent({
    projectId: input.projectId,
    sessionId: input.sessionId ?? null,
    kind: input.kind,
    title: input.title,
    detailJson: input.detail ? JSON.stringify(input.detail) : null,
    undoJson: input.undo ? JSON.stringify(input.undo) : null
  });
}

export async function undoOperation(store: Store, rootPath: string, operationId: string) {
  const event = store.getOperationEvent(operationId);
  if (!event) throw Object.assign(new Error("操作记录不存在"), { statusCode: 404 });
  if (!event.undoJson) throw Object.assign(new Error("该操作无法自动撤销"), { statusCode: 400 });
  let undo: { type?: string } & Record<string, unknown>;
  try {
    undo = JSON.parse(event.undoJson) as { type?: string } & Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("撤销数据无效"), { statusCode: 400 });
  }
  if (undo.type === "git-checkpoint") {
    return restoreGitCheckpoint(rootPath, {
      isRepository: Boolean(undo.isRepository),
      head: typeof undo.head === "string" ? undo.head : null,
      branch: typeof undo.branch === "string" ? undo.branch : null,
      status: typeof undo.status === "string" ? undo.status : "",
      patch: typeof undo.patch === "string" ? undo.patch : "",
      files: Array.isArray(undo.files) ? undo.files.map((item) => String(item)) : []
    });
  }
  throw Object.assign(new Error("该操作无法自动撤销"), { statusCode: 400 });
}

export function publicOperation(event: {
  id: string;
  projectId: string;
  sessionId: string | null;
  kind: string;
  title: string;
  detailJson: string | null;
  undoJson: string | null;
  createdAt: number;
}) {
  return {
    id: event.id,
    projectId: event.projectId,
    sessionId: event.sessionId,
    kind: event.kind,
    title: event.title,
    detail: event.detailJson ? JSON.parse(event.detailJson) : null,
    undoable: Boolean(event.undoJson),
    createdAt: event.createdAt
  };
}
