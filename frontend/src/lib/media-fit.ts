import type { MediaItem } from "@/components/media-picker";
import type { components } from "@/lib/api-schema";
import { isVideoFile } from "@/lib/media-upload";
import { ratioWithin, type SurfaceFit } from "@/lib/posting";

// How the composer fits media to each platform (websitePlan.md §12.6). A
// tile — one platform + media type, or one account customized on its own —
// has one fit: send the files as they are, crop them, or pad them onto a
// blurred background, at one shape for every file (Instagram shows a whole
// carousel at one shape anyway). Only the region kept differs per file.
// The backend renders exactly what this describes.

export type FitMode = "ORIGINAL" | "CROP" | "PAD";

// Fractions (0-1) of the file as displayed.
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileFit {
  mode: FitMode;
  // width / height, one of the surface's presets.
  ratio: number;
  // CROP: the region kept, by MediaItem.localId. A file without one uses
  // the largest centred region.
  rects: Record<string, Rect>;
}

export type MediaFitInput = NonNullable<
  components["schemas"]["CreatePostGroupRequest"]["targets"][number]["mediaFits"]
>[number];

export const sameRatio = (a: number, b: number) => ratioWithin(a, { min: b, max: b });

export function itemRatio(item: MediaItem): number | null {
  return item.shape ? item.shape.width / item.shape.height : null;
}

// The largest region of `ratio` centred in a file of `sourceRatio`.
export function centredRect(sourceRatio: number, ratio: number): Rect {
  if (sourceRatio > ratio) {
    const w = ratio / sourceRatio;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = sourceRatio / ratio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

const FULL_SCREEN = 9 / 16;

// Stories/Reels images that aren't 9:16 start out padded — cropping a wide
// photo to 9:16 loses most of it (§12.9). Everything else starts as is; a
// shape a platform refuses is flagged and the user picks crop or pad.
export function defaultTileFit(surface: SurfaceFit, items: MediaItem[]): TileFit {
  const [preset = 1] = surface.presets;
  const fullScreenImages =
    surface.presets.length === 1 &&
    sameRatio(preset, FULL_SCREEN) &&
    items.length > 0 &&
    items.every((item) => !isVideoFile(item.file));
  const offShape = items.some((item) => {
    const ratio = itemRatio(item);
    return ratio !== null && !sameRatio(ratio, preset);
  });
  return { mode: fullScreenImages && offShape ? "PAD" : "ORIGINAL", ratio: preset, rects: {} };
}

export function rectFor(fit: TileFit, item: MediaItem): Rect | null {
  const ratio = itemRatio(item);
  if (ratio === null) return null;
  return fit.rects[item.localId] ?? centredRect(ratio, fit.ratio);
}

// The shape a file is sent at; null while its size is unknown.
export function effectiveRatio(fit: TileFit, item: MediaItem): number | null {
  const ratio = itemRatio(item);
  if (ratio === null) return null;
  return fit.mode === "ORIGINAL" ? ratio : fit.ratio;
}

// What the backend needs to render this tile's files. Skips files the fit
// wouldn't change.
export function mediaFitsFor(fit: TileFit, items: MediaItem[]): MediaFitInput[] {
  if (fit.mode === "ORIGINAL") return [];
  return items.flatMap((item): MediaFitInput[] => {
    const ratio = itemRatio(item);
    if (!item.assetId || ratio === null) return [];
    if (fit.mode === "PAD") {
      return sameRatio(ratio, fit.ratio)
        ? []
        : [{ mediaAssetId: item.assetId, mode: "PAD", ratio: fit.ratio }];
    }
    const rect = rectFor(fit, item);
    if (!rect || (sameRatio(ratio, fit.ratio) && rect.w > 0.995 && rect.h > 0.995)) return [];
    return [{ mediaAssetId: item.assetId, mode: "CROP", ratio: fit.ratio, rect }];
  });
}
