import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
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
    <Card className="max-w-2xl">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base font-medium">
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
        <div className="flex items-center gap-2">
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
      <CardContent className="flex flex-col gap-3 text-sm">
        {group.caption && (
          <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{group.caption}</p>
        )}
        <ul className="flex flex-col divide-y rounded-md border">
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
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className="font-medium">{PLATFORM_LABELS[target.platform]}</span> ·{" "}
          {target.accountName}{" "}
          <span className="text-xs text-muted-foreground">
            ({MEDIA_TYPE_LABELS[target.mediaType]})
          </span>
        </span>
        <div className="flex items-center gap-2">
          {target.status === "FAILED" && (
            <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
              <RotateCw className="size-3.5" />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          <Badge variant={STATUS_VARIANT[target.status]}>{STATUS_LABELS[target.status]}</Badge>
        </div>
      </div>
      {target.youtubeTitle && <p className="text-xs">{target.youtubeTitle}</p>}
      {target.caption !== sharedCaption && (
        <p className="line-clamp-2 text-xs text-muted-foreground">Own caption: {target.caption}</p>
      )}
      {error && (
        <p className="line-clamp-3 break-words text-xs text-destructive" title={error}>
          {error}
        </p>
      )}
      {target.attempt > 1 && (
        <p className="text-xs text-muted-foreground">Attempt {target.attempt}</p>
      )}
    </li>
  );
}
