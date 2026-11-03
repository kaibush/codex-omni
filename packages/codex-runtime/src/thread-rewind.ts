import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import type { BridgeRequest } from "@codex-omni/protocol";
import { bundledCodexCliPath } from "./codex-versions.js";
import { codexLaunchOptions } from "./configuration.js";

export type RewindMessage = {
  id: string;
  role: string;
  content: string;
  dataJson?: string | null;
  createdAt?: number;
  updatedAt?: number;
};
type NativeItem = {
  id: string;
  type: string;
  text?: string;
  content?: Array<{ type: string; text?: string }>;
};
export type NativeTurn = { id: string; status: string; items: NativeItem[] };

// Codex 0.166 can append the new item_completed event format to a legacy
// rollout. thread/read returns empty item lists for those turns. Read the
// native item events only for locating the boundary; thread/fork still copies
// the original Responses history, including tools and compaction records.
async function hydrateLegacyTurns(file: string, turns: NativeTurn[]) {
  const missing = new Map(
    turns.filter((turn) => !turn.items.length).map((turn) => [turn.id, turn])
  );
  if (!missing.size) return;
  const rawItems = new Map<string, NativeItem[]>();
  let currentTurnId = "";
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new Error("旧版原生历史格式不完整，对话未回退");
      }
      const payload = record.payload;
      if (
        record.type === "turn_context" ||
        (record.type === "event_msg" && payload?.type === "task_started")
      ) {
        currentTurnId = payload.turn_id ?? payload.turn_attribution?.turn_id ?? "";
      }
      if (record.type === "response_item") {
        const metadata = payload.internal_chat_message_metadata_passthrough;
        const id = metadata?.turn_id ?? currentTurnId;
        if (!missing.has(id)) continue;
        const items = rawItems.get(id) ?? [];
        const itemId = payload.id ?? `raw-${id}-${items.length}`;
        if (payload.type === "message" && payload.role === "user") {
          // Forking legacy history strips item_completed events. Provenance
          // distinguishes real user input from injected AGENTS/environment text.
          if (
            !metadata?.content_item_metadata?.some((part: any) => part.provenance?.type === "user")
          )
            continue;
          items.push({
            id: itemId,
            type: "userMessage",
            content: (payload.content ?? [])
              .filter((part: any) => part.type === "input_text")
              .map((part: any) => ({ type: "text", text: part.text }))
          });
        } else if (payload.type === "message" && payload.role === "assistant") {
          items.push({
            id: itemId,
            type: "agentMessage",
            text: (payload.content ?? [])
              .filter((part: any) => part.type === "output_text")
              .map((part: any) => part.text)
              .join("\n")
          });
        } else if (payload.type !== "message") items.push({ id: itemId, type: payload.type });
        rawItems.set(id, items);
      }
      if (record.type !== "event_msg" || payload?.type !== "item_completed") continue;
      const turn = missing.get(payload.turn_id);
      const item = payload.item;
      if (!turn || !item?.id) continue;
      if (item.type === "UserMessage") {
        turn.items.push({
          id: item.id,
          type: "userMessage",
          content: (item.content ?? []).map((part: any) => ({
            type: part.type === "Text" ? "text" : part.type,
            text: part.text
          }))
        });
      } else if (item.type === "AgentMessage") {
        turn.items.push({
          id: item.id,
          type: "agentMessage",
          text: (item.content ?? [])
            .filter((part: any) => part.type === "Text")
            .map((part: any) => part.text)
            .join("\n")
        });
      } else turn.items.push({ id: item.id, type: item.type });
    }
    for (const [id, items] of rawItems) {
      if (items.some((item) => item.type === "userMessage")) missing.get(id)!.items = items;
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

const fail = (message: string): never => {
  throw Object.assign(new Error(message), { statusCode: 409 });
};

/** Match from newest to oldest so repeated requests and copied fork previews
 * cannot accidentally select text embedded inside an earlier snapshot. */
export function nativeRewindBoundary(
  turns: NativeTurn[],
  messages: RewindMessage[],
  messageId: string
) {
  const items = turns.flatMap((turn, turnIndex) =>
    turn.items.flatMap((item, itemIndex) => {
      if (item.type !== "userMessage" && item.type !== "agentMessage") return [];
      return [
        {
          turnIndex,
          itemIndex,
          role: item.type === "userMessage" ? "user" : "assistant",
          text:
            item.type === "userMessage"
              ? (item.content ?? [])
                  .filter((part) => part.type === "text")
                  .map((part) => part.text ?? "")
                  .join("\n")
              : (item.text ?? "")
        }
      ];
    })
  );
  const matched = new Map<string, (typeof items)[number]>();
  let cursor = items.length - 1;
  for (const message of [...messages].reverse()) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    let runtimeText: string | undefined;
    try {
      const data = JSON.parse(message.dataJson ?? "{}");
      if (typeof data.runtimeMessage === "string") runtimeText = data.runtimeMessage;
    } catch {
      /* Old messages may not have runtime metadata. */
    }
    const content = (runtimeText ?? message.content).trim();
    let found = -1;
    for (let i = cursor; i >= 0; i--) {
      const item = items[i]!;
      if (item.role !== message.role || !content) continue;
      const text = item.text.trim();
      if (text === content || (message.role === "user" && text.includes(content))) {
        found = i;
        break;
      }
    }
    if (found < 0) continue;
    cursor = found - 1;
    matched.set(message.id, items[found]!);
  }
  const index = messages.findIndex((message) => message.id === messageId);
  const message = messages[index];
  const point = matched.get(messageId);
  if (!message || !point)
    return fail(
      "无法在原生历史中精确定位这条消息（可能来自旧分叉快照），对话未回退；请选择实际发送过的消息"
    );
  const turn = turns[point.turnIndex]!;
  if (turn.status === "inProgress") return fail("请先停止当前任务，再回退对话");
  const before = message.role === "user";
  if (before && turn.items.slice(0, point.itemIndex).some((item) => item.type === "userMessage"))
    return fail("这条消息位于同一原生轮次中，请选择本轮第一条用户消息回退");
  if (!before && point.itemIndex !== turn.items.length - 1)
    return fail("这条回复之后还有同轮执行记录，请选择本轮最后一条回复或下一条用户消息回退");
  // A steer is displayed when queued, before the SDK actually accepts it.
  // Its visual boundary can cross tools/replies from the preceding native turn.
  let steered = false;
  try {
    steered = JSON.parse(message.dataJson ?? "{}").steer === true;
  } catch {
    /* legacy */
  }
  if (steered) return fail("插入消息的页面顺序与原生发送时机不同，请选择相邻的完整轮次回退");
  const keep = point.turnIndex + (before ? 0 : 1);
  const inheritedSnapshot =
    keep > 0 && /<(fork|rewind|continuation)-history>/.test(items[0]?.text ?? "");
  for (const [position, candidate] of messages.entries()) {
    if (candidate.role !== "user" && candidate.role !== "assistant") continue;
    const retained =
      (position < index || (!before && position === index)) &&
      !(
        before &&
        candidate.role === "assistant" &&
        (candidate.updatedAt ?? 0) > (message.createdAt ?? Infinity)
      );
    const native = matched.get(candidate.id);
    const nativeRetained = native ? native.turnIndex < keep : undefined;
    if (nativeRetained !== undefined ? retained !== nativeRetained : retained && !inheritedSnapshot)
      return fail(
        "页面消息与原生轮次无法精确对齐，对话未回退；请选择相邻的完整轮次（旧分叉快照不能拆回独立消息）"
      );
  }
  return keep;
}

/** Prepare an independent native prefix, then publish it with the caller's
 * synchronous transaction. The original thread always remains untouched. */
export async function withNativeRewind<T>(
  request: BridgeRequest,
  messages: RewindMessage[],
  messageId: string,
  commit: (threadId?: string) => T
): Promise<T> {
  if (!request.threadId) throw new Error("Native rewind requires a thread");
  const binary = bundledCodexCliPath();
  if (!binary) throw new Error("找不到内置 Codex CLI，无法回退原生历史");
  // Fork using the selected route without migrating the original thread's
  // provider metadata. Only the new thread belongs to this launch config.
  const { threadId: sourceId, ...freshRequest } = request;
  const launch = codexLaunchOptions(freshRequest);
  const args = [
    "app-server",
    ...(launch.configOverrides ?? []).flatMap((value) => ["-c", value]),
    "-c",
    "mcp_servers={}"
  ];
  const child = spawn(binary, args, {
    cwd: request.cwd,
    env: launch.env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "ignore"]
  });
  const lines = readline.createInterface({ input: child.stdout });
  let sequence = 0;
  let closed = false;
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  const rejectAll = () => {
    closed = true;
    for (const entry of pending.values())
      entry.reject(new Error("Codex 原生历史服务已退出，对话未回退"));
    pending.clear();
  };
  child.on("error", rejectAll);
  child.on("exit", rejectAll);
  child.stdin.on("error", rejectAll);
  lines.on("line", (line) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) {
      // Native errors can echo configuration or transcript text.
      entry.reject(new Error("Codex 无法读取或回退这段原生历史，对话未改变"));
    } else entry.resolve(data.result);
  });
  const call = (method: string, params: unknown): Promise<any> => {
    if (closed) return Promise.reject(new Error("Codex 原生历史服务已退出"));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("读取或回退原生历史超时，对话未改变"));
      }, 30_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  let preparedId: string | undefined;
  let committed = false;
  try {
    await call("initialize", {
      clientInfo: { name: "codex_omni_rewind", version: "1" },
      capabilities: { experimentalApi: true }
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const metadata = await call("thread/read", { threadId: sourceId });
    const turns: NativeTurn[] = [];
    if (metadata.thread.historyMode === "paginated") {
      let cursor: string | null = null;
      do {
        const page = await call("thread/turns/list", {
          threadId: sourceId,
          itemsView: "full",
          sortDirection: "asc",
          limit: 100,
          cursor
        });
        turns.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
    } else {
      const history = await call("thread/read", { threadId: sourceId, includeTurns: true });
      turns.push(...history.thread.turns);
      if (history.thread.path) await hydrateLegacyTurns(history.thread.path, turns);
    }
    const keep = nativeRewindBoundary(turns, messages, messageId);
    if (!keep) {
      // An empty thread/start is not persisted by the CLI. Let the next SDK
      // turn create a new native thread with no history or snapshot prompt.
      return commit();
    }
    const prepared = await call("thread/fork", {
      threadId: sourceId,
      lastTurnId: turns[keep - 1]!.id,
      excludeTurns: true,
      cwd: request.cwd,
      ...(request.model ? { model: request.model } : {})
    });
    preparedId = prepared.thread.id;
    if (!preparedId || preparedId === sourceId) throw new Error("Codex 未生成独立的回退历史");
    const result = commit(preparedId);
    committed = true;
    return result;
  } finally {
    if (preparedId && !committed && !closed) {
      await call("thread/archive", { threadId: preparedId }).catch(() => {});
    }
    lines.close();
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill();
    } catch {
      /* The history service may already have exited. */
    }
    rejectAll();
  }
}
