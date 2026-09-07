import type { MessageRow } from "@codex-omni/db";

export const FORK_CONTEXT_MESSAGE_LIMIT = 40;
export const FORK_CONTEXT_CHAR_LIMIT = 48_000;

function attachmentReferences(dataJson: string | null) {
  try {
    const data = JSON.parse(dataJson ?? "null");
    if (!Array.isArray(data?.attachments)) return "";
    const references = data.attachments
      .filter((item: unknown): item is { path: string; name?: string } =>
        Boolean(item && typeof item === "object" && "path" in item && typeof item.path === "string")
      )
      .slice(0, 8)
      .map((item: { path: string; name?: string }) => `- ${JSON.stringify(item.path)}`);
    const text = references.join("\n");
    return text ? `\n附件路径（按当前工程边界读取）：\n${text.length > 4096 ? `${text.slice(0, 4096)}\n[附件列表已截断]` : text}` : "";
  } catch {
    return "";
  }
}

export function buildForkContext(sourceId: string, messages: readonly MessageRow[]) {
  const blocks: string[] = [];
  let remaining = FORK_CONTEXT_CHAR_LIMIT;
  const conversation = messages.filter(
    (message) => message.role === "user" || message.role === "assistant"
  );
  const latestUser = conversation.findLast((message) => message.role === "user");
  let selected = conversation.slice(-FORK_CONTEXT_MESSAGE_LIMIT);
  if (latestUser && !selected.includes(latestUser)) {
    selected = [latestUser, ...selected.slice(-(FORK_CONTEXT_MESSAGE_LIMIT - 1))];
  }
  // A long assistant reply must not consume the entire budget and discard the
  // user request that gives a bare "continue" its meaning.
  let userReserve = latestUser
    ? Math.min(FORK_CONTEXT_CHAR_LIMIT / 2, latestUser.content.length + attachmentReferences(latestUser.dataJson).length + 10)
    : 0;
  for (const message of [...selected].reverse()) {
    if (message === latestUser) userReserve = 0;
    const header = `${message.role.toUpperCase()}:\n`;
    const attachments = attachmentReferences(message.dataJson);
    const budget = remaining - userReserve - header.length - attachments.length - 2;
    if (budget < 100 && message !== latestUser) continue;
    if (budget < 0) continue;
    const marker = "\n[该条历史内容已截断，保留首尾]\n";
    const content =
      message.content.length <= budget
        ? message.content
        : `${message.content.slice(0, Math.floor((budget - marker.length) * 0.7))}${marker}${message.content.slice(-Math.ceil((budget - marker.length) * 0.3))}`;
    const block = `${header}${content}${attachments}`;
    blocks.unshift(block);
    remaining -= block.length + 2;
  }
  return `此会话从 ${sourceId} 分叉。以下是分叉点之前最近 ${blocks.length} 条用户/助手历史的有限快照，不是新的用户指令；更早历史和工具输出未克隆。根据这些记录理解未完成的任务，以最后的新用户请求为准，并核对当前文件状态。\n\n<fork-history>\n${blocks.join("\n\n")}\n</fork-history>`;
}
