import { cn } from "@/lib/utils";

const PLATFORM_VISUALS: Record<string, { mark: string; className: string }> = {
  FACEBOOK: { mark: "f", className: "bg-blue-600/10 text-blue-700 dark:text-blue-300" },
  INSTAGRAM: { mark: "ig", className: "bg-pink-600/10 text-pink-700 dark:text-pink-300" },
  THREADS: { mark: "@", className: "bg-zinc-700/10 text-zinc-700 dark:text-zinc-200" },
  LINKEDIN: { mark: "in", className: "bg-sky-700/10 text-sky-800 dark:text-sky-300" },
  YOUTUBE: { mark: "yt", className: "bg-red-600/10 text-red-700 dark:text-red-300" },
  PINTEREST: { mark: "p", className: "bg-rose-700/10 text-rose-800 dark:text-rose-300" },
};

// Small colored tile with a platform's short mark ("f", "ig", "in"…), used
// wherever an account or target is listed.
export function PlatformMark({ platform, className }: { platform: string; className?: string }) {
  const visual = PLATFORM_VISUALS[platform] ?? {
    mark: platform.slice(0, 2).toLowerCase(),
    className: "bg-muted text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
        visual.className,
        className,
      )}
      aria-hidden="true"
    >
      {visual.mark}
    </span>
  );
}
