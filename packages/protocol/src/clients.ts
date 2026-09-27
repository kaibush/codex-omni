import { z } from "zod/v3";

export const clientTypeSchema = z.enum(["codex", "claude-code"]);
export type ClientType = z.infer<typeof clientTypeSchema>;

export const CLIENTS = [
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex SDK",
    rulesFile: "AGENTS.md",
    capabilities: {
      plan: true,
      subagents: true,
      skills: true,
      mcp: true,
      questions: false,
      goals: true
    }
  },
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic Claude Agent SDK",
    rulesFile: "CLAUDE.md",
    capabilities: {
      plan: true,
      subagents: true,
      skills: true,
      mcp: true,
      questions: true,
      goals: false
    }
  }
] as const;

export function clientType(value: unknown): ClientType {
  return value === "claude-code" ? "claude-code" : "codex";
}

export function clientName(value: unknown) {
  return CLIENTS.find((client) => client.id === clientType(value))!.name;
}

export const claudePermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions"
]);

export const claudeAgentSchema = z.object({
  description: z.string().min(1).max(4000),
  prompt: z.string().min(1).max(100_000),
  tools: z.array(z.string().min(1)).max(100).optional(),
  disallowedTools: z.array(z.string().min(1)).max(100).optional(),
  model: z.string().min(1).optional(),
  maxTurns: z.number().int().positive().max(1000).optional()
});

export const claudeOptionsSchema = z.object({
  permissionMode: claudePermissionModeSchema.optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  thinking: z.enum(["adaptive", "disabled"]).optional(),
  maxTurns: z.number().int().positive().max(1000).optional(),
  maxBudgetUsd: z.number().positive().max(10000).optional(),
  systemPrompt: z.string().max(100_000).optional(),
  allowedTools: z.array(z.string().min(1)).max(100).optional(),
  disallowedTools: z.array(z.string().min(1)).max(100).optional(),
  agents: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), claudeAgentSchema).optional(),
  agent: z.string().min(1).max(100).optional()
});
export type ClaudeOptions = z.infer<typeof claudeOptionsSchema>;

export const approvalResponseFields = {
  decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
  answers: z.record(z.string(), z.string().max(10000)).optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional()
};
export const approvalResponseSchema = z.object(approvalResponseFields);
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;
