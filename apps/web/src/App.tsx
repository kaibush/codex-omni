import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";
import { api, setCsrf } from "@/lib/api";
import { Login } from "@/features/auth/Login";
import { Workspace } from "@/features/workspace/Workspace";
import { SystemSettingsPage } from "@/features/workspace/SystemSettingsPage";
import { SystemUpdateDialog } from "@/features/workspace/SystemUpdateDialog";
export function App() {
  const [nonce, setNonce] = useState(0);
  const session = useQuery({
    queryKey: ["auth", nonce],
    queryFn: async () => {
      const result = await api<{ csrfToken: string }>("/api/auth/session");
      setCsrf(result.csrfToken);
      return result;
    },
    retry: false
  });
  if (session.isLoading)
    return (
      <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">
        正在加载工作台...
      </div>
    );
  if (session.isError) return <Login onLogin={() => setNonce((x) => x + 1)} />;
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
