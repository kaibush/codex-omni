import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

let directory: string | undefined;
let child: ChildProcess | undefined;

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      child!.once("close", () => resolve());
      child!.kill("SIGTERM");
    });
  }
  child = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("login rate limit", () => {
  it("stops password attempts before another Argon2 check", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "omni-login-limit-"));
    const offline = path.join(directory, "offline.mjs");
    await writeFile(
      offline,
      "globalThis.fetch = async () => new Response('{}', { status: 404 });\n"
    );
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(offline).href,
        "--import",
        pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
        fileURLToPath(new URL("./index.ts", import.meta.url))
      ],
      {
        cwd: directory,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEX_OMNI_HOST: "127.0.0.1",
          CODEX_OMNI_PORT: "0",
          CODEX_OMNI_DATABASE: path.join(directory, "test.db"),
          CODEX_OMNI_FAKE_RUNTIME: "1",
          CODEX_OMNI_INSTANCE: "login-limit-test",
          CODEX_HOME: path.join(directory, "home")
        }
      }
    );
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(
        () => reject(new Error(`Server startup timeout: ${output}`)),
        10_000
      );
      child!.once("error", reject);
      child!.once("exit", () => reject(new Error(`Server exited: ${output}`)));
      for (const stream of [child!.stdout!, child!.stderr!]) {
        stream.on("data", (chunk) => {
          output = (output + String(chunk)).slice(-12000);
          const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:[1-9]\d*)/);
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]!);
          }
        });
      }
    });
    const login = (body: unknown, headers?: Record<string, string>) =>
      fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body)
      });
    const setup = await fetch(`${baseUrl}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "fixture-password-123" })
    });
    expect(setup.status).toBe(200);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const failed = await login({ username: "admin", password: `wrong-${attempt}` });
      expect(failed.status).toBe(401);
    }
    const started = Date.now();
    const blocked = await login({ username: "admin", password: "fixture-password-123" });
    const body = (await blocked.json()) as { error?: string };
    expect(blocked.status).toBe(429);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(body.error).toMatch(/尝试次数过多/);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    const sameAccount = await login(
      { username: "admin", password: "wrong-again" },
      { "x-forwarded-for": "203.0.113.50" }
    );
    expect(sameAccount.status).toBe(401);
    const lockedIp = await login({ username: "other-user", password: "wrong-again" });
    expect(lockedIp.status).toBe(429);
  }, 40_000);
});
