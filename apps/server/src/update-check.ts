import { currentAppVersion, normalizeVersion } from "./app-version.js";

export const DEFAULT_GITHUB_REPO = "kaibush/codex-omni";
export const UPDATE_CHECK_INTERVAL_SECONDS = 60 * 60;
export const UPDATE_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024;
export const MAX_RELEASE_NOTES_CHARS = 4096;

const SEMVER_PATTERN =
  /^[vV]?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const HOTFIX_PATTERN = /^hotfix[.-](?<number>\d+)$/i;

export type UpdateCheckStatus =
  "idle" | "checking" | "update_available" | "up_to_date" | "no_release" | "error";

export type UpdateCheckSnapshot = {
  status: UpdateCheckStatus;
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  checkedAt: string;
  error: string;
};

export type GitHubReleasePayload = Record<string, unknown>;
export type ReleaseFetcher = () => Promise<GitHubReleasePayload>;

export class ReleaseNotPublishedError extends Error {
  constructor(message = "GitHub 尚未发布 Release") {
    super(message);
    this.name = "ReleaseNotPublishedError";
  }
}

export class ReleaseVersion {
  constructor(
    readonly major: number,
    readonly minor: number,
    readonly patch: number,
    readonly prerelease: readonly string[] = [],
    readonly hotfix: number | null = null
  ) {}

  static parse(value: string) {
    const match = SEMVER_PATTERN.exec(String(value ?? "").trim());
    if (!match?.groups) {
      throw new Error(`版本号格式无效：${value || "空值"}`);
    }
    const prereleaseText = match.groups.prerelease ?? "";
    const hotfixMatch = HOTFIX_PATTERN.exec(prereleaseText);
    return new ReleaseVersion(
      Number(match.groups.major),
      Number(match.groups.minor),
      Number(match.groups.patch),
      prereleaseText ? prereleaseText.split(".") : [],
      hotfixMatch?.groups?.number == null ? null : Number(hotfixMatch.groups.number)
    );
  }

  compare(other: ReleaseVersion) {
    if (this.major !== other.major) return this.major < other.major ? -1 : 1;
    if (this.minor !== other.minor) return this.minor < other.minor ? -1 : 1;
    if (this.patch !== other.patch) return this.patch < other.patch ? -1 : 1;
    if (this.hotfix !== null || other.hotfix !== null) {
      const left = this.hotfixRank();
      const right = other.hotfixRank();
      if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
      if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
      return 0;
    }
    const leftPre = this.prerelease.length > 0;
    const rightPre = other.prerelease.length > 0;
    if (!leftPre || !rightPre) {
      if (leftPre === rightPre) return 0;
      return leftPre ? -1 : 1;
    }
    if (prereleaseIsLower(this.prerelease, other.prerelease)) return -1;
    if (prereleaseIsLower(other.prerelease, this.prerelease)) return 1;
    return 0;
  }

  private hotfixRank(): [number, number] {
    if (this.hotfix !== null) return [2, this.hotfix];
    if (this.prerelease.length === 0) return [1, 0];
    return [0, 0];
  }
}

function prereleaseIsLower(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? "";
    const rightValue = right[index] ?? "";
    if (leftValue === rightValue) continue;
    const leftNumeric = /^\d+$/.test(leftValue);
    const rightNumeric = /^\d+$/.test(rightValue);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftValue);
      const rightNumber = Number(rightValue);
      if (leftNumber !== rightNumber) return leftNumber < rightNumber;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric;
    return leftValue.toLowerCase() < rightValue.toLowerCase();
  }
  return left.length < right.length;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

export class UpdateCheckService {
  readonly currentVersion: string;
  readonly githubRepo: string;
  private readonly intervalMs: number;
  private readonly fetchLatest: ReleaseFetcher;
  private state: UpdateCheckSnapshot;
  private inflight: Promise<UpdateCheckSnapshot> | undefined = undefined;
  private loop: Promise<void> | undefined = undefined;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  private sleepResolve: (() => void) | undefined = undefined;

  constructor(
    options: {
      installedVersion?: string;
      intervalSeconds?: number;
      fetchLatest?: ReleaseFetcher;
      githubRepo?: string;
      env?: NodeJS.Dict<string>;
    } = {}
  ) {
    const env = options.env ?? process.env;
    this.currentVersion =
      normalizeVersion(options.installedVersion ?? "") || currentAppVersion(env);
    const interval = Number(options.intervalSeconds ?? UPDATE_CHECK_INTERVAL_SECONDS);
    this.intervalMs =
      Math.max(1, Number.isFinite(interval) ? interval : UPDATE_CHECK_INTERVAL_SECONDS) * 1000;
    this.githubRepo =
      (options.githubRepo ?? env.CODEX_OMNI_GITHUB_REPO)?.trim() || DEFAULT_GITHUB_REPO;
    this.fetchLatest = options.fetchLatest ?? (() => this.fetchGithubRelease());
    this.state = this.initialState();
  }

  private releasesUrl() {
    return `https://github.com/${this.githubRepo}/releases`;
  }

  private latestReleaseApi() {
    return `https://api.github.com/repos/${this.githubRepo}/releases/latest`;
  }

  private initialState(): UpdateCheckSnapshot {
    return {
      status: "idle",
      updateAvailable: false,
      currentVersion: this.currentVersion,
      latestVersion: "",
      releaseUrl: this.releasesUrl(),
      releaseNotes: "",
      publishedAt: "",
      checkedAt: "",
      error: ""
    };
  }

  snapshot() {
    return { ...this.state };
  }

  start() {
    if (this.loop) return;
    this.stopped = false;
    this.loop = this.runLoop().finally(() => {
      this.loop = undefined;
    });
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const resolve = this.sleepResolve;
    this.sleepResolve = undefined;
    resolve?.();
    if (this.loop) await this.loop;
  }

  check(): Promise<UpdateCheckSnapshot> {
    if (this.inflight) return this.inflight;
    this.state = { ...this.state, status: "checking", error: "" };
    const pending = this.checkOnce().finally(() => {
      if (this.inflight === pending) this.inflight = undefined;
    });
    this.inflight = pending;
    return pending;
  }

  private async runLoop() {
    while (!this.stopped) {
      await this.check();
      if (this.stopped) break;
      await this.sleep(this.intervalMs);
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      this.sleepResolve = resolve;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.sleepResolve = undefined;
        resolve();
      }, ms);
      this.timer.unref();
    });
  }

  private async checkOnce(): Promise<UpdateCheckSnapshot> {
    const checkedAt = new Date().toISOString();
    try {
      const release = await this.fetchLatest();
      const latestVersion = String(release.tag_name ?? "").trim();
      const current = ReleaseVersion.parse(this.currentVersion);
      const latest = ReleaseVersion.parse(latestVersion);
      const updateAvailable = latest.compare(current) > 0;
      this.state = {
        status: updateAvailable ? "update_available" : "up_to_date",
        updateAvailable,
        currentVersion: this.currentVersion,
        latestVersion,
        releaseUrl: String(release.html_url ?? "") || this.releasesUrl(),
        releaseNotes: String(release.body ?? "").slice(0, MAX_RELEASE_NOTES_CHARS),
        publishedAt: String(release.published_at ?? ""),
        checkedAt,
        error: ""
      };
    } catch (error) {
      if (error instanceof ReleaseNotPublishedError) {
        this.state = {
          ...this.initialState(),
          status: "no_release",
          checkedAt
        };
      } else {
        console.warn(`codex-omni update check failed: ${errorMessage(error)}`);
        this.state = {
          ...this.state,
          status: "error",
          currentVersion: this.currentVersion,
          checkedAt,
          error: errorMessage(error)
        };
      }
    }
    return this.snapshot();
  }

  private async fetchGithubRelease(): Promise<GitHubReleasePayload> {
    const response = await fetch(this.latestReleaseApi(), {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `CodexOmni/${this.currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS)
    });
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.byteLength > MAX_RELEASE_RESPONSE_BYTES) {
      throw new Error("GitHub Release 响应超过 1 MiB 限制");
    }
    if (response.status === 404) {
      throw new ReleaseNotPublishedError("GitHub 尚未发布 Release");
    }
    if (response.status >= 300) {
      const detail = raw.toString("utf8").trim().slice(0, 1000);
      throw new Error(`GitHub Releases 返回 HTTP ${response.status}：${detail || "空响应"}`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8")) as unknown;
    } catch {
      throw new Error("GitHub Release 响应不是有效 JSON");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("GitHub Release 响应缺少 tag_name");
    }
    const release = payload as GitHubReleasePayload;
    if (!String(release.tag_name ?? "").trim()) {
      throw new Error("GitHub Release 响应缺少 tag_name");
    }
    return release;
  }
}
