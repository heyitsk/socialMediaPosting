import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import type { MediaItem } from "@/components/media-picker";
import { PlatformMark } from "@/components/platform-mark";
import { isVideoFile } from "@/lib/media-upload";
import {
  formatRatio,
  MEDIA_TYPE_LABELS,
  PLATFORM_LABELS,
  ratioWithin,
  type SurfaceFit,
} from "@/lib/posting";
import { cn } from "@/lib/utils";

// Read-only per-platform previews (websitePlan.md §12.6, build step 1): how
// each selected platform + media type will show the picked files, from their
// dimensions alone — the local file shown through CSS, no pixels read. The
// backend rejects the same shapes marked "rejected" here.

export interface PreviewSurface {
  fit: SurfaceFit;
  accountNames: string[];
}

type Verdict = "fits" | "letterboxed" | "cropped" | "rejected";

// Worst first, for the tile's summary.
const VERDICT_ORDER: Verdict[] = ["rejected", "cropped", "letterboxed", "fits"];

interface ItemView {
  item: MediaItem;
  // null while the file's dimensions are still being read.
  ratio: number | null;
  // The shape the platform shows it at.
  frameRatio: number;
  verdict: Verdict;
}

const FRAME_HEIGHT = 180;

const clamp = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, value));

function viewItems(fit: SurfaceFit, items: MediaItem[]): ItemView[] {
  const views = items.map((item): ItemView => {
    const ratio = item.shape ? item.shape.width / item.shape.height : null;
    if (ratio === null) return { item, ratio, frameRatio: fit.display.min, verdict: "fits" };
    const frameRatio = clamp(ratio, fit.display);
    let verdict: Verdict = "fits";
    if (fit.accepted && !ratioWithin(ratio, fit.accepted)) verdict = "rejected";
    else if (!ratioWithin(ratio, fit.display))
      verdict = fit.beyond === "CROP" ? "cropped" : "letterboxed";
    return { item, ratio, frameRatio, verdict };
  });

  // Instagram shows every carousel item at the first one's shape.
  const first = views[0];
  if (!fit.carouselUsesFirstRatio || !first || first.ratio === null) return views;
  return views.map((view) => {
    if (view === first || view.ratio === null) return view;
    const differs = !ratioWithin(view.ratio, { min: first.frameRatio, max: first.frameRatio });
    return {
      ...view,
      frameRatio: first.frameRatio,
      verdict: view.verdict === "rejected" || !differs ? view.verdict : "cropped",
    };
  });
}

function summary(fit: SurfaceFit, views: ItemView[]): { verdict: Verdict; message: string } {
  const label = PLATFORM_LABELS[fit.platform];
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
        message: `${label} rejects ${which} — it only takes ${formatRatio(fit.accepted?.min ?? 0)} to ${formatRatio(fit.accepted?.max ?? 0)}`,
      };
    case "cropped":
      if (fit.carouselUsesFirstRatio && many) {
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
        message: `${label} shows ${which} at ${formatRatio(fit.display.min)} with bars around it`,
      };
    case "fits":
      return { verdict, message: `Fits ${label} as is` };
  }
}

const VERDICT_STYLE: Record<Verdict, { icon: typeof CircleCheck; className: string }> = {
  fits: { icon: CircleCheck, className: "text-emerald-700 dark:text-emerald-400" },
  letterboxed: { icon: CircleAlert, className: "text-amber-700 dark:text-amber-400" },
  cropped: { icon: CircleAlert, className: "text-amber-700 dark:text-amber-400" },
  rejected: { icon: CircleX, className: "text-destructive" },
};

function Frame({ view, fit }: { view: ItemView; fit: SurfaceFit }) {
  const { item, frameRatio, verdict } = view;
  const media = cn(
    "size-full",
    verdict === "letterboxed" ? "object-contain" : "object-cover",
    verdict === "rejected" && "opacity-60",
  );
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md bg-black",
        verdict === "rejected" && "ring-2 ring-destructive",
      )}
      style={{ height: FRAME_HEIGHT, aspectRatio: frameRatio }}
      title={
        view.ratio === null
          ? item.file.name
          : `${item.file.name} — ${formatRatio(view.ratio)}, shown at ${formatRatio(frameRatio)}`
      }
    >
      {view.ratio === null ? (
        <div className="flex size-full animate-pulse items-center justify-center bg-muted text-xs text-muted-foreground">
          Reading size…
        </div>
      ) : isVideoFile(item.file) ? (
        <video src={item.previewUrl} preload="metadata" muted playsInline className={media} />
      ) : (
        <img src={item.previewUrl} alt="" className={media} />
      )}
      {fit.safeZone && (
        <>
          <div
            className="pointer-events-none absolute inset-x-0 top-0 border-b border-dashed border-white/80 bg-black/40"
            style={{ height: `${fit.safeZone.top * 100}%` }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-white/80 bg-black/40"
            style={{ height: `${fit.safeZone.bottom * 100}%` }}
          />
        </>
      )}
    </div>
  );
}

export function MediaFitPreview({
  surfaces,
  items,
}: {
  surfaces: PreviewSurface[];
  items: MediaItem[];
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {surfaces.map(({ fit, accountNames }) => {
        const views = viewItems(fit, items);
        const measured = views.every((view) => view.ratio !== null);
        const { verdict, message } = summary(fit, views);
        const { icon: Icon, className } = VERDICT_STYLE[verdict];
        return (
          <div
            key={`${fit.platform}:${fit.mediaType}`}
            className="flex max-w-full flex-col gap-2 rounded-lg border p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <PlatformMark platform={fit.platform} className="size-7 text-[10px]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {PLATFORM_LABELS[fit.platform]} · {MEDIA_TYPE_LABELS[fit.mediaType]}
                </p>
                <p className="max-w-64 truncate text-xs text-muted-foreground">
                  {accountNames.join(", ")}
                </p>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {views.map((view) => (
                <Frame key={view.item.localId} view={view} fit={fit} />
              ))}
            </div>
            {measured && (
              <p className={cn("flex max-w-80 items-start gap-1.5 text-xs", className)}>
                <Icon className="mt-px size-3.5 shrink-0" />
                {message}
              </p>
            )}
            {fit.safeZone && (
              <p className="max-w-80 text-xs text-muted-foreground">
                Shaded: covered by {PLATFORM_LABELS[fit.platform]}'s buttons and caption.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
