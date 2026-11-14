/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("@/lib/branding", () => ({ useBrandIcon: () => {} }));
vi.mock("@/lib/visora", () => ({ syncVisoraUser: vi.fn() }));
vi.mock("@/features/auth/Login", () => ({ Login: () => <div>登录表单</div> }));
vi.mock("@/features/workspace/Workspace", () => ({ Workspace: () => null }));
vi.mock("@/features/workspace/SystemSettingsPage", () => ({ SystemSettingsPage: () => null }));
vi.mock("@/features/workspace/SystemUpdateDialog", () => ({ SystemUpdateDialog: () => null }));
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(() => {
  root?.unmount();
  client?.clear();
  container?.remove();
  vi.unstubAllGlobals();
});
async function renderFailure(status?: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (!status) throw new TypeError("Failed to fetch");
      return new Response(
        JSON.stringify({ error: status === 401 ? "Session expired" : "Unavailable" }),
        { status }
      );
    })
  );
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}
it.each([undefined, 503])(
  "offers reconnection instead of login on connection failure (%s)",
  async (status) => {
    await renderFailure(status);
    await vi.waitFor(() => expect(container.textContent).toContain("重新连接"));
    expect(container.textContent).not.toContain("登录表单");
    expect(fetch).toHaveBeenCalledTimes(3);
  }
);
it("shows login without retries for an expired session", async () => {
  await renderFailure(401);
  await vi.waitFor(() => expect(container.textContent).toContain("登录表单"));
  expect(fetch).toHaveBeenCalledTimes(1);
});
