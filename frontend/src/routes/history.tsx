import { useQuery } from "@tanstack/react-query";
import { PostGroupCard } from "@/components/post-group-card";
import { api } from "@/lib/api";
import { useWorkspaceId } from "@/lib/session";

export function HistoryPage() {
  const workspaceId = useWorkspaceId() ?? "";
  const {
    data: groups,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["post-groups", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/workspaces/{workspaceId}/post-groups", {
        params: { path: { workspaceId } },
      });
      if (error) throw error;
      return data;
    },
    // Only poll while something is on its way out — scheduled posts don't
    // change until their time comes.
    refetchInterval: (query) =>
      query.state.data?.some((group) => group.status === "PROCESSING") ? 3000 : 30_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">History & Error Center</h1>

      {isPending && <p className="text-sm text-muted-foreground">Loading posts…</p>}
      {isError && <p className="text-sm text-destructive">Could not load post history.</p>}
      {groups?.length === 0 && (
        <p className="text-sm text-muted-foreground">No posts yet — create one in the Composer.</p>
      )}

      <div className="flex flex-col gap-3">
        {groups?.map((group) => (
          <PostGroupCard key={group.id} group={group} workspaceId={workspaceId} />
        ))}
      </div>
    </div>
  );
}
