import { z } from "zod";

export const sandboxSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);
export const approvalPolicySchema = z.enum(["untrusted", "on-request", "never"]);

export type ReconnectNotice = {
  message: string;
  attempt: number;
  maxAttempts: number;
  reason?: string;
};

export function parseReconnectNotice(value: unknown): ReconnectNotice | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  const match = message.match(
    /^Reconnecting(?:\.{3}|…)?\s*(\d+)\s*\/\s*(\d+)(?:\s*\(([\s\S]*)\))?$/i
  );
  if (!match) return null;
  const attempt = Number(match[1]);
  const maxAttempts = Number(match[2]);
  if (!Number.isSafeInteger(attempt) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    return null;
  }
  const reason = match[3]?.trim();
  return {
    message,
    attempt,
    maxAttempts,
    ...(reason ? { reason } : {})
  };
}

export const providerHomeModeSchema = z.enum(["managed", "api-key", "external"]);
export type ProviderHomeMode = z.infer<typeof providerHomeModeSchema>;

export function normalizeProviderHomeMode(value: string | null | undefined): ProviderHomeMode {
  return value === "api-key" || value === "external" ? value : "managed";
}

export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  model: z.string().nullable(),
  models: z.array(z.string()),
  baseUrl: z.string().nullable(),
  apiKey: z.string().nullable(),
  configToml: z.string().nullable(),
  authJson: z.string().nullable(),
  messageEnvVars: z.record(z.string(), z.string()),
  isDefault: z.boolean(),
  homeMode: providerHomeModeSchema,
  codexHomePath: z.string().nullable(),
  codexHome: z.string().optional()
});
export type Provider = z.infer<typeof providerSchema>;

export const providerInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  kind: z.string().optional(),
  model: z.string().nullable().optional(),
  models: z.array(z.string().min(1)).optional(),
  baseUrl: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  configToml: z.string().nullable().optional(),
  authJson: z.string().nullable().optional(),
  messageEnvVars: z.record(z.string(), z.string()).optional(),
  isDefault: z.boolean().optional(),
  homeMode: providerHomeModeSchema.optional(),
  codexHomePath: z.string().nullable().optional()
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayPath: z.string(),
  realPath: z.string(),
  providerId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type Project = z.infer<typeof projectSchema>;
export const sessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  threadId: z.string().nullable(),
  title: z.string(),
  status: z.enum(["idle", "running", "failed", "cancelled", "interrupted"]),
  providerId: z.string().nullable(),
  parentSessionId: z.string().nullable().optional(),
  continuationMode: z.string().nullable().optional(),
  lastMessageAt: z.number().nullable(),
  pinnedAt: z.number().nullable().optional(),
  archivedAt: z.number().nullable().optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type Session = z.infer<typeof sessionSchema>;

export const eventSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  seq: z.number().int(),
  type: z.enum([
    "run.started",
    "thread.started",
    "turn.started",
    "user.message",
    "reasoning.delta",
    "assistant.delta",
    "assistant.completed",
    "tool.started",
    "tool.output",
    "file.change",
    "approval.requested",
    "run.reconnecting",
    "turn.completed",
    "run.failed"
  ]),
  payload: z.unknown()
});
export type BridgeEvent = z.infer<typeof eventSchema>;

export const runCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn.start"),
    projectId: z.string(),
    sessionId: z.string(),
    message: z.string().min(1),
    providerId: z.string().optional(),
    model: z.string().optional(),
    sandbox: sandboxSchema.optional(),
    approvalPolicy: approvalPolicySchema.optional(),
    networkAccessEnabled: z.boolean().optional(),
    mode: z.enum(["plan", "execute"]).optional()
  }),
  z.object({
    type: z.literal("turn.enqueue"),
    clientId: z.string().min(1).max(120).optional(),
    projectId: z.string(),
    sessionId: z.string(),
    message: z.string().min(1),
    displayMessage: z.string().optional(),
    attachments: z
      .array(
        z.object({
          name: z.string().min(1),
          path: z.string().min(1),
          kind: z.enum(["image", "text", "file"])
        })
      )
      .optional(),
    providerId: z.string().optional(),
    model: z.string().optional(),
    sandbox: sandboxSchema.optional(),
    approvalPolicy: approvalPolicySchema.optional(),
    networkAccessEnabled: z.boolean().optional(),
    mode: z.enum(["plan", "execute"]).optional()
  }),
  z.object({ type: z.literal("turn.cancel"), sessionId: z.string(), turnId: z.string() }),
  z.object({
    type: z.literal("session.subscribe"),
    sessionId: z.string(),
    lastRequestId: z.string().optional(),
    lastSeq: z.number().int().min(0).optional()
  }),
  z.object({ type: z.literal("queue.remove"), sessionId: z.string(), queueId: z.string() }),
  z.object({
    type: z.literal("queue.update"),
    sessionId: z.string(),
    queueId: z.string(),
    message: z.string().min(1),
    displayMessage: z.string().optional()
  }),
  z.object({ type: z.literal("queue.start-next"), sessionId: z.string() }),
  z.object({
    type: z.literal("queue.move"),
    sessionId: z.string(),
    queueId: z.string(),
    direction: z.enum(["up", "down"])
  }),
  z.object({
    type: z.literal("approval.respond"),
    sessionId: z.string(),
    requestId: z.string(),
    decision: z.enum(["accept", "acceptForSession", "decline", "cancel"])
  }),
  z.object({
    type: z.literal("run.retry"),
    projectId: z.string(),
    sessionId: z.string(),
    message: z.string().min(1),
    providerId: z.string().optional()
  })
]);
export type RunCommand = z.infer<typeof runCommandSchema>;

export const pendingApprovalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sessionId: z.string(),
  itemId: z.string().nullable(),
  tool: z.string(),
  command: z.string(),
  status: z.string(),
  decision: z.string().nullable(),
  payload: z.unknown().optional(),
  createdAt: z.number(),
  resolvedAt: z.number().nullable()
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const queuedTurnSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  providerId: z.string().nullable(),
  message: z.string(),
  options: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type QueuedTurn = z.infer<typeof queuedTurnSchema>;

export const activeRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  sessionTitle: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  providerId: z.string().nullable(),
  providerName: z.string().nullable(),
  threadId: z.string().nullable(),
  status: z.string(),
  model: z.string().nullable(),
  cwd: z.string(),
  workerPid: z.number().nullable(),
  codexPid: z.number().nullable(),
  serviceInstanceId: z.string(),
  startedAt: z.number(),
  firstResponseAt: z.number().nullable(),
  lastEventAt: z.number(),
  heartbeatAt: z.number().nullable(),
  lastSeq: z.number(),
  subscriberCount: z.number(),
  runtimeAlive: z.boolean(),
  reconnecting: z.unknown().nullable()
});
export type ActiveRun = z.infer<typeof activeRunSchema>;

export const bridgeRequestSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  threadId: z.string().optional(),
  cwd: z.string(),
  runtimeKey: z.string(),
  codexHome: z.string(),
  message: z.string(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  configToml: z.string().optional(),
  authJson: z.string().optional(),
  messageEnvVars: z.record(z.string(), z.string()).optional(),
  sandbox: sandboxSchema,
  approvalPolicy: approvalPolicySchema,
  networkAccessEnabled: z.boolean()
});
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;

export type AppServerNotification = { method: string; params?: any };

export const authStatusSchema = z.object({
  setupRequired: z.boolean()
});
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const filesystemEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  readable: z.boolean(),
  symlink: z.boolean()
});
export const filesystemBrowseSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  roots: z.array(z.object({ name: z.string(), path: z.string() })),
  breadcrumbs: z.array(z.object({ name: z.string(), path: z.string() })),
  entries: z.array(filesystemEntrySchema)
});
export type FilesystemBrowse = z.infer<typeof filesystemBrowseSchema>;

export {
  MAX_TOOL_OUTPUT_CHARS,
  applyTextPatch,
  compactStreamEvent,
  textPatch,
  truncateToolText
} from "./stream-patch.js";
