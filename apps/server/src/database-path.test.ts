import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDatabasePath } from "./database-path.js";

describe("resolveDatabasePath", () => {
  it("uses CODEX_OMNI_DATABASE when set", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-omni-db-"));
    const configured = path.join(dir, "custom.db");
    expect(resolveDatabasePath(dir, { CODEX_OMNI_DATABASE: configured })).toBe(configured);
  });

  it("falls back to the legacy default file when the new one is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-omni-db-"));
    mkdirSync(path.join(dir, "data"));
    const legacy = path.join(dir, "data/codex-web.db");
    writeFileSync(legacy, "");
    expect(resolveDatabasePath(dir, {})).toBe(legacy);
  });

  it("uses the new default when neither file exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-omni-db-"));
    expect(resolveDatabasePath(dir, {})).toBe(path.join(dir, "data/codex-omni.db"));
  });
});
