import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RELEASE_NOTES_CHARS,
  ReleaseNotPublishedError,
  ReleaseVersion,
  UpdateCheckService
} from "./update-check.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ReleaseVersion", () => {
  it.each([
    ["v1.0.0", "v1.0.1"],
    ["v1.9.9", "v2.0.0"],
    ["v1.0.0-beta.1", "v1.0.0-beta.2"],
    ["v1.0.0-beta.2", "v1.0.0"],
    ["v1.0.0", "v1.0.0-hotfix.1"],
    ["v1.0.0-hotfix.1", "v1.0.0-hotfix.2"]
  ] as const)("orders %s before %s", (older, newer) => {
    expect(ReleaseVersion.parse(newer).compare(ReleaseVersion.parse(older))).toBeGreaterThan(0);
  });
});

describe("UpdateCheckService", () => {
  it("reports a newer release and truncates notes", async () => {
    const service = new UpdateCheckService({
      installedVersion: "v1.0.0",
      fetchLatest: async () => ({
        tag_name: "v1.1.0",
        html_url: "https://github.com/kaibush/codex-omni/releases/tag/v1.1.0",
        body: "x".repeat(MAX_RELEASE_NOTES_CHARS + 100),
        published_at: "2026-08-14T00:00:00Z"
      })
    });

    const result = await service.check();

    expect(result.status).toBe("update_available");
    expect(result.updateAvailable).toBe(true);
    expect(result.currentVersion).toBe("v1.0.0");
    expect(result.latestVersion).toBe("v1.1.0");
    expect(result.releaseNotes).toHaveLength(MAX_RELEASE_NOTES_CHARS);
    expect(result.checkedAt).toBeTruthy();
  });

  it("merges concurrent checks into one fetch", async () => {
    let calls = 0;
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });

    const service = new UpdateCheckService({
      installedVersion: "v1.0.0",
      fetchLatest: async () => {
        calls += 1;
        fetchStarted();
        await ready;
        return { tag_name: "v1.0.0", body: "" };
      }
    });

    const first = service.check();
    await started;
    const second = service.check();
    releaseReady();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult.status).toBe("up_to_date");
  });

  it("keeps errors in memory", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = new UpdateCheckService({
      installedVersion: "v1.0.0",
      fetchLatest: async () => {
        throw new Error("github unavailable");
      }
    });

    try {
      const result = await service.check();
      expect(result.status).toBe("error");
      expect(result.updateAvailable).toBe(false);
      expect(result.error).toBe("github unavailable");
    } finally {
      warn.mockRestore();
    }
  });

  it("reports a missing release without an error", async () => {
    const service = new UpdateCheckService({
      installedVersion: "v1.0.0",
      fetchLatest: async () => {
        throw new ReleaseNotPublishedError("GitHub 尚未发布 Release");
      }
    });

    const result = await service.check();

    expect(result.status).toBe("no_release");
    expect(result.updateAvailable).toBe(false);
    expect(result.error).toBe("");
  });

  it("runs an immediate check on start and stops the loop", async () => {
    let calls = 0;
    const service = new UpdateCheckService({
      installedVersion: "v1.0.0",
      intervalSeconds: 60,
      fetchLatest: async () => {
        calls += 1;
        return { tag_name: "v1.0.0" };
      }
    });
    service.start();
    expect(calls).toBe(1);
    await service.stop();
    expect(calls).toBe(1);
  });

  it("maps GitHub 404 to no_release", async () => {
    globalThis.fetch = (async () => new Response("Not Found", { status: 404 })) as typeof fetch;
    const service = new UpdateCheckService({
      installedVersion: "v1.0.0",
      env: { CODEX_OMNI_GITHUB_REPO: "acme/widgets" }
    });

    const result = await service.check();

    expect(result.status).toBe("no_release");
    expect(result.updateAvailable).toBe(false);
    expect(result.error).toBe("");
    expect(result.releaseUrl).toBe("https://github.com/acme/widgets/releases");
  });

  it("fetches the configured GitHub latest release", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(
        JSON.stringify({
          tag_name: "v1.2.0",
          html_url: "https://github.com/acme/widgets/releases/tag/v1.2.0",
          body: "notes",
          published_at: "2026-08-14T00:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const service = new UpdateCheckService({
      installedVersion: "v1.0.0",
      env: { CODEX_OMNI_GITHUB_REPO: "acme/widgets" }
    });
    const result = await service.check();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.github.com/repos/acme/widgets/releases/latest");
    expect(calls[0]?.headers.get("User-Agent")).toBe("CodexOmni/v1.0.0");
    expect(calls[0]?.headers.get("Accept")).toBe("application/vnd.github+json");
    expect(calls[0]?.headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(result.status).toBe("update_available");
    expect(result.latestVersion).toBe("v1.2.0");
  });
});
