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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">History & Error Center</h1>

      {isPending && <p className="text-sm text-muted-foreground">Loading posts…</p>}
      {isError && <p className="text-sm text-destructive">Could not load post history.</p>}
      {posts?.length === 0 && (
        <p className="text-sm text-muted-foreground">No posts yet — create one in the Composer.</p>
      )}

      <div className="flex flex-col gap-3">
        {posts?.map((post) => {
          const failedLog = post.logs.find((log) => log.status === "FAILED");
          return (
            <Card key={post.id} className="max-w-lg">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base font-medium">
                  {post.connectedAccount.platform} · {post.connectedAccount.accountName}
                </CardTitle>
                <Badge variant={STATUS_VARIANT[post.status] ?? "outline"}>{post.status}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
                <div>{post.caption}</div>
                <div>{new Date(post.createdAt).toLocaleString()}</div>
                {failedLog?.errorMessage && (
                  <div className="text-destructive">{failedLog.errorMessage}</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
