import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { rememberWorkspace, useMe, useWorkspaceId } from "@/lib/session";
import { ComposerPage } from "@/routes/composer";
import { DashboardPage } from "@/routes/dashboard";
import { HistoryPage } from "@/routes/history";
import { AppLayout } from "@/routes/layout";
import { LoginPage } from "@/routes/login";
import { NewWorkspacePage } from "@/routes/new-workspace";
import { ProfilePage } from "@/routes/profile";
import { WorkspaceSettingsPage } from "@/routes/workspace-settings";

function RequireAuth() {
  const location = useLocation();
  const { data: me, isPending, isError } = useMe();

  if (isPending) return null;
  if (isError)
    return <div className="p-6 text-sm text-destructive">Couldn't reach the backend.</div>;
  if (!me) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

// "/" → the active workspace, keeping the query string: connect-flow errors
// that can't name a workspace (?error=…_connect_invalid_state) land here and
// the dashboard still needs them for its toast.
function WorkspaceRedirect() {
  const location = useLocation();
  const workspaceId = useWorkspaceId();
  if (!workspaceId) return null;
  return <Navigate to={`/w/${workspaceId}${location.search}`} replace />;
}

// A workspace id in the URL that isn't one of yours (stale bookmark, removed
// from it) falls back to your default rather than showing a broken page — the
// backend would 404 every request for it anyway.
function RequireWorkspace() {
  const { workspaceId } = useParams();
  const { data: me } = useMe();
  const isMember = me?.workspaces.some((workspace) => workspace.id === workspaceId) ?? false;

  useEffect(() => {
    if (isMember && workspaceId) rememberWorkspace(workspaceId);
  }, [isMember, workspaceId]);

  if (!isMember) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<WorkspaceRedirect />} />
        <Route element={<AppLayout />}>
          <Route path="w/:workspaceId" element={<RequireWorkspace />}>
            <Route index element={<DashboardPage />} />
            <Route path="composer" element={<ComposerPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="settings" element={<WorkspaceSettingsPage />} />
          </Route>
          <Route path="workspaces/new" element={<NewWorkspacePage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
