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
import type { components } from "@/lib/api-schema";

type MediaType = "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL" | "REELS" | "STORIES" | "SHORTS";

const MIN_CAROUSEL_PHOTOS = 2;

type PostablePlatform = "FACEBOOK" | "INSTAGRAM" | "THREADS" | "LINKEDIN" | "YOUTUBE";

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
  YOUTUBE: [
    { value: "VIDEO", label: "Video" },
    { value: "SHORTS", label: "Short (vertical or square, ≤3 min)" },
  ],
};

const PLATFORM_LABELS: Record<PostablePlatform, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  THREADS: "Threads",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
};

const SINGLE_URL_MEDIA_TYPES: MediaType[] = ["IMAGE", "VIDEO", "REELS", "STORIES", "SHORTS"];

// Mirrors backend youtubeOptionsSchema in routes/posts.ts.
const YOUTUBE_TITLE_MAX = 100;

type YouTubePrivacy = "public" | "unlisted" | "private";

const YOUTUBE_PRIVACY_OPTIONS: { value: YouTubePrivacy; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

type YouTubeCategoryId = components["schemas"]["YouTubeOptions"]["categoryId"];

// Mirrors backend YOUTUBE_CATEGORY_IDS in routes/posts.ts.
const YOUTUBE_CATEGORIES: { value: YouTubeCategoryId; label: string }[] = [
  { value: "1", label: "Film & Animation" },
  { value: "2", label: "Autos & Vehicles" },
  { value: "10", label: "Music" },
  { value: "15", label: "Pets & Animals" },
  { value: "17", label: "Sports" },
  { value: "19", label: "Travel & Events" },
  { value: "20", label: "Gaming" },
  { value: "22", label: "People & Blogs" },
  { value: "23", label: "Comedy" },
  { value: "24", label: "Entertainment" },
  { value: "25", label: "News & Politics" },
  { value: "26", label: "Howto & Style" },
  { value: "27", label: "Education" },
  { value: "28", label: "Science & Technology" },
  { value: "29", label: "Nonprofits & Activism" },
];

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
        account.platform === "LINKEDIN" ||
        account.platform === "YOUTUBE",
    ) ?? [];

  const [connectedAccountId, setConnectedAccountId] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("TEXT");
  const [mediaUrl, setMediaUrl] = useState("");
  const [carouselUrls, setCarouselUrls] = useState<string[]>(["", ""]);
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubePrivacy, setYoutubePrivacy] = useState<YouTubePrivacy>("private");
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState(false);
  const [youtubeCategoryId, setYoutubeCategoryId] = useState<YouTubeCategoryId>("22");
  const [youtubeTags, setYoutubeTags] = useState("");

  const selectedAccount = postableAccounts.find((account) => account.id === connectedAccountId);
  const selectedPlatform = selectedAccount?.platform as PostablePlatform | undefined;
  const availableMediaTypes = selectedPlatform ? MEDIA_TYPES_BY_PLATFORM[selectedPlatform] : [];
  const isYouTube = selectedPlatform === "YOUTUBE";

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
          youtubeOptions: isYouTube
            ? {
                title: youtubeTitle,
                privacyStatus: youtubePrivacy,
                madeForKids: youtubeMadeForKids,
                categoryId: youtubeCategoryId,
                tags: youtubeTags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag !== ""),
              }
            : undefined,
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
      setYoutubeTitle("");
      setYoutubeTags("");
    },
    onError: () => toast.error("Failed to create post."),
  });

  const canSubmit =
    connectedAccountId !== "" &&
    caption.trim() !== "" &&
    (!isYouTube || youtubeTitle.trim() !== "") &&
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
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium text-primary">Publishing workspace</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Create a post</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Create and publish content to one of your connected social accounts.
        </p>
      </div>

      {isPending && (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <div className="size-2.5 animate-pulse rounded-full bg-primary" />
            <p className="text-sm text-muted-foreground">
              Loading connected accounts…
            </p>
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm font-medium text-destructive">
              Could not load connected accounts.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Please try again or check the Dashboard for your connection status.
            </p>
          </CardContent>
        </Card>
      )}

      {!isPending && !isError && postableAccounts.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No publishing accounts connected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Connect a Facebook, Instagram, Threads, LinkedIn, or YouTube
              account from the Dashboard before posting.
            </p>
          </CardContent>
        </Card>
      )}

      {postableAccounts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-base">New post</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configure your account, content, media, and publishing options.
            </p>
          </CardHeader>

          <CardContent className="p-0">
            <div className="divide-y">
              {/* Account */}
              <section className="space-y-4 p-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    Account
                  </p>
                  <h2 className="mt-1 text-base font-semibold">Choose where to publish</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Select one of your connected accounts.
                  </p>
                </div>

                <div className="max-w-xl">
                  <Label htmlFor="account">Post as</Label>
                  <Select value={connectedAccountId} onValueChange={handleAccountChange}>
                    <SelectTrigger id="account" className="mt-2 h-11">
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
              </section>

              {/* Content */}
              <section className="space-y-5 p-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    Content
                  </p>
                  <h2 className="mt-1 text-base font-semibold">Write your post</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add the text that will accompany your content.
                  </p>
                </div>

                {isYouTube && (
                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="youtube-title">Video title</Label>
                      <span className="text-xs text-muted-foreground">
                        {youtubeTitle.length}/{YOUTUBE_TITLE_MAX}
                      </span>
                    </div>

                    <Input
                      id="youtube-title"
                      value={youtubeTitle}
                      maxLength={YOUTUBE_TITLE_MAX}
                      onChange={(e) => setYoutubeTitle(e.target.value)}
                      placeholder="What's this video about?"
                      className="mt-2 h-11"
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor="caption">
                    {isYouTube ? "Description" : "Caption"}
                  </Label>
                  <Textarea
                    id="caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder={
                      isYouTube
                        ? "Describe your video..."
                        : "What do you want to post?"
                    }
                    rows={6}
                    className="mt-2 resize-y"
                  />
                </div>
              </section>

              {/* Media */}
              <section className="space-y-5 p-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    Media
                  </p>
                  <h2 className="mt-1 text-base font-semibold">Choose your format</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Select the media type supported by this platform.
                  </p>
                </div>

                <div className="max-w-xl">
                  <Label htmlFor="media-type">Media type</Label>
                  <Select
                    value={mediaType}
                    onValueChange={(value) => setMediaType(value as MediaType)}
                  >
                    <SelectTrigger id="media-type" className="mt-2 h-11">
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
                  <div>
                    <Label htmlFor="media-url">Media URL (Cloudinary)</Label>
                    <Input
                      id="media-url"
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder="https://res.cloudinary.com/..."
                      className="mt-2 h-11"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Paste the Cloudinary URL for the media you want to publish.
                    </p>
                  </div>
                )}

                {mediaType === "CAROUSEL" && (
                  <div className="space-y-3">
                    <div>
                      <Label>
                        Photo URLs (Cloudinary, min {MIN_CAROUSEL_PHOTOS})
                      </Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Add at least {MIN_CAROUSEL_PHOTOS} photo URLs.
                      </p>
                    </div>

                    <div className="space-y-2">
                      {carouselUrls.map((url, index) => (
                        <div key={index} className="flex gap-2">
                          <Input
                            value={url}
                            onChange={(e) =>
                              setCarouselUrls((urls) =>
                                urls.map((u, i) =>
                                  i === index ? e.target.value : u,
                                ),
                              )
                            }
                            placeholder={`Photo ${index + 1} — https://res.cloudinary.com/...`}
                            className="h-11"
                          />

                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={carouselUrls.length <= MIN_CAROUSEL_PHOTOS}
                            onClick={() =>
                              setCarouselUrls((urls) =>
                                urls.filter((_, i) => i !== index),
                              )
                            }
                            aria-label={`Remove photo ${index + 1}`}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCarouselUrls((urls) => [...urls, ""])}
                    >
                      <Plus className="size-4" />
                      Add photo
                    </Button>
                  </div>
                )}
              </section>

              {/* YouTube options */}
              {isYouTube && (
                <section className="space-y-5 bg-muted/10 p-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      YouTube options
                    </p>
                    <h2 className="mt-1 text-base font-semibold">
                      Publishing settings
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Configure how your YouTube video will be published.
                    </p>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <Label htmlFor="youtube-privacy">Visibility</Label>
                      <Select
                        value={youtubePrivacy}
                        onValueChange={(value) =>
                          setYoutubePrivacy(value as YouTubePrivacy)
                        }
                      >
                        <SelectTrigger id="youtube-privacy" className="mt-2 h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {YOUTUBE_PRIVACY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="youtube-category">Category</Label>
                      <Select
                        value={youtubeCategoryId}
                        onValueChange={(value) =>
                          setYoutubeCategoryId(value as YouTubeCategoryId)
                        }
                      >
                        <SelectTrigger id="youtube-category" className="mt-2 h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {YOUTUBE_CATEGORIES.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="youtube-kids">Made for kids?</Label>
                      <Select
                        value={youtubeMadeForKids ? "yes" : "no"}
                        onValueChange={(value) =>
                          setYoutubeMadeForKids(value === "yes")
                        }
                      >
                        <SelectTrigger id="youtube-kids" className="mt-2 h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no">
                            No, it's not made for kids
                          </SelectItem>
                          <SelectItem value="yes">
                            Yes, it's made for kids
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="youtube-tags">
                        Tags (optional, comma-separated)
                      </Label>
                      <Input
                        id="youtube-tags"
                        value={youtubeTags}
                        onChange={(e) => setYoutubeTags(e.target.value)}
                        placeholder="tutorial, product launch"
                        className="mt-2 h-11"
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* Action */}
              <section className="flex flex-col gap-4 bg-muted/20 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {selectedPlatform
                      ? `Ready to post to ${PLATFORM_LABELS[selectedPlatform]}`
                      : "Select an account to continue"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your post will be submitted using the connected account above.
                  </p>
                </div>

                <Button
                  className="w-full sm:w-auto"
                  size="lg"
                  disabled={!canSubmit}
                  onClick={() => createPost.mutate()}
                >
                  {createPost.isPending
                    ? "Posting…"
                    : selectedPlatform
                      ? `Post to ${PLATFORM_LABELS[selectedPlatform]}`
                      : "Post"}
                </Button>
              </section>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}