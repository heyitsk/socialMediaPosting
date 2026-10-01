import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { FramePreview, type PreviewTile } from "@/components/media-fit-preview";
import type { MediaItem } from "@/components/media-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type FitMode, itemRatio, type Rect, rectFor, type TileFit } from "@/lib/media-fit";
import { isVideoFile } from "@/lib/media-upload";
import { formatRatio, MEDIA_TYPE_LABELS, PLATFORM_LABELS } from "@/lib/posting";
import { trackEvent } from "@/lib/telemetry";
import { cn } from "@/lib/utils";

// Adjusts one preview tile (websitePlan.md §12.6): send as is, crop, or pad
// onto a blurred background, at one of the platform's shapes. A carousel
// shares the shape; the crop position is set per file.

const MODES: { mode: FitMode; label: string; hint: string }[] = [
  { mode: "ORIGINAL", label: "As uploaded", hint: "The platform shows it its own way" },
  { mode: "CROP", label: "Crop", hint: "Keep the part you choose" },
  { mode: "PAD", label: "Blur-pad", hint: "Whole picture on a blurred background" },
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// react-easy-crop reports percentages of the file as displayed.
const toRect = (area: Area): Rect => ({
  x: clamp01(area.x / 100),
  y: clamp01(area.y / 100),
  w: clamp01(area.width / 100),
  h: clamp01(area.height / 100),
});

const toArea = (rect: Rect): Area => ({
  x: rect.x * 100,
  y: rect.y * 100,
  width: rect.w * 100,
  height: rect.h * 100,
});

export function MediaFitDialog({
  tile,
  items,
  onSave,
  onClose,
}: {
  tile: PreviewTile;
  items: MediaItem[];
  onSave: (fit: TileFit) => void;
  onClose: () => void;
}) {
  const { surface } = tile;
  const [draft, setDraft] = useState<TileFit>(tile.fit);
  const [activeId, setActiveId] = useState(items[0]?.localId ?? "");
  const active = items.find((item) => item.localId === activeId) ?? items[0];
  // react-easy-crop's own view state; the result lives in draft.rects.
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const chooseItem = (item: MediaItem) => {
    setActiveId(item.localId);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };
  const chooseMode = (mode: FitMode) => setDraft((fit) => ({ ...fit, mode }));
  // Every file's crop was drawn for the old shape — start them over.
  const chooseRatio = (ratio: number) => {
    setDraft((fit) => ({ ...fit, ratio, rects: {} }));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const accountNames = tile.accounts.map((account) => account.name).join(", ");
  const initialRect = active ? rectFor(draft, active) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {PLATFORM_LABELS[surface.platform]} · {MEDIA_TYPE_LABELS[surface.mediaType]}
          </DialogTitle>
          <DialogDescription>
            For {accountNames}. The file you uploaded isn't changed — other platforms keep their own
            settings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => chooseMode(option.mode)}
                className={cn(
                  "flex flex-col items-start rounded-lg border p-2.5 text-left text-sm transition-colors hover:bg-muted",
                  draft.mode === option.mode && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </button>
            ))}
          </div>

          {draft.mode !== "ORIGINAL" && surface.presets.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Shape</span>
              {surface.presets.map((ratio) => (
                <Button
                  key={ratio}
                  type="button"
                  size="sm"
                  variant={ratio === draft.ratio ? "default" : "outline"}
                  onClick={() => chooseRatio(ratio)}
                >
                  {formatRatio(ratio)}
                </Button>
              ))}
            </div>
          )}

          {items.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {items.map((item, index) => (
                <button
                  key={item.localId}
                  type="button"
                  onClick={() => chooseItem(item)}
                  className={cn(
                    "relative size-14 shrink-0 overflow-hidden rounded-md border-2",
                    item.localId === active?.localId ? "border-primary" : "border-transparent",
                  )}
                  aria-label={`Adjust file ${index + 1}`}
                >
                  {isVideoFile(item.file) ? (
                    <video src={item.previewUrl} muted className="size-full object-cover" />
                  ) : (
                    <img src={item.previewUrl} alt="" className="size-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}

          {active && (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {draft.mode === "CROP" && initialRect && itemRatio(active) !== null ? (
                  <>
                    <div className="relative h-80 overflow-hidden rounded-md bg-black">
                      <Cropper
                        // Remount per file and shape so the saved crop is restored.
                        key={`${active.localId}:${draft.ratio}`}
                        {...(isVideoFile(active.file)
                          ? { video: active.previewUrl }
                          : { image: active.previewUrl })}
                        aspect={draft.ratio}
                        crop={crop}
                        zoom={zoom}
                        maxZoom={4}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        initialCroppedAreaPercentages={toArea(initialRect)}
                        onCropComplete={(area) =>
                          setDraft((fit) => ({
                            ...fit,
                            rects: { ...fit.rects, [active.localId]: toRect(area) },
                          }))
                        }
                      />
                    </div>
                    <label className="flex items-center gap-3 text-xs text-muted-foreground">
                      Zoom
                      <input
                        type="range"
                        min={1}
                        max={4}
                        step={0.01}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">Drag to move, scroll to zoom.</p>
                  </>
                ) : (
                  <div className="flex h-80 items-center justify-center rounded-md bg-muted/40">
                    <FramePreview surface={surface} fit={draft} item={active} height={300} />
                  </div>
                )}
              </div>
              {draft.mode === "CROP" && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    On {PLATFORM_LABELS[surface.platform]}
                  </span>
                  <FramePreview surface={surface} fit={draft} item={active} height={220} />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              trackEvent("media_fit_applied", { mode: draft.mode });
              onSave(draft);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
