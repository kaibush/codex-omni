import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./index.js";
import {
  removeLegacyGeneratedContextDefaults,
  setProviderStreamIdleTimeout
} from "./provider-context-migration.js";

const legacy =
  'model = "custom-small"\nmodel_provider = "custom"\n\nmodel_context_window = 256000\n\nmodel_auto_compact_token_limit = 230400\n\n[model_providers.custom]\nname = "Custom"\nbase_url = "https://example.test/v1"\nwire_api = "chat"\n';
let dir: string | undefined;
let store: Store | undefined;
afterEach(() => {
  store?.db.close();
  store = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("provider context migration", () => {
  it("only strips the exact legacy generated root pair and preserves other sections", () => {
    const source = legacy + '\n[mcp_servers.local]\ncommand = "fixture"\n';
    const cleaned = removeLegacyGeneratedContextDefaults(source);
    expect(cleaned).not.toContain("model_context_window");
    expect(cleaned).not.toContain("model_auto_compact_token_limit");
    expect(cleaned.slice(cleaned.indexOf("[model_providers"))).toBe(
      source.slice(source.indexOf("[model_providers"))
    );
    for (const edited of [
      legacy.replace("256000", "32000"),
      legacy.replace("230400", "16000"),
      'service_tier = "fast"\n' + legacy,
      "# hand-written\n" + legacy,
      "[profiles.custom]\n" + legacy
    ])
      expect(removeLegacyGeneratedContextDefaults(edited)).toBe(edited);
  });

  it("migrates only old API-key templates once while preserving manual/native homes", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "omni-provider-migration-"));
    const file = path.join(dir, "store.db");
    store = new Store(file);
    const apiKey = store.upsertProvider({
      name: "Generated",
      homeMode: "api-key",
      configToml: legacy
    });
    const manual = store.upsertProvider({
      name: "Manual",
      homeMode: "managed",
      configToml: legacy
    });
    const native = store.upsertProvider({
      name: "Native",
      homeMode: "native",
      configToml: legacy
    });
    store.db.exec(
      "ALTER TABLE providers DROP COLUMN context_window; ALTER TABLE providers DROP COLUMN auto_compact_token_limit;"
    );
    store.db.close();
    store = new Store(file);
    expect(store.getProvider(apiKey.id)?.configToml).not.toContain("model_context_window");
    expect(store.getProvider(apiKey.id)?.configToml).toContain('wire_api = "responses"');
    expect(store.getProvider(apiKey.id)?.contextWindow).toBeNull();
    expect(store.getProvider(manual.id)?.configToml).toContain("stream_idle_timeout_ms = 600000");
    expect(store.getProvider(native.id)?.configToml).toBe(legacy);
    store.upsertProvider({
      ...store.getProvider(apiKey.id)!,
      configToml: setProviderStreamIdleTimeout(legacy),
      contextWindow: 32000,
      autoCompactTokenLimit: 28000
    });
    store.db.close();
    store = new Store(file);
    expect(store.getProvider(apiKey.id)).toMatchObject({
      configToml: setProviderStreamIdleTimeout(legacy),
      contextWindow: 32000,
      autoCompactTokenLimit: 28000
    });
  });
});

describe("provider stream idle timeout", () => {
  it("sets every direct provider table and leaves nested sections untouched", () => {
    const source =
      'model_provider = "first"\n[model_providers.first]\nstream_idle_timeout_ms = 300000\n[model_providers.first.http_headers]\nstream_idle_timeout_ms = 123\n[model_providers."second.provider"]\nname = "Second"\n[mcp_servers.local]\ncommand = "fixture"\n';
    const updated = setProviderStreamIdleTimeout(source);
    expect(updated).toContain("[model_providers.first]\nstream_idle_timeout_ms = 600000");
    expect(updated).toContain("[model_providers.first.http_headers]\nstream_idle_timeout_ms = 123");
    expect(updated).toContain(
      '[model_providers."second.provider"]\nstream_idle_timeout_ms = 600000\nname = "Second"'
    );
    expect(setProviderStreamIdleTimeout(updated)).toBe(updated);
    expect(setProviderStreamIdleTimeout('model_provider = "openai"\n')).toBe(
      'model_provider = "openai"\n'
    );
  });

  it("migrates managed and API-key homes but preserves native homes", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "omni-provider-timeout-"));
    const file = path.join(dir, "store.db");
    store = new Store(file);
    const configToml =
      'model_provider = "custom"\n[model_providers.custom]\nstream_idle_timeout_ms = 300000\n';
    const managed = store.upsertProvider({
      name: "Managed",
      homeMode: "managed",
      configToml
    });
    const apiKey = store.upsertProvider({
      name: "API Key",
      homeMode: "api-key",
      configToml
    });
    const native = store.upsertProvider({
      name: "Native",
      homeMode: "native",
      configToml
    });
    store.db.close();
    store = new Store(file);
    expect(store.getProvider(managed.id)?.configToml).toContain("stream_idle_timeout_ms = 600000");
    expect(store.getProvider(apiKey.id)?.configToml).toContain("stream_idle_timeout_ms = 600000");
    expect(store.getProvider(native.id)?.configToml).toBe(configToml);
  });
});
