import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PROCESSING: "secondary",
  PUBLISHED: "default",
  FAILED: "destructive",
  PARTIAL_FAILURE: "destructive",
  DRAFT: "outline",
  SCHEDULED: "outline",
};

export function HistoryPage() {
  const { data: posts, isPending, isError } = useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/posts");
      if (error) throw error;
      return data;
    },
    refetchInterval: 5000,
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium text-primary">Publishing activity</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          History &amp; Activity
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Track your recent posts, publishing status, and delivery errors.
        </p>
      </div>

      {isPending && (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <div className="size-2.5 animate-pulse rounded-full bg-primary" />
            <p className="text-sm text-muted-foreground">
              Loading post history…
            </p>
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm font-medium text-destructive">
              Could not load post history.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Please try again in a moment.
            </p>
          </CardContent>
        </Card>
      )}

      {posts?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No posts yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Create your first post in the Composer to see your publishing
              activity here.
            </p>
          </CardContent>
        </Card>
      )}

      {posts && posts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-base">Recent activity</CardTitle>
            <p className="text-sm text-muted-foreground">
              Your latest publishing activity is updated automatically.
            </p>
          </CardHeader>

          <CardContent className="p-0">
            <div className="divide-y">
              {posts.map((post) => {
                const failedLog = post.logs.find(
                  (log) => log.status === "FAILED",
                );

                return (
                  <article
                    key={post.id}
                    className="p-5 transition-colors hover:bg-muted/20 sm:p-6"
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {post.connectedAccount.platform.slice(0, 1)}
                          </div>

                          <div className="min-w-0">
                            <p className="font-medium text-foreground">
                              {post.connectedAccount.platform}
                            </p>
                            <p className="truncate text-sm text-muted-foreground">
                              {post.connectedAccount.accountName}
                            </p>
                          </div>
                        </div>

                        <Badge
                          variant={
                            STATUS_VARIANT[post.status] ?? "outline"
                          }
                          className="w-fit shrink-0"
                        >
                          {post.status}
                        </Badge>
                      </div>

                      <div className="space-y-2 pl-0 sm:pl-12">
                        {post.youtubeTitle && (
                          <h2 className="font-medium text-foreground">
                            {post.youtubeTitle}
                          </h2>
                        )}

                        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                          {post.caption}
                        </p>

                        {failedLog?.errorMessage && (
                          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
                              Publishing error
                            </p>
                            <p className="mt-1 text-sm text-destructive">
                              {failedLog.errorMessage}
                            </p>
                          </div>
                        )}

                        <p className="pt-1 text-xs text-muted-foreground">
                          {new Date(post.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}