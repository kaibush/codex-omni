import { rmSync } from "node:fs";

export default function globalSetup() {
  const database = process.env.CODEX_OMNI_E2E_DATABASE ?? "/tmp/codex-omni-e2e.db";
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${database}${suffix}`);
    } catch {
      // Fresh runs should not fail if the temp database does not exist yet.
    }
  }
}
