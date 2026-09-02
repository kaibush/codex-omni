import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { DEFAULT_SESSION_TITLE, resolveSessionTitle } from "./session-title.js";
export {
  DEFAULT_SESSION_TITLE,
  isPlaceholderSessionTitle,
  resolveSessionTitle,
  titleFromFirstMessage
} from "./session-title.js";

export type ProviderRow = {
  id: string;
  name: string;
  kind: string;
  model: string | null;
  modelsJson: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  configToml: string | null;
  authJson: string | null;
  envJson: string | null;
  isDefault: number;
  homeMode: string | null;
  codexHomePath: string | null;
  createdAt: number;
  updatedAt: number;
};
export type ProjectRow = {
  id: string;
  name: string;
  displayPath: string;
  realPath: string;
  providerId: string | null;
  pinnedAt: number | null;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
};
export type SessionRow = {
  id: string;
  projectId: string;
  threadId: string | null;
  title: string;
  status: "idle" | "running" | "failed" | "cancelled" | "interrupted";
  providerId: string | null;
  parentSessionId: string | null;
  continuationMode: string | null;
  lastMessageAt: number | null;
  pinnedAt: number | null;
  archivedAt: number | null;
  color: string | null;
  icon: string | null;
  tagsJson: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};
export type MessageRow = {
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

export type SessionSearchHit = SessionRow & {
  projectName: string;
  snippet: string;
};

export type MessageSearchHit = {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  sessionTitle: string;
  role: string;
  snippet: string;
  createdAt: number;
};

export type MessageCursor = Pick<MessageRow, "createdAt" | "id">;
export type MessagePage = {
  messages: MessageRow[];
  nextCursor: MessageCursor | null;
  hasMore: boolean;
};
export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type RunRow = {
  id: string;
  sessionId: string;
  projectId: string;
  providerId: string | null;
  threadId: string | null;
  status: RunStatus;
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
  usageJson: string | null;
  reconnectingJson: string | null;
  sourceQueueId: string | null;
  createdAt: number;
  updatedAt: number;
};
export type ApprovalRow = {
  id: string;
  runId: string;
  sessionId: string;
  itemId: string | null;
  tool: string;
  command: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  decision: string | null;
  payloadJson: string | null;
  createdAt: number;
  resolvedAt: number | null;
};
export type ApprovalListItem = ApprovalRow & {
  projectId: string;
  projectName: string;
  sessionTitle: string;
};
export type ApprovalStats = {
  total: number;
  pending: number;
  accepted: number;
  declined: number;
  cancelled: number;
  expired: number;
};
export type QueuedTurnRow = {
  id: string;
  sessionId: string;
  projectId: string;
  providerId: string | null;
  message: string;
  optionsJson: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};
export type PromptTemplateRow = {
  id: string;
  name: string;
  command: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
};
export type TaskStatus = "todo" | "doing" | "done" | "blocked";
export type TaskRow = {
  id: string;
  projectId: string;
  sessionId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  relatedFilesJson: string | null;
  relatedCommit: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};
export type CheckpointRow = {
  id: string;
  sessionId: string;
  projectId: string;
  runId: string | null;
  title: string;
  gitHead: string | null;
  gitBranch: string | null;
  gitStatus: string | null;
  patch: string | null;
  filesJson: string | null;
  createdAt: number;
};
export type ProjectNoteKind = "rule" | "command" | "env" | "note";
export type ProjectNoteRow = {
  id: string;
  projectId: string;
  kind: ProjectNoteKind;
  title: string;
  content: string;
  enabled: number;
  createdAt: number;
  updatedAt: number;
};
export type OperationEventRow = {
  id: string;
  projectId: string;
  sessionId: string | null;
  kind: string;
  title: string;
  detailJson: string | null;
  undoJson: string | null;
  createdAt: number;
};
export type ScheduledJobRow = {
  id: string;
  projectId: string;
  sessionId: string | null;
  title: string;
  prompt: string;
  cadence: "interval" | "daily";
  intervalMinutes: number | null;
  dailyAt: string | null;
  enabled: number;
  lastRunAt: number | null;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
};

export class Store {
  readonly db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }
  resetInterruptedSessions() {
    const now = Date.now();
    const running = this.db
      .prepare("SELECT id, provider_id as providerId FROM sessions WHERE status='running'")
      .all() as Array<{ id: string; providerId: string | null }>;
    const mark = this.db.transaction(() => {
      for (const session of running) {
        this.upsertEventMessage({
          sessionId: session.id,
          role: "run",
          content: "任务未完成（已中断）",
          providerId: session.providerId,
          eventType: "run.interrupted",
          itemId: `${session.id}:current-run`,
          dataJson: JSON.stringify({
            status: "interrupted",
            endedAt: now,
            reason: "server-restart"
          })
        });
      }
      this.db
        .prepare(
          "UPDATE runs SET status='interrupted',ended_at=?,reason='server-restart',updated_at=? WHERE status='running'"
        )
        .run(now, now);
      this.db
        .prepare(
          "UPDATE approval_requests SET status='expired',resolved_at=? WHERE status='pending'"
        )
        .run(now);
      return this.db
        .prepare("UPDATE sessions SET status='interrupted',updated_at=? WHERE status='running'")
        .run(now).changes;
    });
    return mark();
  }
  private migrate() {
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'codex',model TEXT,base_url TEXT,api_key TEXT,config_toml TEXT,auth_json TEXT,env_json TEXT,is_default INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,display_path TEXT NOT NULL,real_path TEXT NOT NULL UNIQUE,provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,thread_id TEXT,title TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,continuation_mode TEXT,last_message_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,provider_id TEXT,event_type TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id,updated_at DESC); CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id,created_at);`);
    const sessionColumns = new Set(
      (this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!sessionColumns.has("pinned_at"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN pinned_at INTEGER");
    if (!sessionColumns.has("archived_at"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN archived_at INTEGER");
    if (!sessionColumns.has("color")) this.db.exec("ALTER TABLE sessions ADD COLUMN color TEXT");
    if (!sessionColumns.has("icon")) this.db.exec("ALTER TABLE sessions ADD COLUMN icon TEXT");
    if (!sessionColumns.has("tags_json"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN tags_json TEXT");
    const projectColumns = new Set(
      (this.db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!projectColumns.has("pinned_at"))
      this.db.exec("ALTER TABLE projects ADD COLUMN pinned_at INTEGER");
    if (!projectColumns.has("last_opened_at"))
      this.db.exec("ALTER TABLE projects ADD COLUMN last_opened_at INTEGER");
    const messageColumns = new Set(
      (this.db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!messageColumns.has("item_id"))
      this.db.exec("ALTER TABLE messages ADD COLUMN item_id TEXT");
    if (!messageColumns.has("data_json"))
      this.db.exec("ALTER TABLE messages ADD COLUMN data_json TEXT");
    if (!messageColumns.has("updated_at")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN updated_at INTEGER");
      this.db.exec("UPDATE messages SET updated_at=created_at WHERE updated_at IS NULL");
    }
    this.db.exec("DROP INDEX IF EXISTS idx_messages_session_item");
    this.db.exec("CREATE UNIQUE INDEX idx_messages_session_item ON messages(session_id,item_id)");
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_session_cursor ON messages(session_id,created_at,id)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_session_role ON messages(session_id,role,created_at,id)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_session_event ON messages(session_id,event_type,created_at,id)"
    );
    const providerColumns = new Set(
      (this.db.prepare("PRAGMA table_info(providers)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!providerColumns.has("models_json"))
      this.db.exec("ALTER TABLE providers ADD COLUMN models_json TEXT");
    if (!providerColumns.has("env_json"))
      this.db.exec("ALTER TABLE providers ADD COLUMN env_json TEXT");
    if (!providerColumns.has("home_mode"))
      this.db.exec("ALTER TABLE providers ADD COLUMN home_mode TEXT");
    if (!providerColumns.has("codex_home_path"))
      this.db.exec("ALTER TABLE providers ADD COLUMN codex_home_path TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        thread_id TEXT,
        status TEXT NOT NULL,
        service_instance_id TEXT NOT NULL,
        worker_pid INTEGER,
        codex_pid INTEGER,
        worker_started_at INTEGER,
        model TEXT,
        cwd TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        first_response_at INTEGER,
        ended_at INTEGER,
        last_seq INTEGER NOT NULL DEFAULT 0,
        last_event_at INTEGER NOT NULL,
        heartbeat_at INTEGER,
        reason TEXT,
        usage_json TEXT,
        reconnecting_json TEXT,
        source_queue_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_session_started ON runs(session_id,started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status,updated_at DESC);
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(run_id,seq)
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_session ON run_events(session_id,created_at);
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        item_id TEXT,
        tool TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        decision TEXT,
        payload_json TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_session_status ON approval_requests(session_id,status,created_at);
      CREATE TABLE IF NOT EXISTS queued_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        message TEXT NOT NULL,
        options_json TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queued_turns_session ON queued_turns(session_id,created_at,id);
    `);
    const runColumns = new Set(
      (this.db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!runColumns.has("source_queue_id"))
      this.db.exec("ALTER TABLE runs ADD COLUMN source_queue_id TEXT");
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_source_queue ON runs(source_queue_id) WHERE source_queue_id IS NOT NULL"
    );
    const queuedColumns = new Set(
      (this.db.prepare("PRAGMA table_info(queued_turns)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!queuedColumns.has("position")) {
      this.db.exec("ALTER TABLE queued_turns ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
      this.db.exec("UPDATE queued_turns SET position=rowid WHERE position=0");
    }
    this.db.exec("DROP INDEX IF EXISTS idx_queued_turns_session");
    this.db.exec(
      "CREATE INDEX idx_queued_turns_session ON queued_turns(session_id,position,created_at,id)"
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        command TEXT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        related_files_json TEXT,
        related_commit TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id,status,position,created_at);
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT,
        title TEXT NOT NULL,
        git_head TEXT,
        git_branch TEXT,
        git_status TEXT,
        patch TEXT,
        files_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS project_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project_id,enabled,updated_at DESC);
      CREATE TABLE IF NOT EXISTS message_stars (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_stars_session ON message_stars(session_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS operation_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail_json TEXT,
        undo_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operation_events_project ON operation_events(project_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cadence TEXT NOT NULL,
        interval_minutes INTEGER,
        daily_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next ON scheduled_jobs(enabled,next_run_at);
    `);
    this.ensureMessageSearch();
  }
  private ensureMessageSearch() {
    const existing = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
      .get() as { name: string } | undefined;
    if (!existing) {
      try {
        this.db.exec(
          "CREATE VIRTUAL TABLE messages_fts USING fts5(message_id UNINDEXED, session_id UNINDEXED, role UNINDEXED, content, tokenize='trigram')"
        );
      } catch {
        this.db.exec(
          "CREATE VIRTUAL TABLE messages_fts USING fts5(message_id UNINDEXED, session_id UNINDEXED, role UNINDEXED, content)"
        );
      }
    }
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(message_id, session_id, role, content)
        SELECT new.id, new.session_id, new.role, new.content
        WHERE new.role IN ('user', 'assistant') AND new.content != '';
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF content, role, session_id ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
        INSERT INTO messages_fts(message_id, session_id, role, content)
        SELECT new.id, new.session_id, new.role, new.content
        WHERE new.role IN ('user', 'assistant') AND new.content != '';
      END;
    `);
    const indexed = (
      this.db.prepare("SELECT COUNT(*) as count FROM messages_fts").get() as { count: number }
    ).count;
    const searchable = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM messages WHERE role IN ('user','assistant') AND content != ''"
        )
        .get() as { count: number }
    ).count;
    if (indexed === 0 && searchable > 0) {
      this.db.exec(
        "INSERT INTO messages_fts(message_id, session_id, role, content) SELECT id, session_id, role, content FROM messages WHERE role IN ('user','assistant') AND content != ''"
      );
    }
  }
  listProviders(): ProviderRow[] {
    return this.db
      .prepare(
        "SELECT id,name,kind,model,models_json as modelsJson,base_url as baseUrl,api_key as apiKey,config_toml as configToml,auth_json as authJson,env_json as envJson,is_default as isDefault,home_mode as homeMode,codex_home_path as codexHomePath,created_at as createdAt,updated_at as updatedAt FROM providers ORDER BY is_default DESC,name"
      )
      .all() as ProviderRow[];
  }
  getProvider(id: string) {
    return this.db
      .prepare(
        "SELECT id,name,kind,model,models_json as modelsJson,base_url as baseUrl,api_key as apiKey,config_toml as configToml,auth_json as authJson,env_json as envJson,is_default as isDefault,home_mode as homeMode,codex_home_path as codexHomePath,created_at as createdAt,updated_at as updatedAt FROM providers WHERE id=?"
      )
      .get(id) as ProviderRow | undefined;
  }
  upsertProvider(input: Partial<ProviderRow> & Pick<ProviderRow, "name">): ProviderRow {
    const now = Date.now(),
      id = input.id ?? nanoid();
    const transaction = this.db.transaction(() => {
      if (input.isDefault) {
        this.db.prepare("UPDATE providers SET is_default=0,updated_at=?").run(now);
      }
      this.db
        .prepare(
          `INSERT INTO providers(id,name,kind,model,models_json,base_url,api_key,config_toml,auth_json,env_json,is_default,home_mode,codex_home_path,created_at,updated_at) VALUES(@id,@name,@kind,@model,@modelsJson,@baseUrl,@apiKey,@configToml,@authJson,@envJson,@isDefault,@homeMode,@codexHomePath,@now,@now) ON CONFLICT(id) DO UPDATE SET name=@name,kind=@kind,model=@model,models_json=@modelsJson,base_url=@baseUrl,api_key=@apiKey,config_toml=@configToml,auth_json=@authJson,env_json=@envJson,is_default=@isDefault,home_mode=@homeMode,codex_home_path=@codexHomePath,updated_at=@now`
        )
        .run({
          id,
          name: input.name,
          kind: input.kind ?? "codex",
          model: input.model ?? null,
          modelsJson: input.modelsJson ?? null,
          baseUrl: input.baseUrl ?? null,
          apiKey: input.apiKey ?? null,
          configToml: input.configToml ?? null,
          authJson: input.authJson ?? null,
          envJson: input.envJson ?? null,
          isDefault: input.isDefault ? 1 : 0,
          homeMode: input.homeMode ?? "managed",
          codexHomePath: input.codexHomePath ?? null,
          now
        });
    });
    transaction();
    return this.getProvider(id)!;
  }
  deleteProvider(id: string) {
    const deleted = this.db.prepare("DELETE FROM providers WHERE id=?").run(id).changes > 0;
    if (deleted && !this.db.prepare("SELECT 1 FROM providers WHERE is_default=1 LIMIT 1").get()) {
      this.db
        .prepare(
          "UPDATE providers SET is_default=1 WHERE id=(SELECT id FROM providers ORDER BY name LIMIT 1)"
        )
        .run();
    }
    return deleted;
  }
  getSettings<T extends Record<string, unknown>>(defaults: T): T {
    const rows = this.db.prepare("SELECT key,value FROM app_settings").all() as Array<{
      key: string;
      value: string;
    }>;
    const result = { ...defaults } as T;
    for (const row of rows) {
      try {
        (result as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        // Ignore malformed legacy values and retain defaults.
      }
    }
    return result;
  }
  updateSettings(values: Record<string, unknown>) {
    const statement = this.db.prepare(
      "INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    );
    const transaction = this.db.transaction(() => {
      for (const [key, value] of Object.entries(values))
        statement.run(key, JSON.stringify(value), Date.now());
    });
    transaction();
  }
  listProjects(): ProjectRow[] {
    return this.db
      .prepare(
        "SELECT id,name,display_path as displayPath,real_path as realPath,provider_id as providerId,pinned_at as pinnedAt,last_opened_at as lastOpenedAt,created_at as createdAt,updated_at as updatedAt FROM projects ORDER BY (pinned_at IS NOT NULL) DESC, pinned_at DESC, COALESCE(last_opened_at, updated_at, created_at) DESC, id DESC"
      )
      .all() as ProjectRow[];
  }
  getProject(id: string) {
    return this.db
      .prepare(
        "SELECT id,name,display_path as displayPath,real_path as realPath,provider_id as providerId,pinned_at as pinnedAt,last_opened_at as lastOpenedAt,created_at as createdAt,updated_at as updatedAt FROM projects WHERE id=?"
      )
      .get(id) as ProjectRow | undefined;
  }
  createProject(input: {
    name: string;
    displayPath: string;
    realPath: string;
    providerId?: string | null;
  }): ProjectRow {
    const now = Date.now(),
      id = nanoid();
    this.db
      .prepare(
        "INSERT INTO projects(id,name,display_path,real_path,provider_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
      )
      .run(id, input.name, input.displayPath, input.realPath, input.providerId ?? null, now, now);
    return this.getProject(id)!;
  }
  updateProject(
    id: string,
    input: Partial<Pick<ProjectRow, "name" | "providerId" | "pinnedAt" | "lastOpenedAt">>
  ) {
    const now = Date.now();
    const fields = Object.keys(input)
      .map((key) => `${key.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)}=@${key}`)
      .join(",");
    if (!fields) return this.getProject(id);
    this.db
      .prepare(`UPDATE projects SET ${fields},updated_at=@now WHERE id=@id`)
      .run({ ...input, id, now });
    return this.getProject(id);
  }
  deleteProject(id: string) {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE sessions SET parent_session_id=NULL
           WHERE parent_session_id IN (SELECT id FROM sessions WHERE project_id=?)`
        )
        .run(id);
      this.db
        .prepare(
          "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE project_id=?)"
        )
        .run(id);
      this.db.prepare("DELETE FROM sessions WHERE project_id=?").run(id);
      return this.db.prepare("DELETE FROM projects WHERE id=?").run(id).changes > 0;
    });
    return transaction();
  }
  listSessions(
    projectId: string,
    options: { query?: string; includeArchived?: boolean; status?: SessionRow["status"] | "" } = {}
  ): SessionRow[] {
    const query = options.query?.trim() ?? "";
    const status = options.status ?? "";
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,thread_id as threadId,title,status,provider_id as providerId,parent_session_id as parentSessionId,continuation_mode as continuationMode,last_message_at as lastMessageAt,pinned_at as pinnedAt,archived_at as archivedAt,color,icon,tags_json as tagsJson,created_at as createdAt,updated_at as updatedAt,
          (SELECT m.content FROM messages m WHERE m.session_id=sessions.id AND m.role='user' ORDER BY m.created_at, m.id LIMIT 1) as firstUserMessage
         FROM sessions
         WHERE project_id=@projectId
           AND (@includeArchived=1 OR archived_at IS NULL)
           AND (@status='' OR status=@status)
           AND (@query='' OR title LIKE @like ESCAPE '\\' OR EXISTS (
             SELECT 1 FROM messages m
             WHERE m.session_id=sessions.id AND m.role IN ('user','assistant') AND m.content LIKE @like ESCAPE '\\'
           ))
         ORDER BY (pinned_at IS NOT NULL) DESC,pinned_at DESC,COALESCE(last_message_at, updated_at, created_at) DESC,created_at DESC,id DESC`
      )
      .all({
        projectId,
        includeArchived: options.includeArchived ? 1 : 0,
        status,
        query,
        like: `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`
      })
      .map((row) => this.hydrateSession(row as SessionRow & { firstUserMessage?: string | null }));
  }
  searchSessions(
    query: string,
    options: { projectId?: string; limit?: number; status?: SessionRow["status"] | "" } = {}
  ): SessionSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = Math.min(Math.max(options.limit ?? 12, 1), 40);
    const status = options.status ?? "";
    return this.db
      .prepare(
        `SELECT sessions.id,sessions.project_id as projectId,sessions.thread_id as threadId,sessions.title,sessions.status,sessions.provider_id as providerId,sessions.parent_session_id as parentSessionId,sessions.continuation_mode as continuationMode,sessions.last_message_at as lastMessageAt,sessions.pinned_at as pinnedAt,sessions.archived_at as archivedAt,sessions.color as color,sessions.icon as icon,sessions.tags_json as tagsJson,sessions.created_at as createdAt,sessions.updated_at as updatedAt,
          projects.name as projectName,
          (SELECT m.content FROM messages m WHERE m.session_id=sessions.id AND m.role='user' ORDER BY m.created_at, m.id LIMIT 1) as firstUserMessage,
          (SELECT m.content FROM messages m
            WHERE m.session_id=sessions.id AND m.role IN ('user','assistant') AND m.content LIKE @like ESCAPE '\\'
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1) as matchedMessage
         FROM sessions
         JOIN projects ON projects.id = sessions.project_id
         WHERE sessions.archived_at IS NULL
           AND (@projectId='' OR sessions.project_id=@projectId)
           AND (@status='' OR sessions.status=@status)
           AND (
             sessions.title LIKE @like ESCAPE '\\'
             OR projects.name LIKE @like ESCAPE '\\'
             OR EXISTS (
               SELECT 1 FROM messages m
               WHERE m.session_id=sessions.id AND m.role IN ('user','assistant') AND m.content LIKE @like ESCAPE '\\'
             )
           )
         ORDER BY (sessions.pinned_at IS NOT NULL) DESC, COALESCE(sessions.last_message_at, sessions.updated_at, sessions.created_at) DESC
         LIMIT @limit`
      )
      .all({
        projectId: options.projectId ?? "",
        status,
        like: likePattern(trimmed),
        limit
      })
      .map((row) => {
        const raw = row as SessionRow & {
          firstUserMessage?: string | null;
          projectName: string;
          matchedMessage?: string | null;
        };
        const hit = this.hydrateSession(raw) as SessionSearchHit;
        hit.projectName = raw.projectName;
        hit.snippet = makeSnippet(raw.matchedMessage || raw.title, trimmed);
        return hit;
      });
  }
  searchMessages(
    query: string,
    options: { projectId?: string; limit?: number } = {}
  ): MessageSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = Math.min(Math.max(options.limit ?? 12, 1), 40);
    const params = {
      projectId: options.projectId ?? "",
      like: likePattern(trimmed),
      limit
    };
    const fts = ftsMatchQuery(trimmed);
    type MessageHitRow = {
      id: string;
      sessionId: string;
      role: string;
      content: string;
      createdAt: number;
      projectId: string;
      sessionTitle: string;
      projectName: string;
    };
    const searchByLike = () =>
      this.db
        .prepare(
          `SELECT m.id, m.session_id as sessionId, m.role, m.content, m.created_at as createdAt,
                    s.project_id as projectId, s.title as sessionTitle, p.name as projectName
             FROM messages m
             JOIN sessions s ON s.id = m.session_id
             JOIN projects p ON p.id = s.project_id
             WHERE m.role IN ('user','assistant')
               AND m.content LIKE @like ESCAPE '\\'
               AND s.archived_at IS NULL
               AND (@projectId='' OR s.project_id=@projectId)
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT @limit`
        )
        .all(params) as MessageHitRow[];
    let rows: MessageHitRow[] = [];
    if (fts) {
      try {
        rows = this.db
          .prepare(
            `SELECT m.id, m.session_id as sessionId, m.role, m.content, m.created_at as createdAt,
                    s.project_id as projectId, s.title as sessionTitle, p.name as projectName
             FROM messages_fts f
             JOIN messages m ON m.id = f.message_id
             JOIN sessions s ON s.id = m.session_id
             JOIN projects p ON p.id = s.project_id
             WHERE f MATCH @fts
               AND s.archived_at IS NULL
               AND (@projectId='' OR s.project_id=@projectId)
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT @limit`
          )
          .all({ ...params, fts }) as MessageHitRow[];
      } catch {
        rows = searchByLike();
      }
    } else {
      rows = searchByLike();
    }
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      projectId: row.projectId,
      projectName: row.projectName,
      sessionTitle: resolveSessionTitle(row.sessionTitle, null),
      role: row.role,
      snippet: makeSnippet(row.content, trimmed),
      createdAt: row.createdAt
    }));
  }
  getSession(id: string) {
    const row = this.db
      .prepare(
        `SELECT id,project_id as projectId,thread_id as threadId,title,status,provider_id as providerId,parent_session_id as parentSessionId,continuation_mode as continuationMode,last_message_at as lastMessageAt,pinned_at as pinnedAt,archived_at as archivedAt,color,icon,tags_json as tagsJson,created_at as createdAt,updated_at as updatedAt,
          (SELECT m.content FROM messages m WHERE m.session_id=sessions.id AND m.role='user' ORDER BY m.created_at, m.id LIMIT 1) as firstUserMessage
         FROM sessions WHERE id=?`
      )
      .get(id) as (SessionRow & { firstUserMessage?: string | null }) | undefined;
    return row ? this.hydrateSession(row) : undefined;
  }
  private hydrateSession(row: SessionRow & { firstUserMessage?: string | null }): SessionRow {
    const { firstUserMessage, tagsJson, ...session } = row;
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(tagsJson ?? "[]");
      if (Array.isArray(parsed))
        tags = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      tags = [];
    }
    return {
      ...session,
      tagsJson: tagsJson ?? null,
      tags,
      color: session.color ?? null,
      icon: session.icon ?? null,
      title: resolveSessionTitle(session.title, firstUserMessage)
    };
  }
  createSession(input: {
    projectId: string;
    title?: string;
    providerId?: string | null;
    parentSessionId?: string | null;
    continuationMode?: string | null;
  }): SessionRow {
    const now = Date.now(),
      id = nanoid();
    this.db
      .prepare(
        "INSERT INTO sessions(id,project_id,title,status,provider_id,parent_session_id,continuation_mode,pinned_at,archived_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        id,
        input.projectId,
        input.title ?? DEFAULT_SESSION_TITLE,
        "idle",
        input.providerId ?? null,
        input.parentSessionId ?? null,
        input.continuationMode ?? null,
        null,
        null,
        now,
        now
      );
    return this.getSession(id)!;
  }
  updateSession(
    id: string,
    input: Partial<
      Pick<
        SessionRow,
        | "threadId"
        | "status"
        | "providerId"
        | "title"
        | "pinnedAt"
        | "archivedAt"
        | "color"
        | "icon"
        | "tagsJson"
      >
    >
  ) {
    const now = Date.now();
    const fields = Object.keys(input)
      .map((k) => `${k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}=@${k}`)
      .join(",");
    if (!fields) return this.getSession(id)!;
    const timestamp = input.status
      ? ",last_message_at=CASE WHEN @status='idle' OR @status='failed' THEN last_message_at ELSE @now END"
      : "";
    this.db
      .prepare(`UPDATE sessions SET ${fields},updated_at=@now${timestamp} WHERE id=@id`)
      .run({ ...input, id, now });
    return this.getSession(id)!;
  }
  deleteSession(id: string) {
    return this.db.prepare("DELETE FROM sessions WHERE id=?").run(id).changes > 0;
  }
  addMessage(
    input: Omit<MessageRow, "id" | "createdAt" | "updatedAt" | "itemId" | "dataJson"> & {
      itemId?: string | null;
      dataJson?: string | null;
    }
  ): MessageRow {
    const id = nanoid(),
      createdAt = Date.now();
    this.db
      .prepare(
        "INSERT INTO messages(id,session_id,role,content,provider_id,event_type,item_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        id,
        input.sessionId,
        input.role,
        input.content,
        input.providerId ?? null,
        input.eventType ?? null,
        input.itemId ?? null,
        input.dataJson ?? null,
        createdAt,
        createdAt
      );
    return {
      id,
      createdAt,
      updatedAt: createdAt,
      itemId: input.itemId ?? null,
      dataJson: input.dataJson ?? null,
      ...input
    };
  }
  getMessage(id: string) {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,role,content,provider_id as providerId,event_type as eventType,item_id as itemId,data_json as dataJson,created_at as createdAt,updated_at as updatedAt FROM messages WHERE id=?"
      )
      .get(id) as MessageRow | undefined;
  }
  getMessageByItemId(sessionId: string, itemId: string) {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,role,content,provider_id as providerId,event_type as eventType,item_id as itemId,data_json as dataJson,created_at as createdAt,updated_at as updatedAt FROM messages WHERE session_id=? AND item_id=?"
      )
      .get(sessionId, itemId) as MessageRow | undefined;
  }
  upsertEventMessage(input: {
    sessionId: string;
    role: MessageRow["role"];
    content: string;
    providerId?: string | null;
    eventType: string;
    itemId: string;
    dataJson?: string | null;
    createdAt?: number;
  }) {
    const now = Date.now();
    const createdAt =
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? input.createdAt
        : now;
    this.db
      .prepare(
        `INSERT INTO messages(id,session_id,role,content,provider_id,event_type,item_id,data_json,created_at,updated_at)
         VALUES(@id,@sessionId,@role,@content,@providerId,@eventType,@itemId,@dataJson,@createdAt,@now)
         ON CONFLICT(session_id,item_id) DO UPDATE SET role=@role,content=@content,provider_id=@providerId,event_type=@eventType,data_json=@dataJson,updated_at=@now`
      )
      .run({
        id: nanoid(),
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        providerId: input.providerId ?? null,
        eventType: input.eventType,
        itemId: input.itemId,
        dataJson: input.dataJson ?? null,
        createdAt,
        now
      });
  }
  listMessages(sessionId: string): MessageRow[] {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,role,content,provider_id as providerId,event_type as eventType,item_id as itemId,data_json as dataJson,created_at as createdAt,updated_at as updatedAt FROM messages WHERE session_id=? ORDER BY created_at,id"
      )
      .all(sessionId) as MessageRow[];
  }
  hasMessageRole(sessionId: string, role: MessageRow["role"]) {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM messages WHERE session_id=? AND role=? LIMIT 1")
        .get(sessionId, role)
    );
  }
  findMessageByEventType(sessionId: string, eventType: string) {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,role,content,provider_id as providerId,event_type as eventType,item_id as itemId,data_json as dataJson,created_at as createdAt,updated_at as updatedAt FROM messages WHERE session_id=? AND event_type=? ORDER BY created_at DESC,id DESC LIMIT 1"
      )
      .get(sessionId, eventType) as MessageRow | undefined;
  }
  listRecentConversationMessages(sessionId: string, limit = 20): MessageRow[] {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    return (
      this.db
        .prepare(
          "SELECT id,session_id as sessionId,role,content,provider_id as providerId,event_type as eventType,item_id as itemId,data_json as dataJson,created_at as createdAt,updated_at as updatedAt FROM messages WHERE session_id=? AND role IN ('user','assistant') ORDER BY created_at DESC,id DESC LIMIT ?"
        )
        .all(sessionId, safeLimit) as MessageRow[]
    ).reverse();
  }
  getLatestRunMessage(sessionId: string) {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,role,content,provider_id as providerId,event_type as eventType,item_id as itemId,data_json as dataJson,created_at as createdAt,updated_at as updatedAt FROM messages WHERE session_id=? AND role='run' ORDER BY updated_at DESC,id DESC LIMIT 1"
      )
      .get(sessionId) as MessageRow | undefined;
  }
  createRun(input: {
    id: string;
    sessionId: string;
    projectId: string;
    providerId?: string | null;
    serviceInstanceId: string;
    model?: string | null;
    cwd: string;
    startedAt: number;
    sourceQueueId?: string | null;
  }): RunRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO runs(id,session_id,project_id,provider_id,thread_id,status,service_instance_id,worker_pid,codex_pid,worker_started_at,model,cwd,started_at,first_response_at,ended_at,last_seq,last_event_at,heartbeat_at,reason,usage_json,reconnecting_json,source_queue_id,created_at,updated_at)
         VALUES(@id,@sessionId,@projectId,@providerId,NULL,'running',@serviceInstanceId,NULL,NULL,NULL,@model,@cwd,@startedAt,NULL,NULL,0,@startedAt,NULL,NULL,NULL,NULL,@sourceQueueId,@now,@now)`
      )
      .run({
        id: input.id,
        sessionId: input.sessionId,
        projectId: input.projectId,
        providerId: input.providerId ?? null,
        serviceInstanceId: input.serviceInstanceId,
        model: input.model ?? null,
        cwd: input.cwd,
        startedAt: input.startedAt,
        sourceQueueId: input.sourceQueueId ?? null,
        now
      });
    return this.getRun(input.id)!;
  }
  getRun(id: string) {
    return this.db
      .prepare(
        `SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,thread_id as threadId,status,service_instance_id as serviceInstanceId,worker_pid as workerPid,codex_pid as codexPid,worker_started_at as workerStartedAt,model,cwd,started_at as startedAt,first_response_at as firstResponseAt,ended_at as endedAt,last_seq as lastSeq,last_event_at as lastEventAt,heartbeat_at as heartbeatAt,reason,usage_json as usageJson,reconnecting_json as reconnectingJson,source_queue_id as sourceQueueId,created_at as createdAt,updated_at as updatedAt
         FROM runs WHERE id=?`
      )
      .get(id) as RunRow | undefined;
  }
  getRunBySourceQueueId(sourceQueueId: string) {
    return this.db
      .prepare(
        `SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,thread_id as threadId,status,service_instance_id as serviceInstanceId,worker_pid as workerPid,codex_pid as codexPid,worker_started_at as workerStartedAt,model,cwd,started_at as startedAt,first_response_at as firstResponseAt,ended_at as endedAt,last_seq as lastSeq,last_event_at as lastEventAt,heartbeat_at as heartbeatAt,reason,usage_json as usageJson,reconnecting_json as reconnectingJson,source_queue_id as sourceQueueId,created_at as createdAt,updated_at as updatedAt
         FROM runs WHERE source_queue_id=? LIMIT 1`
      )
      .get(sourceQueueId) as RunRow | undefined;
  }
  getLatestRun(sessionId: string) {
    return this.db
      .prepare(
        `SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,thread_id as threadId,status,service_instance_id as serviceInstanceId,worker_pid as workerPid,codex_pid as codexPid,worker_started_at as workerStartedAt,model,cwd,started_at as startedAt,first_response_at as firstResponseAt,ended_at as endedAt,last_seq as lastSeq,last_event_at as lastEventAt,heartbeat_at as heartbeatAt,reason,usage_json as usageJson,reconnecting_json as reconnectingJson,source_queue_id as sourceQueueId,created_at as createdAt,updated_at as updatedAt
         FROM runs WHERE session_id=? ORDER BY started_at DESC,id DESC LIMIT 1`
      )
      .get(sessionId) as RunRow | undefined;
  }
  listRunningRuns(): RunRow[] {
    return this.db
      .prepare(
        `SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,thread_id as threadId,status,service_instance_id as serviceInstanceId,worker_pid as workerPid,codex_pid as codexPid,worker_started_at as workerStartedAt,model,cwd,started_at as startedAt,first_response_at as firstResponseAt,ended_at as endedAt,last_seq as lastSeq,last_event_at as lastEventAt,heartbeat_at as heartbeatAt,reason,usage_json as usageJson,reconnecting_json as reconnectingJson,source_queue_id as sourceQueueId,created_at as createdAt,updated_at as updatedAt
         FROM runs WHERE status='running' ORDER BY started_at DESC,id DESC`
      )
      .all() as RunRow[];
  }
  updateRun(
    id: string,
    input: Partial<
      Pick<
        RunRow,
        | "threadId"
        | "status"
        | "workerPid"
        | "codexPid"
        | "workerStartedAt"
        | "firstResponseAt"
        | "endedAt"
        | "lastSeq"
        | "lastEventAt"
        | "heartbeatAt"
        | "reason"
        | "usageJson"
        | "reconnectingJson"
      >
    >
  ) {
    const entries = Object.entries(input);
    if (!entries.length) return this.getRun(id);
    const fields = entries
      .map(([key]) => `${key.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)}=@${key}`)
      .join(",");
    this.db
      .prepare(`UPDATE runs SET ${fields},updated_at=@updatedAt WHERE id=@id`)
      .run({ ...input, id, updatedAt: Date.now() });
    return this.getRun(id);
  }
  appendRunEvent(runId: string, sessionId: string, seq: number, eventJson: string) {
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO run_events(run_id,session_id,seq,event_json,created_at) VALUES(?,?,?,?,?)"
        )
        .run(runId, sessionId, seq, eventJson, now);
      this.db
        .prepare("UPDATE runs SET last_seq=MAX(last_seq,?),last_event_at=?,updated_at=? WHERE id=?")
        .run(seq, now, now, runId);
      this.db
        .prepare("DELETE FROM run_events WHERE run_id=? AND seq<=?")
        .run(runId, Math.max(0, seq - 1000));
    });
    transaction();
  }
  listRunEvents(runId: string, afterSeq = -1, limit = 1001) {
    const safeLimit = Math.max(1, Math.min(2000, Math.trunc(limit)));
    return this.db
      .prepare(
        "SELECT seq,event_json as eventJson,created_at as createdAt FROM run_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?"
      )
      .all(runId, afterSeq, safeLimit) as Array<{
      seq: number;
      eventJson: string;
      createdAt: number;
    }>;
  }
  upsertApproval(input: {
    id: string;
    runId: string;
    sessionId: string;
    itemId?: string | null;
    tool: string;
    command: string;
    payloadJson?: string | null;
  }): ApprovalRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO approval_requests(id,run_id,session_id,item_id,tool,command,status,decision,payload_json,created_at,resolved_at)
         VALUES(@id,@runId,@sessionId,@itemId,@tool,@command,'pending',NULL,@payloadJson,@now,NULL)
         ON CONFLICT(id) DO UPDATE SET item_id=@itemId,tool=@tool,command=@command,payload_json=@payloadJson`
      )
      .run({
        ...input,
        itemId: input.itemId ?? null,
        payloadJson: input.payloadJson ?? null,
        now
      });
    return this.getApproval(input.id)!;
  }
  getApproval(id: string) {
    return this.db
      .prepare(
        `SELECT id,run_id as runId,session_id as sessionId,item_id as itemId,tool,command,status,decision,payload_json as payloadJson,created_at as createdAt,resolved_at as resolvedAt
         FROM approval_requests WHERE id=?`
      )
      .get(id) as ApprovalRow | undefined;
  }
  listPendingApprovals(sessionId: string): ApprovalRow[] {
    return this.db
      .prepare(
        `SELECT id,run_id as runId,session_id as sessionId,item_id as itemId,tool,command,status,decision,payload_json as payloadJson,created_at as createdAt,resolved_at as resolvedAt
         FROM approval_requests WHERE session_id=? AND status='pending' ORDER BY created_at,id`
      )
      .all(sessionId) as ApprovalRow[];
  }
  resolveApproval(
    id: string,
    status: Exclude<ApprovalRow["status"], "pending">,
    decision?: string | null
  ) {
    const resolvedAt = Date.now();
    this.db
      .prepare(
        "UPDATE approval_requests SET status=?,decision=?,resolved_at=? WHERE id=? AND status='pending'"
      )
      .run(status, decision ?? null, resolvedAt, id);
    return this.getApproval(id);
  }
  resolvePendingApprovals(
    sessionId: string,
    status: Exclude<ApprovalRow["status"], "pending"> = "expired"
  ) {
    return this.db
      .prepare(
        "UPDATE approval_requests SET status=?,resolved_at=? WHERE session_id=? AND status='pending'"
      )
      .run(status, Date.now(), sessionId).changes;
  }
  listApprovals(
    options: {
      projectId?: string;
      sessionId?: string;
      status?: ApprovalRow["status"] | "";
      limit?: number;
    } = {}
  ): ApprovalListItem[] {
    const limit = Math.min(Math.max(options.limit ?? 80, 1), 200);
    return this.db
      .prepare(
        `SELECT a.id,a.run_id as runId,a.session_id as sessionId,a.item_id as itemId,a.tool,a.command,a.status,a.decision,a.payload_json as payloadJson,a.created_at as createdAt,a.resolved_at as resolvedAt,
          s.project_id as projectId, p.name as projectName, s.title as sessionTitle
         FROM approval_requests a
         JOIN sessions s ON s.id = a.session_id
         JOIN projects p ON p.id = s.project_id
         WHERE (@projectId='' OR s.project_id=@projectId)
           AND (@sessionId='' OR a.session_id=@sessionId)
           AND (@status='' OR a.status=@status)
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT @limit`
      )
      .all({
        projectId: options.projectId ?? "",
        sessionId: options.sessionId ?? "",
        status: options.status ?? "",
        limit
      }) as ApprovalListItem[];
  }
  approvalStats(options: { projectId?: string; sessionId?: string } = {}): ApprovalStats {
    const rows = this.db
      .prepare(
        `SELECT a.status as status, COUNT(*) as count
         FROM approval_requests a
         JOIN sessions s ON s.id = a.session_id
         WHERE (@projectId='' OR s.project_id=@projectId)
           AND (@sessionId='' OR a.session_id=@sessionId)
         GROUP BY a.status`
      )
      .all({
        projectId: options.projectId ?? "",
        sessionId: options.sessionId ?? ""
      }) as Array<{ status: ApprovalRow["status"]; count: number }>;
    const stats: ApprovalStats = {
      total: 0,
      pending: 0,
      accepted: 0,
      declined: 0,
      cancelled: 0,
      expired: 0
    };
    for (const row of rows) {
      stats[row.status] = Number(row.count);
      stats.total += Number(row.count);
    }
    return stats;
  }
  clearSessionRunRecords(sessionId: string) {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM run_events WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM runs WHERE session_id=? AND status!='running'").run(sessionId);
      this.db
        .prepare(
          "DELETE FROM messages WHERE session_id=? AND role IN ('tool','file','run','reasoning')"
        )
        .run(sessionId);
    });
    transaction();
    return this.getSession(sessionId);
  }
  forkSession(sourceId: string, messageId?: string) {
    const source = this.getSession(sourceId);
    if (!source) return undefined;
    const conversation = this.listMessages(sourceId).filter(
      (message) => message.role === "user" || message.role === "assistant"
    );
    const index = messageId ? conversation.findIndex((message) => message.id === messageId) : -1;
    const copied = messageId
      ? index >= 0
        ? conversation.slice(0, index + 1)
        : conversation
      : conversation;
    const target = this.createSession({
      projectId: source.projectId,
      title: `${source.title} (分叉)`,
      providerId: source.providerId,
      parentSessionId: source.id,
      continuationMode: "fork"
    });
    for (const message of copied) {
      this.addMessage({
        sessionId: target.id,
        role: message.role,
        content: message.content,
        providerId: message.providerId,
        eventType: message.eventType,
        ...(message.itemId ? { itemId: message.itemId } : {}),
        ...(message.dataJson ? { dataJson: message.dataJson } : {})
      });
    }
    return target;
  }
  enqueueTurn(input: {
    id?: string;
    sessionId: string;
    projectId: string;
    providerId?: string | null;
    message: string;
    optionsJson: string;
  }): QueuedTurnRow {
    const id = input.id ?? nanoid();
    const existing = this.getQueuedTurn(id);
    if (existing) {
      if (existing.sessionId !== input.sessionId) throw new Error("Queued turn id already exists");
      this.db
        .prepare(
          "UPDATE queued_turns SET provider_id=?,message=?,options_json=?,updated_at=? WHERE id=?"
        )
        .run(input.providerId ?? null, input.message, input.optionsJson, Date.now(), existing.id);
      return this.getQueuedTurn(id)!;
    }
    const now = Date.now();
    const position = Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(position),0)+1 as position FROM queued_turns WHERE session_id=?"
          )
          .get(input.sessionId) as { position: number }
      ).position
    );
    this.db
      .prepare(
        "INSERT INTO queued_turns(id,session_id,project_id,provider_id,message,options_json,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
      )
      .run(
        id,
        input.sessionId,
        input.projectId,
        input.providerId ?? null,
        input.message,
        input.optionsJson,
        position,
        now,
        now
      );
    return this.getQueuedTurn(id)!;
  }
  getQueuedTurn(id: string) {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,message,options_json as optionsJson,position,created_at as createdAt,updated_at as updatedAt FROM queued_turns WHERE id=?"
      )
      .get(id) as QueuedTurnRow | undefined;
  }
  listQueuedTurns(sessionId: string): QueuedTurnRow[] {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,message,options_json as optionsJson,position,created_at as createdAt,updated_at as updatedAt FROM queued_turns WHERE session_id=? ORDER BY position,created_at,id"
      )
      .all(sessionId) as QueuedTurnRow[];
  }
  updateQueuedTurn(id: string, message: string, optionsJson?: string) {
    if (optionsJson === undefined) {
      this.db
        .prepare("UPDATE queued_turns SET message=?,updated_at=? WHERE id=?")
        .run(message, Date.now(), id);
    } else {
      this.db
        .prepare("UPDATE queued_turns SET message=?,options_json=?,updated_at=? WHERE id=?")
        .run(message, optionsJson, Date.now(), id);
    }
    return this.getQueuedTurn(id);
  }
  moveQueuedTurn(sessionId: string, queueId: string, direction: "up" | "down") {
    const items = this.listQueuedTurns(sessionId);
    const index = items.findIndex((item) => item.id === queueId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= items.length) return items;
    const current = items[index]!;
    const neighbor = items[target]!;
    const now = Date.now();
    const swap = this.db.transaction(() => {
      this.db
        .prepare("UPDATE queued_turns SET position=?,updated_at=? WHERE id=?")
        .run(neighbor.position, now, current.id);
      this.db
        .prepare("UPDATE queued_turns SET position=?,updated_at=? WHERE id=?")
        .run(current.position, now, neighbor.id);
    });
    swap();
    return this.listQueuedTurns(sessionId);
  }
  deleteQueuedTurn(id: string) {
    return this.db.prepare("DELETE FROM queued_turns WHERE id=?").run(id).changes > 0;
  }
  listMessagePage(
    sessionId: string,
    options: { limit?: number; before?: MessageCursor } = {}
  ): MessagePage {
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50)));
    const params = {
      sessionId,
      limit: limit + 1,
      beforeCreatedAt: options.before?.createdAt ?? null,
      beforeId: options.before?.id ?? null
    };
    const rows = this.db
      .prepare(
        `SELECT id,session_id as sessionId,role,content,provider_id as providerId,event_type as eventType,item_id as itemId,data_json as dataJson,created_at as createdAt,updated_at as updatedAt
         FROM messages
         WHERE session_id=@sessionId
           AND (@beforeCreatedAt IS NULL OR created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId))
         ORDER BY created_at DESC,id DESC
         LIMIT @limit`
      )
      .all(params) as MessageRow[];
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    const oldest = messages[0];
    return {
      messages,
      hasMore,
      nextCursor: hasMore && oldest ? { createdAt: oldest.createdAt, id: oldest.id } : null
    };
  }
  listPromptTemplates(): PromptTemplateRow[] {
    return this.db
      .prepare(
        "SELECT id,name,command,content,created_at as createdAt,updated_at as updatedAt FROM prompt_templates ORDER BY name,created_at"
      )
      .all() as PromptTemplateRow[];
  }
  upsertPromptTemplate(input: {
    id?: string;
    name: string;
    command?: string | null;
    content: string;
  }) {
    const id = input.id ?? nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO prompt_templates(id,name,command,content,created_at,updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,command=excluded.command,content=excluded.content,updated_at=excluded.updated_at`
      )
      .run(id, input.name, input.command ?? null, input.content, now, now);
    return this.db
      .prepare(
        "SELECT id,name,command,content,created_at as createdAt,updated_at as updatedAt FROM prompt_templates WHERE id=?"
      )
      .get(id) as PromptTemplateRow;
  }
  deletePromptTemplate(id: string) {
    return this.db.prepare("DELETE FROM prompt_templates WHERE id=?").run(id).changes > 0;
  }
  getTask(id: string) {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,session_id as sessionId,title,description,status,related_files_json as relatedFilesJson,related_commit as relatedCommit,position,created_at as createdAt,updated_at as updatedAt
         FROM tasks WHERE id=?`
      )
      .get(id) as TaskRow | undefined;
  }
  listTasks(projectId: string): TaskRow[] {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,session_id as sessionId,title,description,status,related_files_json as relatedFilesJson,related_commit as relatedCommit,position,created_at as createdAt,updated_at as updatedAt
         FROM tasks WHERE project_id=? ORDER BY status,position,created_at,id`
      )
      .all(projectId) as TaskRow[];
  }
  upsertTask(input: {
    id?: string;
    projectId: string;
    sessionId?: string | null;
    title: string;
    description?: string | null;
    status?: TaskStatus;
    relatedFilesJson?: string | null;
    relatedCommit?: string | null;
    position?: number;
  }) {
    const id = input.id ?? nanoid();
    const now = Date.now();
    const existing = this.getTask(id);
    const status = input.status ?? existing?.status ?? "todo";
    const position =
      input.position ??
      existing?.position ??
      Number(
        (
          this.db
            .prepare(
              "SELECT COALESCE(MAX(position),0)+1 as position FROM tasks WHERE project_id=? AND status=?"
            )
            .get(input.projectId, status) as { position: number }
        ).position
      );
    if (existing) {
      this.db
        .prepare(
          `UPDATE tasks SET title=?,description=?,status=?,session_id=?,related_files_json=?,related_commit=?,position=?,updated_at=? WHERE id=?`
        )
        .run(
          input.title,
          input.description ?? null,
          status,
          input.sessionId ?? null,
          input.relatedFilesJson ?? null,
          input.relatedCommit ?? null,
          position,
          now,
          id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO tasks(id,project_id,session_id,title,description,status,related_files_json,related_commit,position,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          input.projectId,
          input.sessionId ?? null,
          input.title,
          input.description ?? null,
          status,
          input.relatedFilesJson ?? null,
          input.relatedCommit ?? null,
          position,
          now,
          now
        );
    }
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,session_id as sessionId,title,description,status,related_files_json as relatedFilesJson,related_commit as relatedCommit,position,created_at as createdAt,updated_at as updatedAt
         FROM tasks WHERE id=?`
      )
      .get(id) as TaskRow;
  }
  deleteTask(id: string) {
    return this.db.prepare("DELETE FROM tasks WHERE id=?").run(id).changes > 0;
  }
  addCheckpoint(input: {
    id?: string;
    sessionId: string;
    projectId: string;
    runId?: string | null;
    title: string;
    gitHead?: string | null;
    gitBranch?: string | null;
    gitStatus?: string | null;
    patch?: string | null;
    filesJson?: string | null;
  }) {
    const id = input.id ?? nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO checkpoints(id,session_id,project_id,run_id,title,git_head,git_branch,git_status,patch,files_json,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.sessionId,
        input.projectId,
        input.runId ?? null,
        input.title,
        input.gitHead ?? null,
        input.gitBranch ?? null,
        input.gitStatus ?? null,
        input.patch ?? null,
        input.filesJson ?? null,
        now
      );
    return this.getCheckpoint(id)!;
  }
  getCheckpoint(id: string) {
    return this.db
      .prepare(
        `SELECT id,session_id as sessionId,project_id as projectId,run_id as runId,title,git_head as gitHead,git_branch as gitBranch,git_status as gitStatus,patch,files_json as filesJson,created_at as createdAt
         FROM checkpoints WHERE id=?`
      )
      .get(id) as CheckpointRow | undefined;
  }
  listCheckpoints(sessionId: string): CheckpointRow[] {
    return this.db
      .prepare(
        `SELECT id,session_id as sessionId,project_id as projectId,run_id as runId,title,git_head as gitHead,git_branch as gitBranch,git_status as gitStatus,patch,files_json as filesJson,created_at as createdAt
         FROM checkpoints WHERE session_id=? ORDER BY created_at DESC,id DESC LIMIT 50`
      )
      .all(sessionId) as CheckpointRow[];
  }
  listRuns(options: { projectId?: string; sessionId?: string; limit?: number } = {}): RunRow[] {
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50)));
    if (options.sessionId) {
      return this.db
        .prepare(
          `SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,thread_id as threadId,status,service_instance_id as serviceInstanceId,worker_pid as workerPid,codex_pid as codexPid,worker_started_at as workerStartedAt,model,cwd,started_at as startedAt,first_response_at as firstResponseAt,ended_at as endedAt,last_seq as lastSeq,last_event_at as lastEventAt,heartbeat_at as heartbeatAt,reason,usage_json as usageJson,reconnecting_json as reconnectingJson,source_queue_id as sourceQueueId,created_at as createdAt,updated_at as updatedAt
           FROM runs WHERE session_id=? ORDER BY started_at DESC,id DESC LIMIT ?`
        )
        .all(options.sessionId, limit) as RunRow[];
    }
    if (options.projectId) {
      return this.db
        .prepare(
          `SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,thread_id as threadId,status,service_instance_id as serviceInstanceId,worker_pid as workerPid,codex_pid as codexPid,worker_started_at as workerStartedAt,model,cwd,started_at as startedAt,first_response_at as firstResponseAt,ended_at as endedAt,last_seq as lastSeq,last_event_at as lastEventAt,heartbeat_at as heartbeatAt,reason,usage_json as usageJson,reconnecting_json as reconnectingJson,source_queue_id as sourceQueueId,created_at as createdAt,updated_at as updatedAt
           FROM runs WHERE project_id=? ORDER BY started_at DESC,id DESC LIMIT ?`
        )
        .all(options.projectId, limit) as RunRow[];
    }
    return this.db
      .prepare(
        `SELECT id,session_id as sessionId,project_id as projectId,provider_id as providerId,thread_id as threadId,status,service_instance_id as serviceInstanceId,worker_pid as workerPid,codex_pid as codexPid,worker_started_at as workerStartedAt,model,cwd,started_at as startedAt,first_response_at as firstResponseAt,ended_at as endedAt,last_seq as lastSeq,last_event_at as lastEventAt,heartbeat_at as heartbeatAt,reason,usage_json as usageJson,reconnecting_json as reconnectingJson,source_queue_id as sourceQueueId,created_at as createdAt,updated_at as updatedAt
         FROM runs ORDER BY started_at DESC,id DESC LIMIT ?`
      )
      .all(limit) as RunRow[];
  }
  listProjectNotes(projectId: string): ProjectNoteRow[] {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,kind,title,content,enabled,created_at as createdAt,updated_at as updatedAt
         FROM project_notes WHERE project_id=? ORDER BY enabled DESC,updated_at DESC,title`
      )
      .all(projectId) as ProjectNoteRow[];
  }
  getProjectNote(id: string) {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,kind,title,content,enabled,created_at as createdAt,updated_at as updatedAt
         FROM project_notes WHERE id=?`
      )
      .get(id) as ProjectNoteRow | undefined;
  }
  upsertProjectNote(input: {
    id?: string | undefined;
    projectId: string;
    kind?: ProjectNoteKind | undefined;
    title: string;
    content: string;
    enabled?: boolean | undefined;
  }) {
    const existing = input.id ? this.getProjectNote(input.id) : undefined;
    const id = existing?.id ?? input.id ?? nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO project_notes(id,project_id,kind,title,content,enabled,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,content=excluded.content,enabled=excluded.enabled,updated_at=excluded.updated_at`
      )
      .run(
        id,
        input.projectId,
        input.kind ?? existing?.kind ?? "note",
        input.title,
        input.content,
        input.enabled === undefined ? (existing?.enabled ?? 1) : Number(input.enabled),
        existing?.createdAt ?? now,
        now
      );
    return this.getProjectNote(id)!;
  }
  deleteProjectNote(id: string) {
    return this.db.prepare("DELETE FROM project_notes WHERE id=?").run(id).changes > 0;
  }
  addOperationEvent(input: {
    id?: string;
    projectId: string;
    sessionId?: string | null;
    kind: string;
    title: string;
    detailJson?: string | null;
    undoJson?: string | null;
  }) {
    const id = input.id ?? nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO operation_events(id,project_id,session_id,kind,title,detail_json,undo_json,created_at)
         VALUES(?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.projectId,
        input.sessionId ?? null,
        input.kind,
        input.title,
        input.detailJson ?? null,
        input.undoJson ?? null,
        now
      );
    return this.getOperationEvent(id)!;
  }
  getOperationEvent(id: string) {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,session_id as sessionId,kind,title,detail_json as detailJson,undo_json as undoJson,created_at as createdAt
         FROM operation_events WHERE id=?`
      )
      .get(id) as OperationEventRow | undefined;
  }
  listOperationEvents(projectId: string, limit = 80): OperationEventRow[] {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,session_id as sessionId,kind,title,detail_json as detailJson,undo_json as undoJson,created_at as createdAt
         FROM operation_events WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT ?`
      )
      .all(projectId, Math.max(1, Math.min(200, Math.trunc(limit)))) as OperationEventRow[];
  }
  listScheduledJobs(projectId?: string): ScheduledJobRow[] {
    const sql = `SELECT id,project_id as projectId,session_id as sessionId,title,prompt,cadence,interval_minutes as intervalMinutes,daily_at as dailyAt,enabled,last_run_at as lastRunAt,next_run_at as nextRunAt,created_at as createdAt,updated_at as updatedAt
         FROM scheduled_jobs ${projectId ? "WHERE project_id=?" : ""} ORDER BY enabled DESC,next_run_at,title`;
    return (
      projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()
    ) as ScheduledJobRow[];
  }
  getScheduledJob(id: string) {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,session_id as sessionId,title,prompt,cadence,interval_minutes as intervalMinutes,daily_at as dailyAt,enabled,last_run_at as lastRunAt,next_run_at as nextRunAt,created_at as createdAt,updated_at as updatedAt
         FROM scheduled_jobs WHERE id=?`
      )
      .get(id) as ScheduledJobRow | undefined;
  }
  upsertScheduledJob(input: {
    id?: string | undefined;
    projectId: string;
    sessionId?: string | null | undefined;
    title: string;
    prompt: string;
    cadence: "interval" | "daily";
    intervalMinutes?: number | null | undefined;
    dailyAt?: string | null | undefined;
    enabled?: boolean | number | undefined;
    lastRunAt?: number | null | undefined;
    nextRunAt: number;
  }) {
    const existing = input.id ? this.getScheduledJob(input.id) : undefined;
    const id = existing?.id ?? input.id ?? nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO scheduled_jobs(id,project_id,session_id,title,prompt,cadence,interval_minutes,daily_at,enabled,last_run_at,next_run_at,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,title=excluded.title,prompt=excluded.prompt,cadence=excluded.cadence,interval_minutes=excluded.interval_minutes,daily_at=excluded.daily_at,enabled=excluded.enabled,last_run_at=excluded.last_run_at,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at`
      )
      .run(
        id,
        input.projectId,
        input.sessionId ?? existing?.sessionId ?? null,
        input.title,
        input.prompt,
        input.cadence,
        input.intervalMinutes ?? existing?.intervalMinutes ?? null,
        input.dailyAt ?? existing?.dailyAt ?? null,
        input.enabled === undefined ? (existing?.enabled ?? 1) : Number(input.enabled),
        input.lastRunAt === undefined ? (existing?.lastRunAt ?? null) : input.lastRunAt,
        input.nextRunAt,
        existing?.createdAt ?? now,
        now
      );
    return this.getScheduledJob(id)!;
  }
  deleteScheduledJob(id: string) {
    return this.db.prepare("DELETE FROM scheduled_jobs WHERE id=?").run(id).changes > 0;
  }
  listSessionStars(sessionId: string) {
    return (
      this.db
        .prepare(
          "SELECT message_id as messageId FROM message_stars WHERE session_id=? ORDER BY created_at DESC"
        )
        .all(sessionId) as Array<{ messageId: string }>
    ).map((row) => row.messageId);
  }
  setMessageStarred(messageId: string, starred: boolean) {
    const message = this.db
      .prepare("SELECT id, session_id as sessionId FROM messages WHERE id=?")
      .get(messageId) as { id: string; sessionId: string } | undefined;
    if (!message) return null;
    if (starred) {
      this.db
        .prepare(
          "INSERT INTO message_stars(message_id,session_id,created_at) VALUES(?,?,?) ON CONFLICT(message_id) DO NOTHING"
        )
        .run(message.id, message.sessionId, Date.now());
    } else {
      this.db.prepare("DELETE FROM message_stars WHERE message_id=?").run(message.id);
    }
    return { messageId: message.id, sessionId: message.sessionId, starred };
  }
  dueScheduledJobs(now = Date.now()): ScheduledJobRow[] {
    return this.db
      .prepare(
        `SELECT id,project_id as projectId,session_id as sessionId,title,prompt,cadence,interval_minutes as intervalMinutes,daily_at as dailyAt,enabled,last_run_at as lastRunAt,next_run_at as nextRunAt,created_at as createdAt,updated_at as updatedAt
         FROM scheduled_jobs WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at,id LIMIT 20`
      )
      .all(now) as ScheduledJobRow[];
  }
}

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
}

function ftsMatchQuery(query: string) {
  const cleaned = query.trim().replace(/["']/g, " ").replace(/\s+/g, " ");
  if (cleaned.length < 3) return null;
  return `"${cleaned.replaceAll('"', '""')}"`;
}

function makeSnippet(content: string, query: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const index = compact.toLowerCase().indexOf(query.trim().toLowerCase());
  if (index < 0) return compact.slice(0, 140);
  const start = Math.max(0, index - 36);
  const end = Math.min(compact.length, index + query.trim().length + 48);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}
