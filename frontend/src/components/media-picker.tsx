import { ArrowDown, ArrowUp, RotateCw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  contentTypeOf,
  discardMedia,
  fileProblem,
  formatBytes,
  IMAGE_ACCEPT,
  isVideoFile,
  uploadMedia,
  VIDEO_ACCEPT,
} from "@/lib/media-upload";
import { cn } from "@/lib/utils";

// The backend's per-post cap (routes/post-groups.ts); platforms' own carousel
// limits are checked per account in the composer.
const MAX_FILES = 20;

export interface MediaItem {
  localId: string;
  file: File;
  contentType: string;
  // Object URL for the thumbnail and the in-browser Shorts check.
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  // 0-1.
  progress: number;
  assetId: string | null;
  error: string | null;
  controller: AbortController;
}

// Each file starts uploading as soon as it's picked, so it's usually done by
// the time the caption is written.
export function useMediaUploads(workspaceId: string) {
  const [items, setItems] = useState<MediaItem[]>([]);
  // For the unmount cleanup, which can't see the latest state.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = useCallback(
    (localId: string, patch: Partial<MediaItem>) =>
      setItems((all) =>
        all.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
      ),
    [],
  );

  const start = useCallback(
    (item: MediaItem) => {
      uploadMedia(
        workspaceId,
        item.file,
        (progress) => update(item.localId, { progress }),
        item.controller.signal,
        (assetId) => update(item.localId, { assetId }),
      )
        .then((asset) => update(item.localId, { status: "ready", progress: 1, assetId: asset.id }))
        .catch((err) => {
          if (item.controller.signal.aborted) return;
          update(item.localId, {
            status: "error",
            error: err instanceof Error ? err.message : "Upload failed",
          });
        });
    },
    [workspaceId, update],
  );

  // Stops the upload and deletes whatever reached S3. Files already in a post
  // are only forgotten (see clear).
  const discard = useCallback(
    (item: MediaItem) => {
      item.controller.abort();
      URL.revokeObjectURL(item.previewUrl);
      if (item.assetId) void discardMedia(workspaceId, item.assetId);
    },
    [workspaceId],
  );

  // single: the post takes one file, so a new pick replaces the old one.
  function add(files: File[], { video, single }: { video: boolean; single: boolean }) {
    const accepted: MediaItem[] = [];
    for (const file of single ? files.slice(0, 1) : files) {
      const problem = fileProblem(file, video);
      if (problem) {
        toast.error(problem);
        continue;
      }
      accepted.push({
        localId: crypto.randomUUID(),
        file,
        contentType: contentTypeOf(file),
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        progress: 0,
        assetId: null,
        error: null,
        controller: new AbortController(),
      });
    }
    const kept = single && accepted.length > 0 ? [] : items;
    if (single && accepted.length > 0) for (const item of items) discard(item);
    const room = MAX_FILES - kept.length;
    if (accepted.length > room) {
      toast.error(`A post can have at most ${MAX_FILES} files`);
      for (const item of accepted.splice(room)) URL.revokeObjectURL(item.previewUrl);
    }
    for (const item of accepted) start(item);
    setItems([...kept, ...accepted]);
  }

  function remove(item: MediaItem) {
    discard(item);
    setItems((all) => all.filter((other) => other.localId !== item.localId));
  }

  function retry(item: MediaItem) {
    if (item.assetId) void discardMedia(workspaceId, item.assetId);
    const fresh: MediaItem = {
      ...item,
      status: "uploading",
      progress: 0,
      assetId: null,
      error: null,
      controller: new AbortController(),
    };
    setItems((all) => all.map((other) => (other.localId === item.localId ? fresh : other)));
    start(fresh);
  }

  function move(item: MediaItem, offset: -1 | 1) {
    setItems((all) => {
      const from = all.findIndex((other) => other.localId === item.localId);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= all.length) return all;
      const next = [...all];
      [next[from], next[to]] = [next[to] as MediaItem, next[from] as MediaItem];
      return next;
    });
  }

  // Drops files that no longer fit the post (kind changed), deleting them.
  function keepOnly(predicate: (item: MediaItem, index: number) => boolean) {
    const dropped = items.filter((item, index) => !predicate(item, index));
    if (dropped.length === 0) return;
    for (const item of dropped) discard(item);
    setItems(items.filter(predicate));
  }

  // After a successful post: the files now belong to it, so only let go of
  // the previews.
  function clear() {
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
    setItems([]);
  }

  // Leaving the page cancels uploads still running. Finished but unused files
  // are removed by the backend's cleaner after a day.
  useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        item.controller.abort();
        URL.revokeObjectURL(item.previewUrl);
      }
    },
    [],
  );

  return { items, add, remove, retry, move, keepOnly, clear };
}

interface MediaPickerProps {
  items: MediaItem[];
  video: boolean;
  multiple: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (item: MediaItem) => void;
  onRetry: (item: MediaItem) => void;
  onMove: (item: MediaItem, offset: -1 | 1) => void;
}

export function MediaPicker({
  items,
  video,
  multiple,
  onAdd,
  onRemove,
  onRetry,
  onMove,
}: MediaPickerProps) {
  const [dragging, setDragging] = useState(false);
  const noun = video ? "video" : multiple ? "images" : "image";

  return (
    <div className="flex flex-col gap-2">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onAdd([...e.dataTransfer.files]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-6 text-center text-sm transition-colors hover:bg-muted",
          dragging && "border-primary bg-muted",
        )}
      >
        <Upload className="size-5 text-muted-foreground" />
        <span className="font-medium">
          {items.length > 0 && !multiple ? `Replace the ${noun}` : `Choose ${noun}`} or drop{" "}
          {multiple ? "them" : "it"} here
        </span>
        <span className="text-xs text-muted-foreground">
          {video ? "MP4 or MOV, up to 1 GB" : "JPEG, PNG or WebP, up to 8 MB each"}
        </span>
        <input
          type="file"
          className="sr-only"
          accept={video ? VIDEO_ACCEPT : IMAGE_ACCEPT}
          multiple={multiple}
          onChange={(e) => {
            onAdd([...(e.target.files ?? [])]);
            // Picking the same file again should still fire onChange.
            e.target.value = "";
          }}
        />
      </label>

      {items.map((item, index) => (
        <div key={item.localId} className="flex items-center gap-3 rounded-md border p-2">
          {isVideoFile(item.file) ? (
            <video
              src={item.previewUrl}
              preload="metadata"
              muted
              className="size-14 shrink-0 rounded bg-muted object-cover"
            />
          ) : (
            <img
              src={item.previewUrl}
              alt=""
              className="size-14 shrink-0 rounded bg-muted object-cover"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm">
              {multiple && `${index + 1}. `}
              {item.file.name}
            </span>
            {item.status === "error" ? (
              <span className="text-xs text-destructive">{item.error}</span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {formatBytes(item.file.size)}
                {item.status === "uploading"
                  ? ` · uploading ${Math.floor(item.progress * 100)}%`
                  : " · uploaded"}
              </span>
            )}
            {item.status === "uploading" && (
              <div className="h-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${item.progress * 100}%` }}
                />
              </div>
            )}
          </div>
          {multiple && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => onMove(item, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move down"
                disabled={index === items.length - 1}
                onClick={() => onMove(item, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
            </>
          )}
          {item.status === "error" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Retry upload"
              onClick={() => onRetry(item)}
            >
              <RotateCw className="size-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove"
            onClick={() => onRemove(item)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
