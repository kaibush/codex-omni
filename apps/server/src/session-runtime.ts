import type { Store } from "@codex-omni/db";
import { clientName, clientType, type ClientType } from "@codex-omni/protocol";
import { buildForkContext } from "./session-context.js";
import { providerRuntimeHome } from "./client-provider.js";

const fail = (message: string, statusCode = 400): never => {
  throw Object.assign(new Error(message), { statusCode });
};

export function selectSessionProvider(
  store: Store,
  input: { projectId: string; providerId?: string | null; clientType?: ClientType }
) {
  const project = store.getProject(input.projectId);
  if (!project) return fail("Project not found", 404);
  const explicit = input.providerId ? store.getProvider(input.providerId) : undefined;
  if (input.providerId && !explicit) return fail("Provider not found", 404);
  if (explicit && input.clientType && clientType(explicit.kind) !== input.clientType)
    return fail("供应商与客户端不匹配");
  const preferred = project.providerId ? store.getProvider(project.providerId) : undefined;
  const kind = input.clientType ?? clientType(explicit?.kind ?? preferred?.kind);
  const provider =
    explicit ??
    (clientType(preferred?.kind) === kind ? preferred : undefined) ??
    store.listProviders().find((entry) => clientType(entry.kind) === kind && entry.isDefault) ??
    store.listProviders().find((entry) => clientType(entry.kind) === kind);
  return { clientType: kind, providerId: provider?.id ?? null };
}

export function saveRuntimeCursor(store: Store, sessionId: string) {
  const session = store.getSession(sessionId);
  if (!session?.providerId || !session.threadId) return;
  const latest = store.conversationSince(sessionId, undefined, 1)[0];
  store.saveSessionRuntimeBinding({
    sessionId,
    providerId: session.providerId,
    clientType: session.clientType,
    threadId: session.threadId,
    lastMessageId: latest?.id ?? null,
    lastMessageAt: latest?.createdAt ?? null
  });
}

export function switchSessionProvider(
  store: Store,
  sessionId: string,
  providerId: string,
  providersRoot: string
) {
  const session = store.getSession(sessionId);
  if (!session) return fail("Session not found", 404);
  if (session.kind !== "chat") return fail("终端会话不能切换 SDK 供应商");
  const provider = store.getProvider(providerId);
  if (!provider) return fail("Provider not found", 404);
  if (clientType(provider.kind) !== session.clientType)
    return fail("对话客户端不能更换，Codex 与 Claude Code 请分别新建对话");
  if (session.providerId === providerId) return session;
  if (session.status === "running" || store.getLatestRun(sessionId)?.status === "running")
    return fail("请等待当前任务结束后切换供应商", 409);
  if (store.listQueuedTurns(sessionId).length)
    return fail("请先处理或移除待发送队列后切换供应商", 409);
  if (
    session.providerId &&
    session.threadId &&
    !store.getSessionRuntimeBinding(sessionId, session.providerId)
  )
    saveRuntimeCursor(store, sessionId);
  let runtimeHome = session.runtimeHome;
  if (session.threadId && !runtimeHome) {
    const previous = session.providerId ? store.getProvider(session.providerId) : undefined;
    if (!previous) return fail("无法定位原生会话目录，请选择新建续接对话", 409);
    runtimeHome = providerRuntimeHome(previous, providersRoot);
  }
  const updated = store.updateSession(sessionId, {
    providerId,
    runtimeHome
  });
  if (store.hasMessageRole(sessionId, "user"))
    store.addMessage({
      sessionId,
      role: "system",
      providerId,
      content: `已切换至 ${clientName(provider.kind)} · ${provider.name}，在当前对话继续。`,
      eventType: "runtime.switched",
      dataJson: JSON.stringify({
        previousProviderId: session.providerId,
        providerId,
        clientType: provider.kind,
        threadId: session.threadId,
        resumeMode: "native"
      })
    });
  return updated;
}

export function runtimeHistoryContext(store: Store, sessionId: string, providerId: string) {
  const session = store.getSession(sessionId);
  if (!session || session.threadId || session.continuationMode !== "fork") return null;
  const provider = store.getProvider(providerId);
  if (!provider || clientType(provider.kind) !== session.clientType) return null;
  // Text snapshots are reserved for explicitly created forks/continuations.
  // Provider switches resume the current native thread, including tool history.
  return buildForkContext(session.parentSessionId ?? sessionId, store.conversationSince(sessionId));
}
