import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrateThreadModelProvider,
  nativeCodexConfig,
  threadModelProvider
} from "./thread-provider.js";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function fixture() {
  const home = mkdtempSync(path.join(os.tmpdir(), "omni-thread-provider-"));
  homes.push(home);
  const threadId = "01a19f51-2e2c-7cd1-8a7f-6ad9727ac6b2";
  const dir = path.join(home, "sessions", "2026", "11", "03");
  mkdirSync(dir, { recursive: true });
  const rollout = path.join(dir, `rollout-2026-11-03T02-51-00-${threadId}.jsonl`);
  writeFileSync(
    rollout,
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: threadId,
        model_provider: "omni_original_run",
        instructions: "x".repeat(32_000)
      }
    }) + "\n"
  );
  return { home, threadId, rollout };
}

function state(file: string, threadId: string, provider: string) {
  const db = new Database(file);
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT NOT NULL)");
  db.prepare("INSERT INTO threads VALUES (?, ?)").run(threadId, provider);
  db.close();
}

describe("native thread provider identity", () => {
  it("recovers legacy provider names without changing history or native state", () => {
    const { home, threadId } = fixture();
    expect(threadModelProvider(home, undefined, {})).toBeUndefined();
    expect(threadModelProvider(home, threadId, {})).toBe("omni_original_run");
    state(path.join(home, "state_5.sqlite"), threadId, "omni_latest_run");
    expect(threadModelProvider(home, threadId, {})).toBe("omni_latest_run");
    state(path.join(home, "state_10.sqlite"), threadId, "omni_migrated_run");
    expect(threadModelProvider(home, threadId, {})).toBe("omni_migrated_run");
  });

  it("respects the client's separate SQLite directory", () => {
    const { home, threadId } = fixture();
    const sqliteHome = path.join(home, "database");
    mkdirSync(sqliteHome);
    writeFileSync(path.join(home, "config.toml"), 'sqlite_home = "database"\n');
    state(path.join(sqliteHome, "state_5.sqlite"), threadId, "omni_external_state");
    expect(threadModelProvider(home, threadId, nativeCodexConfig(home))).toBe(
      "omni_external_state"
    );
  });

  it("changes only the selected thread's provider and refuses stale updates", () => {
    const { home, threadId, rollout } = fixture();
    const original = readFileSync(rollout, "utf8");
    const file = path.join(home, "state_5.sqlite");
    state(file, threadId, "custom");
    const db = new Database(file);
    try {
      db.exec("ALTER TABLE threads ADD COLUMN title TEXT DEFAULT 'saved title'");
      db.prepare("INSERT INTO threads (id, model_provider) VALUES (?, ?)").run(
        "other",
        "other-provider"
      );
      expect(() => migrateThreadModelProvider(home, threadId, {}, "stale", "omni_session")).toThrow(
        "无法更新 Codex 会话的供应商标识"
      );
      expect(threadModelProvider(home, threadId, {})).toBe("custom");
      migrateThreadModelProvider(home, threadId, {}, "custom", "omni_session");
      expect(db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId)).toEqual({
        id: threadId,
        model_provider: "omni_session",
        title: "saved title"
      });
      expect(threadModelProvider(home, "other", {})).toBe("other-provider");
      expect(readFileSync(rollout, "utf8")).toBe(original);
      expect(() => migrateThreadModelProvider(home, threadId, {}, "custom", "another")).toThrow(
        "无法更新 Codex 会话的供应商标识"
      );
    } finally {
      db.close();
    }
  });

  it("reports malformed native configuration without exposing its contents", () => {
    const { home } = fixture();
    writeFileSync(path.join(home, "config.toml"), "api_key = = secret-value");
    expect(() => nativeCodexConfig(home)).toThrow("无法读取客户端 config.toml");
    expect(() => nativeCodexConfig(home)).not.toThrow("secret-value");
  });
});
