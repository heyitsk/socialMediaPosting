import { CircleAlert, CircleCheck, CircleX, Crop } from "lucide-react";
import type { CSSProperties } from "react";
import type { MediaItem } from "@/components/media-picker";
import { PlatformMark } from "@/components/platform-mark";
import { Button } from "@/components/ui/button";
import { effectiveRatio, type Rect, rectFor, sameRatio, type TileFit } from "@/lib/media-fit";
import { isVideoFile } from "@/lib/media-upload";
import {
  formatRatio,
  MEDIA_TYPE_LABELS,
  PLATFORM_LABELS,
  ratioWithin,
  type SurfaceFit,
} from "@/lib/posting";
import { cn } from "@/lib/utils";

// Per-platform previews (websitePlan.md §12.6): how each selected platform +
// media type will show the files — as uploaded, or cropped/padded the way
// the tile's fit says. CSS only (the local file, no pixels read); the
// backend renders the same crop and pad for real.

export interface PreviewTile {
  key: string;
  surface: SurfaceFit;
  fit: TileFit;
  accounts: { id: string; name: string }[];
  // One account split off from its platform's shared tile.
  customized: boolean;
}

type Verdict = "fits" | "adjusted" | "letterboxed" | "cropped" | "rejected";

// Worst first, for the tile's summary.
const VERDICT_ORDER: Verdict[] = ["rejected", "cropped", "letterboxed", "adjusted", "fits"];

interface ItemView {
  item: MediaItem;
  // null while the file's size is still being read.
  ratio: number | null;
  // The shape the platform shows it at.
  frameRatio: number;
  verdict: Verdict;
}

const clamp = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, value));

function viewItems(surface: SurfaceFit, fit: TileFit, items: MediaItem[]): ItemView[] {
  const views = items.map((item): ItemView => {
    const ratio = effectiveRatio(fit, item);
    if (ratio === null) return { item, ratio, frameRatio: surface.display.min, verdict: "fits" };
    const frameRatio = clamp(ratio, surface.display);
    let verdict: Verdict = fit.mode === "ORIGINAL" ? "fits" : "adjusted";
    if (surface.accepted && !ratioWithin(ratio, surface.accepted)) verdict = "rejected";
    else if (!ratioWithin(ratio, surface.display))
      verdict = surface.beyond === "CROP" ? "cropped" : "letterboxed";
    return { item, ratio, frameRatio, verdict };
  });

  // Instagram shows every carousel item at the first one's shape.
  const first = views[0];
  if (!surface.carouselUsesFirstRatio || !first || first.ratio === null) return views;
  return views.map((view) => {
    if (view === first || view.ratio === null) return view;
    const differs = !sameRatio(view.ratio, first.frameRatio);
    return {
      ...view,
      frameRatio: first.frameRatio,
      verdict: view.verdict === "rejected" || !differs ? view.verdict : "cropped",
    };
  });
}

function summary(
  surface: SurfaceFit,
  fit: TileFit,
  views: ItemView[],
): { verdict: Verdict; message: string } {
  const label = PLATFORM_LABELS[surface.platform];
  const verdict = VERDICT_ORDER.find((candidate) =>
    views.some((view) => view.verdict === candidate),
  ) as Verdict;
  const affected = views.filter((view) => view.verdict === verdict);
  const many = views.length > 1;
  const which = many ? `${affected.length} of these` : "this";
  switch (verdict) {
    case "rejected":
      return {
        verdict,
        message: `${label} rejects ${which} — it only takes ${formatRatio(surface.accepted?.min ?? 0)} to ${formatRatio(surface.accepted?.max ?? 0)}. Crop or pad it`,
      };
    case "cropped":
      if (surface.carouselUsesFirstRatio && many) {
        return {
          verdict,
          message: `${label} shows every image at the first one's shape (${formatRatio(views[0]?.frameRatio ?? 1)}) — ${affected.length} will be cropped`,
        };
      }
      return {
        verdict,
        message: many
          ? `${label} crops ${which} to fit`
          : `${label} crops this to ${formatRatio(affected[0]?.frameRatio ?? 1)}`,
      };
    case "letterboxed":
      return {
        verdict,
        message: `${label} shows ${which} at ${formatRatio(surface.display.min)} with bars around it`,
      };
    case "adjusted":
      return {
        verdict,
        message:
          fit.mode === "PAD"
            ? `Padded to ${formatRatio(fit.ratio)} on a blurred background`
            : `Cropped to ${formatRatio(fit.ratio)}`,
      };
    case "fits":
      return { verdict, message: `Fits ${label} as is` };
  }
}

const VERDICT_STYLE: Record<Verdict, { icon: typeof CircleCheck; className: string }> = {
  fits: { icon: CircleCheck, className: "text-emerald-700 dark:text-emerald-400" },
  adjusted: { icon: CircleCheck, className: "text-emerald-700 dark:text-emerald-400" },
  letterboxed: { icon: CircleAlert, className: "text-amber-700 dark:text-amber-400" },
  cropped: { icon: CircleAlert, className: "text-amber-700 dark:text-amber-400" },
  rejected: { icon: CircleX, className: "text-destructive" },
};

function MediaElement({
  item,
  className,
  style,
}: {
  item: MediaItem;
  className?: string;
  style?: CSSProperties;
}) {
  return isVideoFile(item.file) ? (
    <video
      src={item.previewUrl}
      preload="metadata"
      muted
      playsInline
      className={className}
      style={style}
    />
  ) : (
    <img src={item.previewUrl} alt="" className={className} style={style} />
  );
}

// Scales the whole file so that `rect` of it fills the frame. The rect has
// the frame's shape, so nothing is stretched.
const cropStyle = (rect: Rect): CSSProperties => ({
  width: `${100 / rect.w}%`,
  height: `${100 / rect.h}%`,
  left: `${(-rect.x / rect.w) * 100}%`,
  top: `${(-rect.y / rect.h) * 100}%`,
});

const SafeZone = ({ zone }: { zone: NonNullable<SurfaceFit["safeZone"]> }) => (
  <>
    <div
      className="pointer-events-none absolute inset-x-0 top-0 border-b border-dashed border-white/80 bg-black/40"
      style={{ height: `${zone.top * 100}%` }}
    />
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-white/80 bg-black/40"
      style={{ height: `${zone.bottom * 100}%` }}
    />
  </>
);

// One file inside a platform-shaped frame, as that platform will show it.
function Frame({
  view,
  surface,
  fit,
  height,
}: {
  view: ItemView;
  surface: SurfaceFit;
  fit: TileFit;
  height: number;
}) {
  const { item, frameRatio, verdict } = view;
  const rect = fit.mode === "CROP" ? rectFor(fit, item) : null;
  let media: React.ReactNode;
  if (view.ratio === null) {
    media = (
      <div className="flex size-full animate-pulse items-center justify-center bg-muted text-xs text-muted-foreground">
        Reading size…
      </div>
    );
  } else if (rect) {
    media = <MediaElement item={item} className="absolute max-w-none" style={cropStyle(rect)} />;
  } else if (fit.mode === "PAD") {
    media = (
      <>
        <MediaElement
          item={item}
          className="absolute inset-0 size-full scale-110 object-cover blur-xl brightness-75"
        />
        <MediaElement item={item} className="absolute inset-0 size-full object-contain" />
      </>
    );
  } else {
    media = (
      <MediaElement
        item={item}
        className={cn(
          "size-full",
          verdict === "letterboxed" ? "object-contain" : "object-cover",
          verdict === "rejected" && "opacity-60",
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md bg-black",
        verdict === "rejected" && "ring-2 ring-destructive",
      )}
      style={{ height, aspectRatio: frameRatio }}
      title={
        view.ratio === null
          ? item.file.name
          : `${item.file.name} — shown at ${formatRatio(frameRatio)}`
      }
    >
      {media}
      {surface.safeZone && <SafeZone zone={surface.safeZone} />}
    </div>
  );
}

// A single file's frame, for the adjust dialog's live preview.
export function FramePreview({
  surface,
  fit,
  item,
  height,
}: {
  surface: SurfaceFit;
  fit: TileFit;
  item: MediaItem;
  height: number;
}) {
  const [view] = viewItems(surface, fit, [item]);
  return view ? <Frame view={view} surface={surface} fit={fit} height={height} /> : null;
}

// Whether any file on this tile is a shape its platform refuses.
export function tileRejected(tile: PreviewTile, items: MediaItem[]): boolean {
  return viewItems(tile.surface, tile.fit, items).some((view) => view.verdict === "rejected");
}

const FRAME_HEIGHT = 180;

export function MediaFitPreview({
  tiles,
  items,
  onAdjust,
  onCustomize,
  onReset,
}: {
  tiles: PreviewTile[];
  items: MediaItem[];
  onAdjust: (tile: PreviewTile) => void;
  onCustomize: (accountId: string) => void;
  onReset: (accountId: string) => void;
}) {
  const measured = items.every((item) => item.shape !== null);
  return (
    <div className="flex flex-wrap gap-3">
      {tiles.map((tile) => {
        const { surface, fit, accounts } = tile;
        const views = viewItems(surface, fit, items);
        const { verdict, message } = summary(surface, fit, views);
        const { icon: Icon, className } = VERDICT_STYLE[verdict];
        return (
          <div key={tile.key} className="flex max-w-full flex-col gap-2 rounded-lg border p-3">
            <div className="flex min-w-0 items-center gap-2">
              <PlatformMark platform={surface.platform} className="size-7 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {PLATFORM_LABELS[surface.platform]} · {MEDIA_TYPE_LABELS[surface.mediaType]}
                </p>
                <p className="max-w-64 truncate text-xs text-muted-foreground">
                  {accounts.map((account) => account.name).join(", ")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!measured}
                onClick={() => onAdjust(tile)}
              >
                <Crop className="size-3.5" />
                Adjust
              </Button>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {views.map((view) => (
                <Frame
                  key={view.item.localId}
                  view={view}
                  surface={surface}
                  fit={fit}
                  height={FRAME_HEIGHT}
                />
              ))}
            </div>
            {measured && (
              <p className={cn("flex max-w-80 items-start gap-1.5 text-xs", className)}>
                <Icon className="mt-px size-3.5 shrink-0" />
                {message}
              </p>
            )}
            {surface.safeZone && (
              <p className="max-w-80 text-xs text-muted-foreground">
                Shaded: covered by {PLATFORM_LABELS[surface.platform]}'s buttons and caption.
              </p>
            )}
            {tile.customized ? (
              <button
                type="button"
                className="w-fit text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => accounts[0] && onReset(accounts[0].id)}
              >
                Use the same as other {PLATFORM_LABELS[surface.platform]} accounts
              </button>
            ) : (
              accounts.length > 1 && (
                <p className="max-w-80 text-xs text-muted-foreground">
                  Different for one account?{" "}
                  {accounts.map((account, index) => (
                    <span key={account.id}>
                      {index > 0 && " · "}
                      <button
                        type="button"
                        className="underline-offset-2 hover:underline"
                        onClick={() => onCustomize(account.id)}
                      >
                        {account.name}
                      </button>
                    </span>
                  ))}
                </p>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
