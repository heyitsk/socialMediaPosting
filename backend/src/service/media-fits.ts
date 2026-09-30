import type { MediaAsset, MediaType } from "@prisma/client";
import {
  formatRatio,
  PLATFORM_NAMES,
  type PostablePlatform,
  ratioWithin,
  surfaceFit,
} from "../lib/capabilities";
import { isVideoType } from "../lib/media-files";
import { type Fit, type Rect, type RenditionSpec, renditionSpec } from "../lib/render";

// Turns one target's crop/pad requests into rendition specs, and works out
// the shape each file will have on that target (websitePlan.md §12.4).

export interface FitInput {
  mediaAssetId: string;
  mode: "CROP" | "PAD";
  ratio: number;
  rect?: Rect;
}

export interface TargetMedia {
  // What this target sends instead of the master, per file that needs one.
  renditions: { asset: MediaAsset; spec: RenditionSpec }[];
  // width / height each file is sent at; null if unknown (uploaded before
  // dimensions were stored and not refitted).
  ratios: Map<string, number | null>;
  errors: string[];
}

// Crops are drawn in the browser on a scaled preview, so allow a little
// more slack than the platforms' own 1%.
const RECT_RATIO_TOLERANCE = 0.02;
const EDGE_SLACK = 0.001;

const sameRatio = (a: number, b: number) => ratioWithin(a, { min: b, max: b });

export function resolveTargetMedia(
  platform: PostablePlatform,
  mediaType: MediaType,
  media: MediaAsset[],
  inputs: FitInput[],
): TargetMedia {
  const errors: string[] = [];
  const surface = surfaceFit(platform, mediaType);
  const name = PLATFORM_NAMES[platform];
  const fits = new Map<string, Fit>();

  for (const input of inputs) {
    const asset = media.find((candidate) => candidate.id === input.mediaAssetId);
    if (!asset) {
      errors.push("A crop was set for a file that isn't in this post");
      continue;
    }
    const file = asset.originalFilename;
    if (!surface) {
      errors.push(`${name} posts of this kind can't be cropped`);
      continue;
    }
    if (!asset.width || !asset.height) {
      errors.push(
        `${file} was uploaded before cropping was available — upload it again to crop it`,
      );
      continue;
    }
    if (fits.has(asset.id)) {
      errors.push(`${file} has two crops for ${name}`);
      continue;
    }
    // Snapped to the preset itself so the rendered size is exact.
    const preset = surface.presets.find((candidate) => sameRatio(input.ratio, candidate));
    if (preset === undefined) {
      errors.push(`${formatRatio(input.ratio)} isn't a shape ${name} offers`);
      continue;
    }
    if (input.mode === "CROP") {
      const rect = input.rect;
      if (
        !rect ||
        rect.w <= 0 ||
        rect.h <= 0 ||
        rect.x < -EDGE_SLACK ||
        rect.y < -EDGE_SLACK ||
        rect.x + rect.w > 1 + EDGE_SLACK ||
        rect.y + rect.h > 1 + EDGE_SLACK
      ) {
        errors.push(`The crop of ${file} is outside the picture — adjust it again`);
        continue;
      }
      const drawn = (rect.w * asset.width) / (rect.h * asset.height);
      if (Math.abs(drawn / preset - 1) > RECT_RATIO_TOLERANCE) {
        errors.push(`The crop of ${file} isn't ${formatRatio(preset)} — adjust it again`);
        continue;
      }
      const clamped = {
        x: Math.max(0, rect.x),
        y: Math.max(0, rect.y),
        w: Math.min(rect.w, 1 - Math.max(0, rect.x)),
        h: Math.min(rect.h, 1 - Math.max(0, rect.y)),
      };
      fits.set(asset.id, { mode: "CROP", ratio: preset, rect: clamped });
    } else {
      fits.set(asset.id, { mode: "PAD", ratio: preset });
    }
  }

  const renditions: TargetMedia["renditions"] = [];
  const ratios = new Map<string, number | null>();
  for (const asset of media) {
    const own = asset.width && asset.height ? asset.width / asset.height : null;
    let fit = fits.get(asset.id) ?? null;
    // A pad to the file's own shape, or a crop of the whole of it, is a no-op.
    if (
      fit &&
      own !== null &&
      sameRatio(own, fit.ratio) &&
      (fit.mode === "PAD" || (fit.rect && fit.rect.w > 0.995 && fit.rect.h > 0.995))
    ) {
      fit = null;
    }
    ratios.set(asset.id, fit ? fit.ratio : own);

    // Instagram's publishing API takes JPEG images only, so anything else is
    // converted — a crop or pad already comes out as JPEG.
    const needsJpeg =
      platform === "INSTAGRAM" &&
      !isVideoType(asset.contentType) &&
      asset.contentType !== "image/jpeg";
    if (!fit && !needsJpeg) continue;
    if (!asset.width || !asset.height) {
      errors.push(
        `Instagram only accepts JPEG images — upload ${asset.originalFilename} again so it can be converted`,
      );
      continue;
    }
    renditions.push({
      asset,
      spec: renditionSpec(
        { width: asset.width, height: asset.height, contentType: asset.contentType },
        fit,
      ),
    });
  }

  // Shapes the publishing API refuses outright (websitePlan.md §12.2), after
  // any crop or pad.
  const accepted = surface?.accepted;
  if (accepted) {
    const outside = media.flatMap((asset) => {
      const ratio = ratios.get(asset.id);
      return ratio != null && !ratioWithin(ratio, accepted)
        ? [`${asset.originalFilename} is ${formatRatio(ratio)}`]
        : [];
    });
    if (outside.length > 0) {
      const noun = media.some((asset) => isVideoType(asset.contentType)) ? "videos" : "images";
      errors.push(
        `${name} only takes ${formatRatio(accepted.min)} to ${formatRatio(accepted.max)} ${noun} — ${outside.join(", ")}. Crop or pad it for ${name}`,
      );
    }
  }

  return { renditions, ratios, errors };
}
