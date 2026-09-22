import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
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

type MediaType = "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL" | "REELS" | "STORIES";

const MIN_CAROUSEL_PHOTOS = 2;

type PostablePlatform = "FACEBOOK" | "INSTAGRAM" | "THREADS" | "LINKEDIN";

// Mirrors backend SUPPORTED_MEDIA_TYPES in routes/posts.ts — what each
// platform's n8n workflow actually implements.
const MEDIA_TYPES_BY_PLATFORM: Record<PostablePlatform, { value: MediaType; label: string }[]> = {
  FACEBOOK: [
    { value: "TEXT", label: "Text only" },
    { value: "IMAGE", label: "Image" },
    { value: "VIDEO", label: "Video" },
    { value: "CAROUSEL", label: "Carousel (multiple photos)" },
  ],
  INSTAGRAM: [
    { value: "IMAGE", label: "Image" },
    { value: "CAROUSEL", label: "Carousel (multiple photos)" },
    { value: "REELS", label: "Reel (video)" },
    { value: "STORIES", label: "Story (image only, for now)" },
  ],
  THREADS: [
    { value: "TEXT", label: "Text only" },
    { value: "IMAGE", label: "Image" },
    { value: "VIDEO", label: "Video" },
    { value: "CAROUSEL", label: "Carousel (multiple photos)" },
  ],
  LINKEDIN: [
    { value: "TEXT", label: "Text only" },
    { value: "IMAGE", label: "Image" },
    { value: "VIDEO", label: "Video" },
    { value: "CAROUSEL", label: "Carousel (multiple photos)" },
  ],
};

const PLATFORM_LABELS: Record<PostablePlatform, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  THREADS: "Threads",
  LINKEDIN: "LinkedIn",
};

const SINGLE_URL_MEDIA_TYPES: MediaType[] = ["IMAGE", "VIDEO", "REELS", "STORIES"];

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

  const postableAccounts =
    accounts?.filter(
      (account) =>
        account.platform === "FACEBOOK" ||
        account.platform === "INSTAGRAM" ||
        account.platform === "THREADS" ||
        account.platform === "LINKEDIN",
    ) ?? [];

  const [connectedAccountId, setConnectedAccountId] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("TEXT");
  const [mediaUrl, setMediaUrl] = useState("");
  const [carouselUrls, setCarouselUrls] = useState<string[]>(["", ""]);

  const selectedAccount = postableAccounts.find((account) => account.id === connectedAccountId);
  const selectedPlatform = selectedAccount?.platform as PostablePlatform | undefined;
  const availableMediaTypes = selectedPlatform ? MEDIA_TYPES_BY_PLATFORM[selectedPlatform] : [];

  const trimmedCarouselUrls = carouselUrls.map((url) => url.trim()).filter((url) => url !== "");

  const createPost = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/posts", {
        body: {
          connectedAccountId,
          caption,
          mediaType,
          mediaUrls:
            mediaType === "TEXT" ? [] : mediaType === "CAROUSEL" ? trimmedCarouselUrls : [mediaUrl],
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
      setCarouselUrls(["", ""]);
    },
    onError: () => toast.error("Failed to create post."),
  });

  const canSubmit =
    connectedAccountId !== "" &&
    caption.trim() !== "" &&
    (mediaType === "TEXT" ||
      (mediaType === "CAROUSEL"
        ? trimmedCarouselUrls.length >= MIN_CAROUSEL_PHOTOS
        : mediaUrl.trim() !== "")) &&
    !createPost.isPending;

  function handleAccountChange(accountId: string) {
    setConnectedAccountId(accountId);
    const account = postableAccounts.find((a) => a.id === accountId);
    const validTypes = MEDIA_TYPES_BY_PLATFORM[account?.platform as PostablePlatform]?.map(
      (t) => t.value,
    );
    if (validTypes && !validTypes.includes(mediaType)) {
      setMediaType(validTypes[0]);
    }
  }

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
          {!isPending && !isError && postableAccounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Connect a Facebook, Instagram, Threads, or LinkedIn account from the Dashboard before
              posting.
            </p>
          )}

          {postableAccounts.length > 0 && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="account">Post as</Label>
                <Select value={connectedAccountId} onValueChange={handleAccountChange}>
                  <SelectTrigger id="account">
                    <SelectValue placeholder="Select an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {postableAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.accountName} ({account.platform})
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
                    {availableMediaTypes.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {SINGLE_URL_MEDIA_TYPES.includes(mediaType) && (
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

              {mediaType === "CAROUSEL" && (
                <div className="flex flex-col gap-2">
                  <Label>Photo URLs (Cloudinary, min {MIN_CAROUSEL_PHOTOS})</Label>
                  {carouselUrls.map((url, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={url}
                        onChange={(e) =>
                          setCarouselUrls((urls) =>
                            urls.map((u, i) => (i === index ? e.target.value : u)),
                          )
                        }
                        placeholder="https://res.cloudinary.com/..."
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={carouselUrls.length <= MIN_CAROUSEL_PHOTOS}
                        onClick={() =>
                          setCarouselUrls((urls) => urls.filter((_, i) => i !== index))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setCarouselUrls((urls) => [...urls, ""])}
                  >
                    <Plus className="size-4" />
                    Add photo
                  </Button>
                </div>
              )}

              <Button disabled={!canSubmit} onClick={() => createPost.mutate()}>
                {createPost.isPending
                  ? "Posting…"
                  : selectedPlatform
                    ? `Post to ${PLATFORM_LABELS[selectedPlatform]}`
                    : "Post"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
