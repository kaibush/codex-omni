export type PromptTemplate = {
  id: string;
  name: string;
  command: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
};
export type WorkspaceTask = {
  id: string;
  projectId: string;
  sessionId: string | null;
  title: string;
  description: string | null;
  status: "todo" | "doing" | "done" | "blocked";
  relatedFiles?: string[];
  relatedCommit: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};
export type SessionCheckpoint = {
  id: string;
  sessionId: string;
  projectId: string;
  runId: string | null;
  title: string;
  gitHead: string | null;
  gitBranch: string | null;
  files: string[];
  createdAt: number;
};
export type ProjectNote = {
  id: string;
  projectId: string;
  kind: "rule" | "command" | "env" | "note";
  title: string;
  content: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};
export type SkillInfo = {
  id: string;
  name: string;
  source: "provider" | "project";
  path: string;
  description: string;
};
export type McpServer = {
  name: string;
  enabled: boolean;
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
};
export type OperationEvent = {
  id: string;
  projectId: string;
  sessionId: string | null;
  kind: string;
  title: string;
  detail: unknown;
  undoable: boolean;
  createdAt: number;
};
export type ScheduledJob = {
  id: string;
  projectId: string;
  sessionId: string | null;
  title: string;
  prompt: string;
  cadence: "interval" | "daily";
  intervalMinutes: number | null;
  dailyAt: string | null;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
};
export type RunStats = {
  turns: number;
  completed: number;
  failed: number;
  cancelled: number;
  interrupted: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastRunAt: number | null;
};
export type ProviderHomeMode = "managed" | "api-key" | "external";
export type Provider = {
  id: string;
  name: string;
  kind: string;
  model: string | null;
  models: string[];
  baseUrl: string | null;
  apiKey: string | null;
  configToml: string | null;
  authJson: string | null;
  messageEnvVars: Record<string, string>;
  isDefault: boolean;
  homeMode?: ProviderHomeMode;
  codexHomePath?: string | null;
  codexHome?: string;
};
export type Project = {
  id: string;
  name: string;
  displayPath: string;
  realPath: string;
  providerId: string | null;
  pinnedAt?: number | null;
  lastOpenedAt?: number | null;
  createdAt: number;
  updatedAt: number;
};
export type Session = {
  id: string;
  projectId: string;
  threadId: string | null;
  title: string;
  status: "idle" | "running" | "failed" | "cancelled" | "interrupted";
  providerId: string | null;
  parentSessionId?: string | null;
  continuationMode?: string | null;
  lastMessageAt?: number | null;
  pinnedAt?: number | null;
  archivedAt?: number | null;
  color?: string | null;
  icon?: string | null;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
};
export type Message = {
  id: string;
  sessionId: string;
  role:
    "user" | "assistant" | "reasoning" | "tool" | "file" | "approval" | "error" | "run" | "system";
  content: string;
  providerId: string | null;
  eventType: string | null;
  itemId: string | null;
  dataJson: string | null;
  createdAt: number;
  updatedAt: number;
};
export type MessageCursor = Pick<Message, "createdAt" | "id">;
export type SessionDetailPage = {
  session: Session;
  messages: Message[];
  latestRun: Message | null;
  nextCursor: MessageCursor | null;
  hasMore: boolean;
};
export type TimelineItem = {
  id: string;
  messageId?: string;
  kind:
    | "user"
    | "assistant"
    | "reasoning"
    | "tool"
    | "file"
    | "activity"
    | "approval"
    | "error"
    | "system";
  text?: string;
  data?: any;
  providerId?: string | null;
  streaming?: boolean;
  createdAt?: number;
};

export type QueuedTurn = {
  id: string;
  sessionId: string;
  projectId: string;
  providerId: string | null;
  message: string;
  options: Record<string, unknown>;
  position?: number;
  createdAt: number;
  updatedAt: number;
};

export type ActiveRun = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  projectId: string;
  projectName: string;
  providerId: string | null;
  providerName: string | null;
  threadId: string | null;
  status: string;
  model: string | null;
  cwd: string;
  workerPid: number | null;
  codexPid: number | null;
  serviceInstanceId: string;
  startedAt: number;
  firstResponseAt: number | null;
  lastEventAt: number;
  heartbeatAt: number | null;
  lastSeq: number;
  subscriberCount: number;
  runtimeAlive: boolean;
  reconnecting: Record<string, unknown> | null;
};

export type PendingApproval = {
  id: string;
  runId: string;
  sessionId: string;
  itemId: string | null;
  tool: string;
  command: string;
  status: string;
  decision: string | null;
  payload?: Record<string, unknown>;
  createdAt: number;
  resolvedAt: number | null;
};

export type SessionRun = {
  id: string;
  sessionId: string;
  projectId: string;
  providerId: string | null;
  threadId: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  serviceInstanceId: string;
  workerPid: number | null;
  codexPid: number | null;
  workerStartedAt: number | null;
  model: string | null;
  cwd: string;
  startedAt: number;
  firstResponseAt: number | null;
  endedAt: number | null;
  lastSeq: number;
  lastEventAt: number;
  heartbeatAt: number | null;
  reason: string | null;
  usage: Record<string, number> | null;
  reconnecting: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  runtimeAlive: boolean;
};

export type SessionSnapshot = {
  session: Session;
  run: SessionRun | null;
  runtime: {
    requestId: string;
    sessionId: string;
    workerPid: number | null;
    codexPid: number | null;
    startedAt: number;
    alive: boolean;
  } | null;
  approvals: PendingApproval[];
  queue: QueuedTurn[];
  replayTruncated: boolean;
  serverTime: number;
};

export type ProjectTerminal = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  cwd: string;
  shell: string;
  pid: number | null;
  status: "running" | "exited";
  cols: number;
  rows: number;
  seq: number;
  createdAt: number;
  updatedAt: number;
  exitedAt: number | null;
  exitCode: number | null;
  signal: number | null;
  subscriberCount: number;
};

export type FilesystemBrowse = {
  path: string;
  parent: string | null;
  roots: Array<{ name: string; path: string }>;
  breadcrumbs: Array<{ name: string; path: string }>;
  entries: Array<{ name: string; path: string; readable: boolean; symlink: boolean }>;
};

export type HostResource = {
  total: number;
  used: number;
  free: number;
  usage: number;
};

export type HostInfo = {
  app: { name: string; version: string };
  node: string;
  hostname: string;
  platform: string;
  arch: string;
  release: string;
  uptimeSec: number;
  cpu: {
    model: string;
    cores: number;
    load1: number;
    load5: number;
    load15: number;
    usage: number;
  };
  memory: HostResource;
  storage: HostResource & { path: string };
};

export type RuntimeInfo = {
  defaultCodexHome: string;
  providersRoot: string;
  host: HostInfo;
};
