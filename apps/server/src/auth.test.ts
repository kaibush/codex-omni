import { describe, expect, it } from "vitest";
import { Store } from "@codex-omni/db";
import { createInitialAdmin, hasUsers, initAuth, login } from "./auth.js";

describe("auth bootstrap", () => {
  it("creates the first admin once and then rejects extra setup", async () => {
    const store = new Store(":memory:");
    initAuth(store.db);
    expect(hasUsers(store.db)).toBe(false);
    const first = await createInitialAdmin(store.db, "admin", "password-1");
    expect(first).toBeTruthy();
    expect(hasUsers(store.db)).toBe(true);
    const second = await createInitialAdmin(store.db, "other", "password-2");
    expect(second).toBeNull();
    const session = await login(store.db, "admin", "password-1");
    expect(session?.user.username).toBe("admin");
    expect(await login(store.db, "other", "password-2")).toBeNull();
    store.db.close();
  });
});
