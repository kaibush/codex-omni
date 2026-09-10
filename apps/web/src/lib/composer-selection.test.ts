/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_MODELS_KEY,
  COMPOSER_PROVIDER_KEY,
  fallbackProviderId,
  isUnstartedComposerSession,
  loadComposerModels,
  loadComposerProviderId,
  persistComposerModel,
  persistComposerProviderId,
  resolveComposerModel,
  resolveComposerProviderId,
  shouldHydrateComposerProvider
} from "./composer-selection";

const providers = [{ id: "openai-default", isDefault: true }, { id: "grok-provider" }];

afterEach(() => {
  localStorage.clear();
});

describe("composer provider persistence", () => {
  it("round-trips the last used provider and per-provider models", () => {
    persistComposerProviderId(" grok-provider ");
    persistComposerModel("grok-provider", "grok-4.6");
    persistComposerModel("openai-default", "gpt-5");
    expect(loadComposerProviderId()).toBe("grok-provider");
    expect(loadComposerModels()).toEqual({
      "grok-provider": "grok-4.6",
      "openai-default": "gpt-5"
    });
    expect(localStorage.getItem(COMPOSER_PROVIDER_KEY)).toBe("grok-provider");
    expect(JSON.parse(localStorage.getItem(COMPOSER_MODELS_KEY) ?? "{}")).toMatchObject({
      "grok-provider": "grok-4.6"
    });
  });

  it("ignores empty or malformed storage", () => {
    persistComposerProviderId("  ");
    persistComposerModel("", "grok-4.6");
    localStorage.setItem(COMPOSER_MODELS_KEY, "not-json");
    expect(loadComposerProviderId()).toBe("");
    expect(loadComposerModels()).toEqual({});
  });
});

describe("composer provider hydration", () => {
  it("hydrates once per session and ignores later session object mutations", () => {
    expect(
      shouldHydrateComposerProvider({
        sessionId: "s1",
        hydratedSessionId: null,
        sessionReady: true
      })
    ).toBe(true);
    expect(
      shouldHydrateComposerProvider({
        sessionId: "s1",
        hydratedSessionId: "s1",
        sessionReady: true
      })
    ).toBe(false);
    expect(
      shouldHydrateComposerProvider({
        sessionId: "s2",
        hydratedSessionId: "s1",
        sessionReady: true
      })
    ).toBe(true);
    expect(
      shouldHydrateComposerProvider({
        sessionId: "s1",
        hydratedSessionId: null,
        sessionReady: false
      })
    ).toBe(false);
  });

  it("keeps the selected grok provider on a new empty session", () => {
    expect(
      resolveComposerProviderId({
        sessionProviderId: "openai-default",
        projectProviderId: "openai-default",
        currentProviderId: "grok-provider",
        lastUsedProviderId: "grok-provider",
        providers,
        keepCurrentOnEmptySession: true
      })
    ).toBe("grok-provider");
  });

  it("uses the session provider when reopening a started conversation", () => {
    expect(
      resolveComposerProviderId({
        sessionProviderId: "openai-default",
        currentProviderId: "grok-provider",
        lastUsedProviderId: "grok-provider",
        providers,
        keepCurrentOnEmptySession: false
      })
    ).toBe("openai-default");
  });

  it("falls back to the default provider when the preferred id is gone", () => {
    expect(fallbackProviderId(providers, "deleted-provider")).toBe("openai-default");
    expect(fallbackProviderId(providers, "")).toBe("openai-default");
  });
});

describe("isUnstartedComposerSession", () => {
  it("treats chats without a Codex thread as unstarted, even after the first local user turn", () => {
    expect(isUnstartedComposerSession({ threadId: null })).toBe(true);
    expect(isUnstartedComposerSession({ threadId: "" })).toBe(true);
    expect(isUnstartedComposerSession({ threadId: "thread-1" })).toBe(false);
  });
});

describe("resolveComposerModel", () => {
  it("prefers the current model, then the last used model for that provider", () => {
    expect(
      resolveComposerModel({
        current: "grok-4.6",
        available: ["grok-4", "grok-4.6"],
        preferred: "grok-4",
        fallback: "grok-4"
      })
    ).toBe("grok-4.6");
    expect(
      resolveComposerModel({
        current: "missing",
        available: ["grok-4", "grok-4.6"],
        preferred: "grok-4.6",
        fallback: "grok-4"
      })
    ).toBe("grok-4.6");
    expect(
      resolveComposerModel({
        current: "",
        available: ["gpt-5"],
        preferred: "grok-4.6",
        fallback: "gpt-5"
      })
    ).toBe("gpt-5");
  });
});
