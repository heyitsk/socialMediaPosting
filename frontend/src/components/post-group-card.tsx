import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { PlatformMark } from "@/components/platform-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, apiErrorMessage } from "@/lib/api";
import {
  CONTENT_KIND_LABELS,
  latestError,
  MEDIA_TYPE_LABELS,
  PLATFORM_LABELS,
  type PostGroup,
  type PostTarget,
  STATUS_LABELS,
  STATUS_VARIANT,
} from "@/lib/posting";

// One post group: the aggregate status up top, then one row per target
// account with its own status, error and Retry. Used by the composer's
// results panel and by History.
export function PostGroupCard({ group, workspaceId }: { group: PostGroup; workspaceId: string }) {
  const queryClient = useQueryClient();

  // Both endpoints return the updated group — write it straight into the
  // caches so the row changes without waiting for the next poll.
  const onUpdated = (updated: PostGroup) => {
    queryClient.setQueryData(["post-group", workspaceId, updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ["post-groups", workspaceId] });
  };

  const cancel = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/workspaces/{workspaceId}/post-groups/{groupId}/cancel",
        { params: { path: { workspaceId, groupId: group.id } } },
      );
      if (error || !data) throw error ?? new Error("Empty response");
      return data;
    },
    onSuccess: (updated) => {
      onUpdated(updated);
      toast.success("Scheduled post cancelled");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't cancel the post")),
  });

  const retry = useMutation({
    mutationFn: async (postId: string) => {
      const { data, error } = await api.POST(
        "/api/workspaces/{workspaceId}/post-groups/{groupId}/targets/{postId}/retry",
        { params: { path: { workspaceId, groupId: group.id, postId } } },
      );
      if (error || !data) throw error ?? new Error("Empty response");
      return data;
    },
    onSuccess: onUpdated,
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't retry")),
  });

  const hasScheduled = group.targets.some((target) => target.status === "SCHEDULED");

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b bg-muted/20 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-base">
            {CONTENT_KIND_LABELS[group.contentKind]} to {group.targets.length}{" "}
            {group.targets.length === 1 ? "account" : "accounts"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {group.scheduledFor
              ? `Scheduled for ${new Date(group.scheduledFor).toLocaleString()}`
              : new Date(group.createdAt).toLocaleString()}{" "}
            · by {group.createdBy.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasScheduled && (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          <Badge variant={STATUS_VARIANT[group.status]}>{STATUS_LABELS[group.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0 text-sm">
        {group.caption && (
          <p className="line-clamp-3 whitespace-pre-wrap border-b px-5 py-4 leading-6 text-muted-foreground sm:px-6">
            {group.caption}
          </p>
        )}
        <ul className="flex flex-col divide-y">
          {group.targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              sharedCaption={group.caption}
              retrying={retry.isPending && retry.variables === target.id}
              onRetry={() => retry.mutate(target.id)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TargetRow({
  target,
  sharedCaption,
  retrying,
  onRetry,
}: {
  target: PostTarget;
  sharedCaption: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const error = latestError(target);
  return (
    <li className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/20 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformMark platform={target.platform} className="size-9" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {PLATFORM_LABELS[target.platform]}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({MEDIA_TYPE_LABELS[target.mediaType]})
              </span>
            </p>
            <p className="truncate text-sm text-muted-foreground">{target.accountName}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {target.canRetry && (
            <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
              <RotateCw className="size-3.5" />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          {target.status === "FAILED" && !target.canRetry && (
            <span className="text-xs text-muted-foreground">
              Retry limit reached — create the post again
            </span>
          )}
          {target.preparingMedia && target.status === "PROCESSING" ? (
            <Badge variant="secondary">Preparing media…</Badge>
          ) : (
            <Badge variant={STATUS_VARIANT[target.status]}>{STATUS_LABELS[target.status]}</Badge>
          )}
        </div>
      </div>
      {(target.youtubeTitle || target.caption !== sharedCaption || error || target.attempt > 1) && (
        <div className="space-y-2 sm:pl-12">
          {target.youtubeTitle && (
            <p className="font-medium text-foreground">{target.youtubeTitle}</p>
          )}
          {target.caption !== sharedCaption && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              Own caption: {target.caption}
            </p>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
                Publishing error
              </p>
              <p className="mt-1 line-clamp-3 break-words text-sm text-destructive" title={error}>
                {error}
              </p>
            </div>
          )}
          {target.attempt > 1 && (
            <p className="text-xs text-muted-foreground">Attempt {target.attempt}</p>
          )}
        </div>
      )}
    </li>
  );
}
