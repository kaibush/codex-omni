import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.CODEX_OMNI_E2E_API_PORT ?? 8799);
const webPort = Number(process.env.CODEX_OMNI_E2E_WEB_PORT ?? 5179);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const database = process.env.CODEX_OMNI_E2E_DATABASE ?? "/tmp/codex-omni-e2e.db";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: webUrl,
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: `CODEX_OMNI_HOST=127.0.0.1 CODEX_OMNI_PORT=${apiPort} CODEX_OMNI_DATABASE=${database} CODEX_OMNI_ORIGIN=${webUrl} CODEX_OMNI_FAKE_RUNTIME=1 pnpm --filter @codex-omni/server dev:stable`,
      url: `${apiUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `CODEX_OMNI_WEB_PORT=${webPort} CODEX_OMNI_API_URL=${apiUrl} pnpm --filter @codex-omni/web dev`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
