import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";
import { api, setCsrf } from "@/lib/api";
import { useBrandIcon } from "@/lib/branding";
import { syncVisoraUser } from "@/lib/visora";
import { Login } from "@/features/auth/Login";
import { Workspace } from "@/features/workspace/Workspace";
import { SystemSettingsPage } from "@/features/workspace/SystemSettingsPage";
import { SystemUpdateDialog } from "@/features/workspace/SystemUpdateDialog";
function isAuthenticationError(error: unknown) {
  return (
    error instanceof Error &&
    ["Authentication required", "Session expired", "HTTP 401"].includes(error.message)
  );
}

export function App() {
  useBrandIcon();
  const [nonce, setNonce] = useState(0);
  const session = useQuery({
    queryKey: ["auth", nonce],
    queryFn: async () => {
      try {
        const result = await api<{
          csrfToken: string;
          user?: { id: string; username: string };
        }>("/api/auth/session");
        setCsrf(result.csrfToken);
        if (result.user?.id) {
          syncVisoraUser({ id: result.user.id, name: result.user.username });
        }
        return result;
      } catch (error) {
        if (isAuthenticationError(error)) {
          syncVisoraUser(null);
        }
        throw error;
      }
    },
    retry: (failureCount, error) => !isAuthenticationError(error) && failureCount < 2
  });
  if (session.isLoading)
    return (
      <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">
        正在加载工作台...
      </div>
    );
  if (session.isError && isAuthenticationError(session.error))
    return <Login onLogin={() => setNonce((x) => x + 1)} />;
  if (!session.data)
    return (
      <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">
        <div className="space-y-3 text-center">
          <p>暂时无法连接服务器，请检查网络后重试。</p>
          <button className="h-8 rounded-lg border px-3" onClick={() => void session.refetch()}>
            重新连接
          </button>
        </div>
      </div>
    );
  return (
    <>
      <Routes>
        <Route path="/" element={<Workspace />} />
        <Route path="/projects/:projectId" element={<Workspace />} />
        <Route path="/projects/:projectId/sessions/:sessionId" element={<Workspace />} />
        <Route path="/settings" element={<Navigate to="/settings/system-info" replace />} />
        <Route path="/settings/:section" element={<SystemSettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SystemUpdateDialog />
    </>
  );
}
