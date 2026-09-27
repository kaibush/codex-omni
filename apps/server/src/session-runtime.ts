import type { Store } from "@codex-omni/db";
import { clientName, clientType, type ClientType } from "@codex-omni/protocol";
import { buildForkContext } from "./session-context.js";

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

export function switchSessionProvider(store: Store, sessionId: string, providerId: string) {
  const session = store.getSession(sessionId);
  if (!session) return fail("Session not found", 404);
  if (session.kind !== "chat") return fail("终端会话不能切换 SDK 供应商");
  const provider = store.getProvider(providerId);
  if (!provider) return fail("Provider not found", 404);
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
  const binding = store.getSessionRuntimeBinding(sessionId, providerId);
  const updated = store.updateSession(sessionId, {
    providerId,
    clientType: clientType(provider.kind),
    threadId: binding?.threadId ?? null
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
        resumed: Boolean(binding)
      })
    });
  return updated;
}

export function runtimeHistoryContext(store: Store, sessionId: string, providerId: string) {
  const session = store.getSession(sessionId);
  if (!session) return null;
  // Legacy threads already contain their conversation. Their migration creates
  // a binding, but keep this fallback for sessions imported by older clients.
  const binding = store.getSessionRuntimeBinding(sessionId, providerId);
  if (!binding && session.threadId) return null;
  const cursor =
    binding?.lastMessageAt != null && binding.lastMessageId
      ? { createdAt: binding.lastMessageAt, id: binding.lastMessageId }
      : undefined;
  const messages = store.conversationSince(sessionId, cursor);
  if (!messages.length) return null;
  if (session.continuationMode === "fork" && !session.threadId)
    return buildForkContext(session.parentSessionId ?? sessionId, messages);
  if (
    !binding &&
    !store.findMessageByEventType(sessionId, "runtime.switched") &&
    !messages.some((message) => message.providerId && message.providerId !== providerId)
  )
    return null;
  return buildForkContext(sessionId, messages)
    .replace(/^此会话从 .*? 分叉。/, "这是同一对话在其他客户端或供应商执行期间产生的历史补充。")
    .replaceAll("分叉点之前", "切换期间")
    .replaceAll("fork-history", "provider-history");
}
