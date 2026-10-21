/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_MODELS_KEY,
  COMPOSER_PROVIDER_KEY,
  fallbackProviderId,
  loadComposerModels,
  loadComposerProviderId,
  persistComposerModel,
  persistComposerProviderId,
  resolveComposerModel
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

it("falls back to the default provider when the preferred id is gone", () => {
  expect(fallbackProviderId(providers, "deleted-provider")).toBe("openai-default");
  expect(fallbackProviderId(providers, "")).toBe("openai-default");
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
