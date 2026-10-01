import { useQuery } from "@tanstack/react-query";
import { PostGroupCard } from "@/components/post-group-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { components } from "@/lib/api-schema";
import { useWorkspaceId } from "@/lib/session";

type PostGroup = components["schemas"]["PostGroup"];

// Most sends resolve within minutes, so a target still PROCESSING after an hour
// is treated as stuck and drops to the slow refresh. A long video can still be
// going between 60 and 90 min (its callback deadline); it then shows up on the
// 30 s refresh instead.
const IN_FLIGHT_MS = 60 * 60_000;

// When a target's current send started: the group's creation, its schedule,
// or the target's posting-limit slot (pushed back, or a fresh retry).
function sendStartedAt(group: PostGroup, target: PostGroup["targets"][number]): number {
  return Math.max(
    Date.parse(group.createdAt),
    group.scheduledFor ? Date.parse(group.scheduledFor) : 0,
    target.sendAt ? Date.parse(target.sendAt) : 0,
  );
}

function hasSendInFlight(groups: PostGroup[], now: number): boolean {
  return groups.some((group) =>
    group.targets.some(
      (target) =>
        target.status === "PROCESSING" && now - sendStartedAt(group, target) < IN_FLIGHT_MS,
    ),
  );
}

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
    // Fast only while something is on its way out — scheduled posts don't
    // change until their time comes, and a stuck send never will.
    refetchInterval: (query) =>
      query.state.data && hasSendInFlight(query.state.data, Date.now()) ? 3000 : 30_000,
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium text-primary">Publishing activity</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">History &amp; Error Center</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Track your posts, their per-account publishing status, and delivery errors.
        </p>
      </div>

      {isPending && (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <div className="size-2.5 animate-pulse rounded-full bg-primary" />
            <p className="text-sm text-muted-foreground">Loading post history…</p>
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm font-medium text-destructive">Could not load post history.</p>
            <p className="mt-1 text-sm text-muted-foreground">Please try again in a moment.</p>
          </CardContent>
        </Card>
      )}

      {groups?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No posts yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Create your first post in the Composer to see your publishing activity here.
            </p>
          </CardContent>
        </Card>
      )}

      {groups && groups.length > 0 && (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <PostGroupCard key={group.id} group={group} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </div>
  );
}
