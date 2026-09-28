import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";

const LAST_WORKSPACE_KEY = "smposting:lastWorkspaceId";

// The signed-in user + their workspaces. Resolves to null (not an error) when
// there's no session, so the guard can redirect to /login.
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/me");
      if (response.status === 401) return null;
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

// Only a preference, never an access decision — the backend checks
// membership on every request, and a stale id here just falls through to the
// first workspace.
export function rememberWorkspace(workspaceId: string) {
  localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

// Active workspace: the one in the URL under /w/:workspaceId, otherwise (e.g.
// on /profile) the last one used, otherwise the user's first.
export function useWorkspaceId(): string | undefined {
  const { workspaceId } = useParams();
  const { data: me } = useMe();
  if (workspaceId) return workspaceId;
  if (!me) return undefined;

  const last = localStorage.getItem(LAST_WORKSPACE_KEY);
  return me.workspaces.find((workspace) => workspace.id === last)?.id ?? me.workspaces[0]?.id;
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async ({ everywhere }: { everywhere: boolean }) => {
      const { error } = everywhere
        ? await api.POST("/api/logout-all")
        : await api.POST("/api/logout");
      if (error) throw error;
    },
    onSuccess: () => {
      // Drop every cached response so nothing from this account lingers for
      // whoever signs in next in this tab.
      queryClient.clear();
      localStorage.removeItem(LAST_WORKSPACE_KEY);
      navigate("/login", { replace: true });
    },
  });
}
