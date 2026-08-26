/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  localDateKey,
  requestSystemUpdateCheck,
  SYSTEM_UPDATE_DISMISS_KEY,
  SYSTEM_UPDATE_PREVIEW_EVENT,
  type SystemVersionInfo
} from "@/lib/system-update";
import { SystemUpdateDialog } from "./SystemUpdateDialog";

const update: SystemVersionInfo = {
  status: "update_available",
  updateAvailable: true,
  currentVersion: "v1.0.0",
  latestVersion: "v1.1.0",
  releaseUrl: "https://github.com/kaibush/codex-omni/releases/tag/v1.1.0",
  releaseNotes: "## What's Changed\n\nRelease notes",
  publishedAt: "2026-08-14T00:00:00Z",
  checkedAt: "2026-08-14T08:00:00+08:00",
  error: ""
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function mockVersion(info: SystemVersionInfo, checkInfo?: SystemVersionInfo) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/system/update/check")) {
        if (!checkInfo) throw new Error(`unexpected fetch ${url}`);
        expect(init?.method).toBe("POST");
        return jsonResponse(checkInfo);
      }
      if (url.includes("/api/system/version")) return jsonResponse(info);
      throw new Error(`unexpected fetch ${url}`);
    })
  );
}

async function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <SystemUpdateDialog />
    </QueryClientProvider>
  );
}

function dialogText() {
  return document.body.textContent ?? "";
}

function findButton(name: string) {
  return Array.from(document.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(name)
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockVersion(update);
});

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SystemUpdateDialog", () => {
  it("shows a newer GitHub Release and can be dismissed for today", async () => {
    await renderDialog();

    await vi.waitFor(() => {
      expect(dialogText()).toContain("发现 Codex Omni 新版本");
      expect(dialogText()).toContain("v1.1.0");
      expect(dialogText()).toContain("What's Changed");
      expect(dialogText()).toContain("Release notes");
      expect(document.body.querySelector(".markdown h2")).toBeTruthy();
    });

    const dismiss = findButton("今日不再提醒");
    expect(dismiss).toBeTruthy();
    dismiss?.click();

    expect(window.localStorage.getItem(SYSTEM_UPDATE_DISMISS_KEY)).toBe(
      JSON.stringify({ version: "v1.1.0", date: localDateKey() })
    );
    await vi.waitFor(() => {
      expect(dialogText()).not.toContain("发现 Codex Omni 新版本");
    });
  });

  it("keeps a same-day dismissal closed after remounting", async () => {
    window.localStorage.setItem(
      SYSTEM_UPDATE_DISMISS_KEY,
      JSON.stringify({ version: "v1.1.0", date: localDateKey() })
    );
    await renderDialog();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(dialogText()).not.toContain("发现 Codex Omni 新版本");
  });

  it("shows the same version again on the next day", async () => {
    window.localStorage.setItem(
      SYSTEM_UPDATE_DISMISS_KEY,
      JSON.stringify({ version: "v1.1.0", date: "1999-01-01" })
    );
    await renderDialog();

    await vi.waitFor(() => {
      expect(dialogText()).toContain("发现 Codex Omni 新版本");
    });
  });

  it("shows a development-only preview without dismissing a real version", async () => {
    mockVersion({
      ...update,
      status: "up_to_date",
      updateAvailable: false,
      latestVersion: "v1.0.0"
    });
    await renderDialog();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    window.dispatchEvent(new CustomEvent(SYSTEM_UPDATE_PREVIEW_EVENT, { detail: update }));

    await vi.waitFor(() => {
      expect(dialogText()).toContain("开发预览");
    });

    const closePreview = findButton("关闭预览");
    expect(closePreview).toBeTruthy();
    closePreview?.click();

    expect(window.localStorage.getItem(SYSTEM_UPDATE_DISMISS_KEY)).toBeNull();
    await vi.waitFor(() => {
      expect(dialogText()).not.toContain("开发预览");
    });
  });

  it("checks immediately on request and shows an update even if dismissed today", async () => {
    window.localStorage.setItem(
      SYSTEM_UPDATE_DISMISS_KEY,
      JSON.stringify({ version: "v1.1.0", date: localDateKey() })
    );
    mockVersion(
      { ...update, status: "up_to_date", updateAvailable: false, latestVersion: "v1.0.0" },
      update
    );
    await renderDialog();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(dialogText()).not.toContain("发现 Codex Omni 新版本");

    requestSystemUpdateCheck();

    await vi.waitFor(() => {
      expect(dialogText()).toContain("发现 Codex Omni 新版本");
      expect(dialogText()).toContain("v1.1.0");
    });
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/api/system/update/check"))).toBe(
      true
    );
  });

  it("shows the current version when an immediate check finds no update", async () => {
    const current = {
      ...update,
      status: "up_to_date" as const,
      updateAvailable: false,
      latestVersion: "v1.0.0",
      releaseNotes: ""
    };
    mockVersion(current, current);
    await renderDialog();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(dialogText()).not.toContain("已是最新版本");

    requestSystemUpdateCheck();

    await vi.waitFor(() => {
      expect(dialogText()).toContain("已是最新版本");
      expect(dialogText()).toContain("v1.0.0");
    });
  });
});
