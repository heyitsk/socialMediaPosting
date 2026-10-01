import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { prisma } from "../db/client";
import { isPostablePlatform } from "../lib/capabilities";
import type { WorkspaceEnv } from "../middleware/auth";
import { type AccountUsage, accountUsage } from "../service/posting-limits";
import { platformSchema } from "./post-schemas";
import { workspaceParamsSchema } from "./workspace-params";

const postingLimitSchema = z
  .object({
    connectedAccountId: z.string(),
    platform: platformSchema,
    // What `used` and `cap` count: posts, or API calls (LinkedIn).
    unit: z.enum(["posts", "calls"]),
    // Sent in the current window.
    used: z.number(),
    // Booked to go out later.
    upcoming: z.number(),
    cap: z.number(),
    // ROLLING_24H: the last 24 hours. UTC_DAY / PACIFIC_DAY: since midnight there.
    window: z.enum(["ROLLING_24H", "UTC_DAY", "PACIFIC_DAY"]),
    // When the count goes down: the next midnight, or when the oldest send
    // leaves the last 24 h. Null if nothing's been sent.
    resetsAt: z.iso.datetime().nullable(),
    // Earliest a simple post (text, one image) could go out now. Null if not
    // within a week.
    nextFreeAt: z.iso.datetime().nullable(),
    cooldown: z
      .object({
        until: z.iso.datetime(),
        reason: z.enum(["ABUSE_BLOCK", "RATE_LIMIT", "QUOTA"]),
        message: z.string(),
      })
      .nullable(),
  })
  .openapi("PostingLimit");

const listPostingLimits = createRoute({
  method: "get",
  path: "/",
  tags: ["Posts"],
  summary: "Each connected account's posting limit usage and pause (websitePlan.md §13.8)",
  request: { params: workspaceParamsSchema },
  responses: {
    200: {
      description: "One entry per connected account on a platform we post to",
      content: { "application/json": { schema: z.array(postingLimitSchema) } },
    },
  },
});

export const postingLimitsRoute = new OpenAPIHono<WorkspaceEnv>().openapi(
  listPostingLimits,
  async (c) => {
    const accounts = await prisma.connectedAccount.findMany({
      where: { workspaceId: c.var.workspaceId, disconnectedAt: null },
      select: { id: true, platform: true, platformAccountId: true },
      orderBy: { id: "asc" },
    });

    // Two connections of one account (Instagram via a Page and via Instagram
    // Login) share a budget — look it up once.
    const now = new Date();
    const usages = new Map<string, Promise<AccountUsage>>();
    const rows = await Promise.all(
      accounts.map(async (account) => {
        const { platform } = account;
        if (!isPostablePlatform(platform)) return null;
        const key = `${platform}:${account.platformAccountId}`;
        let usage = usages.get(key);
        if (!usage) {
          usage = accountUsage(platform, account.platformAccountId, now);
          usages.set(key, usage);
        }
        const { used, upcoming, cap, window, resetsAt, nextFreeAt, cooldown } = await usage;
        return {
          connectedAccountId: account.id,
          platform,
          unit: platform === "LINKEDIN" ? ("calls" as const) : ("posts" as const),
          used,
          upcoming,
          cap,
          window,
          resetsAt: resetsAt?.toISOString() ?? null,
          nextFreeAt: nextFreeAt?.toISOString() ?? null,
          cooldown: cooldown
            ? {
                until: cooldown.until.toISOString(),
                reason: cooldown.reason,
                message: cooldown.message,
              }
            : null,
        };
      }),
    );
    return c.json(
      rows.filter((row) => row !== null),
      200,
    );
  },
);
