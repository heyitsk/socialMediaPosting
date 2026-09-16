import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

type MediaType = "TEXT" | "IMAGE" | "VIDEO";

export function ComposerPage() {
  const queryClient = useQueryClient();

  const { data: accounts, isPending, isError } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/integrations");
      if (error) throw error;
      return data;
    },
  });

  const facebookAccounts = accounts?.filter((account) => account.platform === "FACEBOOK") ?? [];

  const [connectedAccountId, setConnectedAccountId] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("TEXT");
  const [mediaUrl, setMediaUrl] = useState("");

  const createPost = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/posts", {
        body: {
          connectedAccountId,
          caption,
          mediaType,
          mediaUrls: mediaType === "TEXT" ? [] : [mediaUrl],
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (post) => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      if (post?.status === "FAILED") {
        toast.error("Post dispatch failed — check History for details.");
      } else {
        toast.success("Post submitted.");
      }
      setCaption("");
      setMediaUrl("");
    },
    onError: () => toast.error("Failed to create post."),
  });

  const canSubmit =
    connectedAccountId !== "" &&
    caption.trim() !== "" &&
    (mediaType === "TEXT" || mediaUrl.trim() !== "") &&
    !createPost.isPending;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Post Composer</h1>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>New Post</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isPending && <p className="text-sm text-muted-foreground">Loading accounts…</p>}
          {isError && (
            <p className="text-sm text-destructive">Could not load connected accounts.</p>
          )}
          {!isPending && !isError && facebookAccounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Connect a Facebook account from the Dashboard before posting.
            </p>
          )}

          {facebookAccounts.length > 0 && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="account">Post as</Label>
                <Select value={connectedAccountId} onValueChange={setConnectedAccountId}>
                  <SelectTrigger id="account">
                    <SelectValue placeholder="Select a Facebook Page" />
                  </SelectTrigger>
                  <SelectContent>
                    {facebookAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.accountName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="caption">Caption</Label>
                <Textarea
                  id="caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="What do you want to post?"
                  rows={4}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="media-type">Media type</Label>
                <Select
                  value={mediaType}
                  onValueChange={(value) => setMediaType(value as MediaType)}
                >
                  <SelectTrigger id="media-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TEXT">Text only</SelectItem>
                    <SelectItem value="IMAGE">Image</SelectItem>
                    <SelectItem value="VIDEO">Video</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mediaType !== "TEXT" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="media-url">Media URL (Cloudinary)</Label>
                  <Input
                    id="media-url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="https://res.cloudinary.com/..."
                  />
                </div>
              )}

              <Button disabled={!canSubmit} onClick={() => createPost.mutate()}>
                {createPost.isPending ? "Posting…" : "Post to Facebook"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
