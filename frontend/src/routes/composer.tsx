import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MediaPicker, useMediaUploads } from "@/components/media-picker";
import { PostGroupCard } from "@/components/post-group-card";
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
import { api, apiErrorMessage } from "@/lib/api";
import type { components } from "@/lib/api-schema";
import { isVideoFile } from "@/lib/media-upload";
import {
  CONTENT_KIND_LABELS,
  CONTENT_KINDS,
  type ContentKind,
  captionLength,
  countHashtags,
  MEDIA_TYPE_LABELS,
  PLATFORM_LABELS,
  type PlatformCapabilities,
  type PostGroupValidationError,
  YOUTUBE_CATEGORIES,
  YOUTUBE_PRIVACY_OPTIONS,
  YOUTUBE_TITLE_MAX,
  type YouTubeOptions,
} from "@/lib/posting";
import { useWorkspaceId } from "@/lib/session";
import { cn } from "@/lib/utils";

type Account = components["schemas"]["ConnectedAccountSummary"];

// The backend accepts 1 minute ahead (time spent on the form after picking);
// asking for 2 here keeps a quick submit from bouncing. websitePlan.md §10.6.
const MIN_SCHEDULE_LEAD_MS = 2 * 60_000;
const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 60 * 60_000;

// Per-account settings. Kept for every account ever ticked, so unticking and
// re-ticking one doesn't lose what was typed.
interface TargetSettings {
  overrideCaption: boolean;
  caption: string;
  youtubeMediaType: "VIDEO" | "SHORTS";
  youtubeTitle: string;
  youtubePrivacy: YouTubeOptions["privacyStatus"];
  youtubeCategoryId: YouTubeOptions["categoryId"];
  youtubeMadeForKids: boolean;
  youtubeTags: string;
}

const DEFAULT_SETTINGS: TargetSettings = {
  overrideCaption: false,
  caption: "",
  youtubeMediaType: "VIDEO",
  youtubeTitle: "",
  youtubePrivacy: "private",
  youtubeCategoryId: "22",
  youtubeMadeForKids: false,
  youtubeTags: "",
};

interface Problem {
  message: string;
  // Not filled in yet, as opposed to filled in wrong.
  missing?: boolean;
}

interface VideoShape {
  width: number;
  height: number;
  durationSeconds: number;
}

// Reads a video's dimensions in the browser (metadata only — no download of
// the whole file) for the Shorts check. The backend re-checks with ffprobe;
// this just surfaces the problem before submit. null while unknown.
function useVideoShape(url: string | null): VideoShape | null {
  const [shape, setShape] = useState<{ url: string; shape: VideoShape } | null>(null);
  useEffect(() => {
    if (!url) return;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      setShape({
        url,
        shape: {
          width: video.videoWidth,
          height: video.videoHeight,
          durationSeconds: video.duration,
        },
      });
    video.src = url;
    return () => {
      video.onloadedmetadata = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);
  return shape && shape.url === url ? shape.shape : null;
}

// datetime-local wants local time without a zone.
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ComposerPage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId() ?? "";

  const {
    data: accounts,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["integrations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/workspaces/{workspaceId}/integrations", {
        params: { path: { workspaceId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const { data: capabilities } = useQuery({
    queryKey: ["capabilities"],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/capabilities");
      if (error) throw error;
      return data;
    },
  });

  // A new key per composed post: resubmitting the same one (double click,
  // retry after a network drop) returns the group already created.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<ContentKind | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<Record<string, TargetSettings>>({});
  const [caption, setCaption] = useState("");
  const media = useMediaUploads(workspaceId);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [serverErrors, setServerErrors] = useState<PostGroupValidationError | null>(null);
  const [resultGroupId, setResultGroupId] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const capabilitiesByPlatform = new Map(
    capabilities?.platforms.map((platform) => [platform.platform, platform]) ?? [],
  );
  const settingsFor = (id: string) => settings[id] ?? DEFAULT_SETTINGS;
  const updateSettings = (id: string, patch: Partial<TargetSettings>) =>
    setSettings((all) => ({ ...all, [id]: { ...(all[id] ?? DEFAULT_SETTINGS), ...patch } }));

  // Why an account can't take this post, or null if it can.
  function unavailableReason(account: Account): string | null {
    const platformCapabilities = capabilitiesByPlatform.get(account.platform);
    if (!platformCapabilities)
      return `Posting to ${PLATFORM_LABELS[account.platform]} isn't supported yet`;
    if (account.needsReconnect) return "Reconnect this account on the Dashboard first";
    if (kind && !platformCapabilities.mediaTypes.some((option) => option.kind === kind)) {
      return `${PLATFORM_LABELS[account.platform]} doesn't support ${CONTENT_KIND_LABELS[kind].toLowerCase()} posts`;
    }
    return null;
  }

  const allAccounts = accounts ?? [];
  const selectedAccounts = allAccounts.filter(
    (account) => selectedIds.includes(account.id) && unavailableReason(account) === null,
  );

  function chooseKind(next: ContentKind) {
    setKind(next);
    // Keep uploads the new kind can still use; delete the rest.
    if (next === "TEXT") media.keepOnly(() => false);
    else {
      const video = next === "VIDEO";
      const single = next !== "CAROUSEL";
      media.keepOnly((item, index) => isVideoFile(item.file) === video && (!single || index === 0));
    }
    setServerErrors(null);
    // Drop accounts that can't take the new kind rather than silently
    // keeping them out of the post.
    setSelectedIds((ids) =>
      ids.filter((id) => {
        const account = allAccounts.find((candidate) => candidate.id === id);
        const platformCapabilities = account && capabilitiesByPlatform.get(account.platform);
        return platformCapabilities?.mediaTypes.some((option) => option.kind === next) ?? false;
      }),
    );
  }

  const toggleAccount = (id: string) =>
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id],
    );

  const mediaItems = kind === "TEXT" || kind === null ? [] : media.items;
  const mediaAssetIds = mediaItems.flatMap((item) =>
    item.status === "ready" && item.assetId ? [item.assetId] : [],
  );
  const nonJpeg = mediaItems.filter(
    (item) => kind !== "VIDEO" && item.contentType !== "image/jpeg",
  );

  const wantsShort = selectedAccounts.some(
    (account) =>
      account.platform === "YOUTUBE" && settingsFor(account.id).youtubeMediaType === "SHORTS",
  );
  // The local file, so the check doesn't wait for the upload.
  const videoShape = useVideoShape(
    kind === "VIDEO" && wantsShort ? (mediaItems[0]?.previewUrl ?? null) : null,
  );

  // --- Validation (mirrors the backend's; the backend has the final say) ---

  // "Not filled in yet" problems (missing: true) stay hidden until the first
  // submit attempt — otherwise a fresh form, or the one just cleared after a
  // successful post, is covered in red before the user has typed anything.
  // Wrong input (too long, landscape Short, ...) shows as soon as it's typed.
  // Both block the submit.
  const groupProblems: Problem[] = [];
  if (kind === "CAROUSEL" && mediaItems.length < 2)
    groupProblems.push({ message: "Add at least 2 images", missing: true });
  if ((kind === "IMAGE" || kind === "STORY") && mediaItems.length === 0)
    groupProblems.push({ message: "Add an image", missing: true });
  if (kind === "VIDEO" && mediaItems.length === 0)
    groupProblems.push({ message: "Add a video", missing: true });
  if (mediaItems.some((item) => item.status === "uploading"))
    groupProblems.push({ message: "Wait for the uploads to finish", missing: true });
  if (mediaItems.some((item) => item.status === "error"))
    groupProblems.push({ message: "Retry or remove the files that failed to upload" });
  if (scheduleMode === "later") {
    const at = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(at.getTime()))
      groupProblems.push({ message: "Pick a date and time", missing: true });
    else if (at.getTime() - Date.now() < MIN_SCHEDULE_LEAD_MS)
      groupProblems.push({ message: "Schedule at least 2 minutes from now" });
    else if (at.getTime() - Date.now() > MAX_SCHEDULE_AHEAD_MS)
      groupProblems.push({ message: "Posts can be scheduled at most 90 days ahead" });
  }

  function targetProblemsFor(
    account: Account,
    platformCapabilities: PlatformCapabilities,
  ): Problem[] {
    const errors: Problem[] = [];
    const own = settingsFor(account.id);
    const effectiveCaption = (own.overrideCaption ? own.caption : caption).trim();
    const label = PLATFORM_LABELS[account.platform];
    if (effectiveCaption === "") errors.push({ message: "Caption is empty", missing: true });
    const length = captionLength(effectiveCaption);
    if (length > platformCapabilities.captionLimit) {
      errors.push({
        message: `Caption is ${length} characters — ${label} allows ${platformCapabilities.captionLimit}`,
      });
    }
    if (
      account.platform === "INSTAGRAM" &&
      capabilities &&
      countHashtags(effectiveCaption) > capabilities.instagramMaxHashtags
    ) {
      errors.push({
        message: `Instagram allows at most ${capabilities.instagramMaxHashtags} hashtags`,
      });
    }
    if (kind === "CAROUSEL") {
      const { min, max } = platformCapabilities.carousel;
      if (mediaItems.length >= 2 && (mediaItems.length < min || mediaItems.length > max))
        errors.push({ message: `${label} carousels take ${min}-${max} images` });
    }
    // Instagram's publishing API takes JPEG images only.
    if (account.platform === "INSTAGRAM" && nonJpeg.length > 0) {
      errors.push({
        message: `Instagram only accepts JPEG images — ${nonJpeg.map((item) => item.file.name).join(", ")} ${nonJpeg.length === 1 ? "isn't" : "aren't"}`,
      });
    }
    if (account.platform === "YOUTUBE") {
      if (own.youtubeTitle.trim() === "")
        errors.push({ message: "Add a video title", missing: true });
      if (/[<>]/.test(own.youtubeTitle)) errors.push({ message: "The title can't contain < or >" });
      if (own.youtubeMediaType === "SHORTS" && videoShape && capabilities) {
        if (videoShape.height < videoShape.width)
          errors.push({
            message: `Can't post as a Short: it's landscape (${videoShape.width}x${videoShape.height}) — Shorts must be vertical or square`,
          });
        if (videoShape.durationSeconds > capabilities.shortsMaxDurationSeconds)
          errors.push({
            message: `Can't post as a Short: it's ${Math.round(videoShape.durationSeconds)}s long — Shorts can be at most ${capabilities.shortsMaxDurationSeconds}s`,
          });
      }
    }
    return errors;
  }

  const shown = (problems: Problem[]) =>
    problems
      .filter((problem) => submitAttempted || !problem.missing)
      .map((problem) => problem.message);
  const groupErrors = shown(groupProblems);

  let clientBlocked = groupProblems.length > 0;
  const targetErrors = new Map<string, string[]>();
  for (const account of selectedAccounts) {
    const platformCapabilities = capabilitiesByPlatform.get(account.platform);
    if (!platformCapabilities) continue;
    const problems = targetProblemsFor(account, platformCapabilities);
    if (problems.length > 0) clientBlocked = true;
    const errors = shown(problems);
    // Rejections from the last submit, until the next one (the backend also
    // checks things the browser can't, like ffprobe on the uploaded video).
    const fromServer = serverErrors?.targets.find(
      (target) => target.connectedAccountId === account.id,
    )?.errors;
    const merged = [...new Set([...errors, ...(fromServer ?? [])])];
    if (merged.length > 0) targetErrors.set(account.id, merged);
  }
  // Blocking, with a one-click way out (websitePlan.md §10.1 decision 3).
  const deselectInvalid = () => {
    setSelectedIds((ids) => ids.filter((id) => !targetErrors.has(id)));
    setServerErrors((current) => current && { ...current, targets: [] });
  };

  const createGroup = useMutation({
    mutationFn: async () => {
      if (!kind) throw new Error("Pick what you're posting");
      const { data, error, response } = await api.POST(
        "/api/workspaces/{workspaceId}/post-groups",
        {
          params: { path: { workspaceId } },
          body: {
            idempotencyKey,
            contentKind: kind,
            caption,
            mediaAssetIds,
            scheduledFor:
              scheduleMode === "later" ? new Date(scheduledAt).toISOString() : undefined,
            targets: selectedAccounts.map((account) => {
              const own = settingsFor(account.id);
              return {
                connectedAccountId: account.id,
                captionOverride: own.overrideCaption ? own.caption : undefined,
                mediaType: account.platform === "YOUTUBE" ? own.youtubeMediaType : undefined,
                youtubeOptions:
                  account.platform === "YOUTUBE"
                    ? {
                        title: own.youtubeTitle.trim(),
                        privacyStatus: own.youtubePrivacy,
                        categoryId: own.youtubeCategoryId,
                        madeForKids: own.youtubeMadeForKids,
                        tags: own.youtubeTags
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter((tag) => tag !== ""),
                      }
                    : undefined,
              };
            }),
          },
        },
      );
      if (error) throw error;
      return { group: data, created: response.status === 201 };
    },
    onMutate: () => setServerErrors(null),
    onSuccess: ({ group, created }) => {
      queryClient.setQueryData(["post-group", workspaceId, group.id], group);
      queryClient.invalidateQueries({ queryKey: ["post-groups", workspaceId] });
      setResultGroupId(group.id);
      if (!created) toast.info("That post was already submitted — showing its status");
      else if (group.status === "SCHEDULED") toast.success("Post scheduled");
      else toast.success(`Posting to ${group.targets.length} accounts…`);
      // Ready for the next post; keep the account picks, which are often reused.
      setIdempotencyKey(crypto.randomUUID());
      setCaption("");
      media.clear();
      setSettings({});
      setScheduleMode("now");
      setScheduledAt("");
      setSubmitAttempted(false);
    },
    onError: (err) => {
      if (err && typeof err === "object" && "targets" in err) {
        setServerErrors(err as unknown as PostGroupValidationError);
        toast.error("Some accounts can't take this post — see below");
      } else {
        toast.error(
          apiErrorMessage(err, err instanceof Error ? err.message : "Failed to create the post"),
        );
      }
    },
  });

  const { data: resultGroup } = useQuery({
    queryKey: ["post-group", workspaceId, resultGroupId],
    enabled: !!resultGroupId,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/workspaces/{workspaceId}/post-groups/{groupId}", {
        params: { path: { workspaceId, groupId: resultGroupId ?? "" } },
      });
      if (error) throw error;
      return data;
    },
    refetchInterval: (query) => (query.state.data?.status === "PROCESSING" ? 3000 : false),
  });

  // Clickable even with problems left, so the click can reveal what's missing.
  const canSubmit =
    !!kind && selectedAccounts.length > 0 && !createGroup.isPending && !!capabilities;

  function submit() {
    setSubmitAttempted(true);
    if (!clientBlocked) createGroup.mutate();
  }

  // The tightest caption limit among the picks, for the shared counter.
  const tightest = selectedAccounts
    .map((account) => ({
      label: PLATFORM_LABELS[account.platform],
      limit: capabilitiesByPlatform.get(account.platform)?.captionLimit ?? Infinity,
      overridden: settingsFor(account.id).overrideCaption,
    }))
    .filter((pick) => !pick.overridden)
    .sort((a, b) => a.limit - b.limit)[0];

  const submitLabel = createGroup.isPending
    ? "Submitting…"
    : `${scheduleMode === "later" ? "Schedule" : "Post"} to ${selectedAccounts.length} ${
        selectedAccounts.length === 1 ? "account" : "accounts"
      }`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Post Composer</h1>

      {resultGroup && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between max-w-2xl">
            <h2 className="text-lg font-medium">Latest post</h2>
            <Button variant="ghost" size="sm" onClick={() => setResultGroupId(null)}>
              Dismiss
            </Button>
          </div>
          <PostGroupCard group={resultGroup} workspaceId={workspaceId} />
        </div>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>1. What are you posting?</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CONTENT_KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => chooseKind(option.kind)}
              className={cn(
                "flex flex-col items-start rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted",
                kind === option.kind && "border-primary bg-muted",
              )}
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      {kind && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>2. Where?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {isPending && <p className="text-sm text-muted-foreground">Loading accounts…</p>}
            {isError && (
              <p className="text-sm text-destructive">Could not load connected accounts.</p>
            )}
            {!isPending && !isError && allAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Connect an account from the Dashboard before posting.
              </p>
            )}
            {allAccounts.map((account) => {
              const reason = unavailableReason(account);
              const checked = selectedIds.includes(account.id) && reason === null;
              return (
                <label
                  key={account.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm",
                    reason ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked}
                    disabled={reason !== null}
                    onChange={() => toggleAccount(account.id)}
                  />
                  <span>
                    <span className="font-medium">{PLATFORM_LABELS[account.platform]}</span> ·{" "}
                    {account.accountName}
                    {account.connectionMethod === "FACEBOOK_PAGE" &&
                      account.platform === "INSTAGRAM" && (
                        <span className="text-xs text-muted-foreground"> (via Facebook Page)</span>
                      )}
                  </span>
                  {reason && (
                    <span className="ml-auto text-xs text-muted-foreground">{reason}</span>
                  )}
                </label>
              );
            })}
          </CardContent>
        </Card>
      )}

      {kind && selectedAccounts.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>3. Content</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="caption">Caption</Label>
              <Textarea
                id="caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="What do you want to post?"
                rows={4}
              />
              {tightest && Number.isFinite(tightest.limit) && (
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    captionLength(caption.trim()) > tightest.limit && "text-destructive",
                  )}
                >
                  {captionLength(caption.trim())}/{tightest.limit} ({tightest.label} is the
                  strictest you picked)
                </p>
              )}
            </div>

            {kind !== "TEXT" && (
              <div className="flex flex-col gap-2">
                <Label>
                  {kind === "VIDEO" ? "Video" : kind === "CAROUSEL" ? "Images (in order)" : "Image"}
                </Label>
                <MediaPicker
                  items={mediaItems}
                  video={kind === "VIDEO"}
                  multiple={kind === "CAROUSEL"}
                  onAdd={(files) =>
                    media.add(files, { video: kind === "VIDEO", single: kind !== "CAROUSEL" })
                  }
                  onRemove={media.remove}
                  onRetry={media.retry}
                  onMove={media.move}
                />
                {kind === "VIDEO" &&
                  selectedAccounts.some((account) => account.platform === "INSTAGRAM") && (
                    <p className="text-xs text-muted-foreground">
                      Instagram posts videos as Reels.
                    </p>
                  )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {kind && selectedAccounts.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>4. Per-account settings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {selectedAccounts.map((account) => (
              <TargetSettingsPanel
                key={account.id}
                account={account}
                settings={settingsFor(account.id)}
                onChange={(patch) => updateSettings(account.id, patch)}
                captionLimit={capabilitiesByPlatform.get(account.platform)?.captionLimit}
                errors={targetErrors.get(account.id) ?? []}
                kind={kind}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {kind && selectedAccounts.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>5. When?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="accent-primary"
                  checked={scheduleMode === "now"}
                  onChange={() => setScheduleMode("now")}
                />
                Post now
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="accent-primary"
                  checked={scheduleMode === "later"}
                  onChange={() => setScheduleMode("later")}
                />
                Schedule
              </label>
            </div>
            {scheduleMode === "later" && (
              <Input
                type="datetime-local"
                className="max-w-xs"
                value={scheduledAt}
                min={toLocalInputValue(new Date(Date.now() + MIN_SCHEDULE_LEAD_MS))}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            )}

            {[...groupErrors, ...(serverErrors?.errors ?? [])].map((error) => (
              <p key={error} className="text-sm text-destructive">
                {error}
              </p>
            ))}
            {targetErrors.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm">
                <span className="text-destructive">
                  {targetErrors.size} {targetErrors.size === 1 ? "account" : "accounts"} can't take
                  this post — fix them above or leave them out.
                </span>
                <Button variant="outline" size="sm" onClick={deselectInvalid}>
                  Deselect invalid accounts
                </Button>
              </div>
            )}

            <Button className="self-start" disabled={!canSubmit} onClick={submit}>
              {submitLabel}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TargetSettingsPanel({
  account,
  settings,
  onChange,
  captionLimit,
  errors,
  kind,
}: {
  account: Account;
  settings: TargetSettings;
  onChange: (patch: Partial<TargetSettings>) => void;
  captionLimit: number | undefined;
  errors: string[];
  kind: ContentKind;
}) {
  const isYouTube = account.platform === "YOUTUBE";
  const id = account.id;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3",
        errors.length > 0 && "border-destructive/60",
      )}
    >
      <div className="text-sm">
        <span className="font-medium">{PLATFORM_LABELS[account.platform]}</span> ·{" "}
        {account.accountName}
        {account.platform === "INSTAGRAM" && kind === "VIDEO" && (
          <span className="text-xs text-muted-foreground"> — {MEDIA_TYPE_LABELS.REELS}</span>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={settings.overrideCaption}
          onChange={(e) => onChange({ overrideCaption: e.target.checked })}
        />
        {isYouTube ? "Use a different description" : "Use a different caption"}
      </label>
      {settings.overrideCaption && (
        <div className="flex flex-col gap-1">
          <Textarea
            value={settings.caption}
            onChange={(e) => onChange({ caption: e.target.value })}
            rows={3}
          />
          {captionLimit && (
            <p className="text-xs text-muted-foreground">
              {captionLength(settings.caption.trim())}/{captionLimit}
            </p>
          )}
        </div>
      )}

      {isYouTube && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={`${id}-title`}>Video title</Label>
            <Input
              id={`${id}-title`}
              value={settings.youtubeTitle}
              maxLength={YOUTUBE_TITLE_MAX}
              onChange={(e) => onChange({ youtubeTitle: e.target.value })}
              placeholder="What's this video about?"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-format`}>Format</Label>
            <Select
              value={settings.youtubeMediaType}
              onValueChange={(value) => onChange({ youtubeMediaType: value as "VIDEO" | "SHORTS" })}
            >
              <SelectTrigger id={`${id}-format`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VIDEO">Video</SelectItem>
                <SelectItem value="SHORTS">Short (vertical or square, ≤3 min)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-privacy`}>Visibility</Label>
            <Select
              value={settings.youtubePrivacy}
              onValueChange={(value) =>
                onChange({ youtubePrivacy: value as TargetSettings["youtubePrivacy"] })
              }
            >
              <SelectTrigger id={`${id}-privacy`}>
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
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-category`}>Category</Label>
            <Select
              value={settings.youtubeCategoryId}
              onValueChange={(value) =>
                onChange({ youtubeCategoryId: value as TargetSettings["youtubeCategoryId"] })
              }
            >
              <SelectTrigger id={`${id}-category`}>
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
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-kids`}>Made for kids?</Label>
            <Select
              value={settings.youtubeMadeForKids ? "yes" : "no"}
              onValueChange={(value) => onChange({ youtubeMadeForKids: value === "yes" })}
            >
              <SelectTrigger id={`${id}-kids`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No, it's not made for kids</SelectItem>
                <SelectItem value="yes">Yes, it's made for kids</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={`${id}-tags`}>Tags (optional, comma-separated)</Label>
            <Input
              id={`${id}-tags`}
              value={settings.youtubeTags}
              onChange={(e) => onChange({ youtubeTags: e.target.value })}
              placeholder="tutorial, product launch"
            />
          </div>
        </div>
      )}

      {errors.map((error) => (
        <p key={error} className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </div>
  );
}
