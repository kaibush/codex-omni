import { afterEach, describe, expect, it, vi } from "vitest";
import { api, apiUpload, setCsrf } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf("");
});

describe("api", () => {
  it("does not send a JSON content type for an empty DELETE request", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("DELETE");
      expect(headers.has("content-type")).toBe(false);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/providers/provider-1", { method: "DELETE" })).resolves.toEqual({
      ok: true
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends JSON content type and CSRF for requests with a body", async () => {
    setCsrf("csrf-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("x-csrf-token")).toBe("csrf-token");
        return new Response(JSON.stringify({ ok: true }));
      })
    );

    await api("/api/providers", { method: "POST", body: JSON.stringify({ name: "Provider" }) });
  });

  it("uploads binary bodies as octet-stream with CSRF", async () => {
    setCsrf("csrf-token");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("PUT");
      expect(headers.get("content-type")).toBe("application/octet-stream");
      expect(headers.get("x-csrf-token")).toBe("csrf-token");
      return new Response(JSON.stringify({ path: "src/a.bin" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      apiUpload("/api/projects/p/files/upload?path=src/a.bin", new Uint8Array([1, 2]))
    ).resolves.toEqual({
      path: "src/a.bin"
    });
  });
});
