import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { components } from "@/lib/api-schema";

// Each connected account's posting limit (websitePlan.md §13): how much of its
// cap is used, when it can post next, and whether it's paused.

export type PostingLimit = components["schemas"]["PostingLimit"];

// The backend lets a post wait this long for its slot before refusing it
// (AUTO_DELAY_MS in backend lib/posting-limits.ts).
export const AUTO_DELAY_MS = 60 * 60_000;

export function usePostingLimits(workspaceId: string) {
  const query = useQuery({
    queryKey: ["posting-limits", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/workspaces/{workspaceId}/posting-limits", {
        params: { path: { workspaceId } },
      });
      if (error) throw error;
      return data;
    },
    // Slots free up and pauses end on their own.
    refetchInterval: 60_000,
  });
  const byAccount = new Map(query.data?.map((limit) => [limit.connectedAccountId, limit]) ?? []);
  return { ...query, byAccount };
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const dayNumber = (date: Date) =>
  Math.floor((date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000);

// "10:05", "tomorrow 09:12", or "Fri 3 Oct, 09:12" — in the browser's timezone.
export function formatWhen(value: string | number | Date, now = new Date()): string {
  const date = new Date(value);
  const days = dayNumber(date) - dayNumber(now);
  if (days === 0) return TIME.format(date);
  if (days === 1) return `tomorrow ${TIME.format(date)}`;
  return DAY_AND_TIME.format(date);
}

export function windowLabel(window: PostingLimit["window"]): string {
  if (window === "ROLLING_24H") return "in the last 24 hours";
  if (window === "UTC_DAY") return "today (resets at midnight UTC)";
  return "today (resets at midnight Pacific time)";
}

// Why the account is paused, for badges and disabled rows.
export function pausedText(limit: PostingLimit): string | null {
  const { cooldown } = limit;
  return cooldown ? `Paused until ${formatWhen(cooldown.until)} — ${cooldown.message}` : null;
}
