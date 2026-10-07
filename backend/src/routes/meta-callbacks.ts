import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { type Context, Hono } from "hono";
import { prisma } from "../db/client";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { parseSignedRequest } from "../lib/meta-signed-request";
import { disconnectedAccountData } from "../service/connected-accounts";

// Meta calls these when a person removes smPosting in Facebook/Instagram/Threads
// settings (deauthorize) or asks Meta to have us delete their data (delete).
// Public — there's no session — and authenticated by the HMAC on the signed
// request, which is why app.ts exempts /api/webhooks/meta from the CSRF check
// (Meta's servers send no Origin header).
//
// One URL pair serves all three Meta products: each product is its own app
// with its own secret, and ?product= picks which one the request must verify
// against. Set them in the Meta dashboard as
//   Facebook Login:  .../api/webhooks/meta/deauthorize?product=facebook (and /delete?...)
//   Instagram Login: .../api/webhooks/meta/deauthorize?product=instagram (and /delete?...)
//   Threads:         .../api/webhooks/meta/deauthorize?product=threads   (and /delete?...)
//
// Both callbacks do the same thing to our data: wipe the matching accounts'
// tokens (the data we hold *from Meta* that lets us act as the person). The
// rest (profile, posts, history) is removed on request via the data-deletion
// page — see the wording on it and the privacy policy.

type Product = "facebook" | "instagram" | "threads";

const PRODUCTS: Record<
  Product,
  { secret: string; accounts: (userId: string) => Prisma.ConnectedAccountWhereInput }
> = {
  // The Page and any Instagram account reached through it, connected by this Facebook user.
  facebook: {
    secret: env.META_APP_SECRET,
    accounts: (userId) => ({ connectionMethod: "FACEBOOK_PAGE", metaUserId: userId }),
  },
  instagram: {
    secret: env.INSTAGRAM_APP_SECRET,
    accounts: (userId) => ({
      platform: "INSTAGRAM",
      connectionMethod: "INSTAGRAM_LOGIN",
      platformAccountId: userId,
    }),
  },
  threads: {
    secret: env.THREADS_APP_SECRET,
    accounts: (userId) => ({
      platform: "THREADS",
      connectionMethod: "THREADS_LOGIN",
      platformAccountId: userId,
    }),
  },
};

function isProduct(value: string | undefined): value is Product {
  return value === "facebook" || value === "instagram" || value === "threads";
}

export const metaCallbacksRoute = new Hono();

// Verifies the request and wipes the matching accounts. Returns null for a bad
// request, else how many accounts it disconnected. An unknown user is a normal
// success (0): they may never have connected, or already disconnected — and
// answering differently would let anyone probe which ids are ours.
async function handle(c: Context, action: "deauthorize" | "delete") {
  const product = c.req.query("product");
  if (!isProduct(product)) return null;

  const body = await c.req.parseBody();
  const signedRequest = body.signed_request;
  if (typeof signedRequest !== "string") return null;

  const userId = parseSignedRequest(signedRequest, PRODUCTS[product].secret);
  if (!userId) return null;

  const result = await prisma.connectedAccount.updateMany({
    where: { ...PRODUCTS[product].accounts(userId), disconnectedAt: null },
    data: disconnectedAccountData(),
  });
  logger.info({ product, action, metaUserId: userId, accounts: result.count }, "Meta callback");
  return { product, count: result.count };
}

metaCallbacksRoute.post("/deauthorize", async (c) => {
  const handled = await handle(c, "deauthorize");
  if (!handled) return c.json({ error: "Invalid request" }, 400);
  return c.body(null, 200);
});

metaCallbacksRoute.post("/delete", async (c) => {
  const handled = await handle(c, "delete");
  if (!handled) return c.json({ error: "Invalid request" }, 400);

  // The page the person can open to see the outcome. Stateless: it shows the
  // code, and the log line above (and the rest of this request's trace) is how
  // we'd match a code someone quotes back to us.
  const confirmationCode = randomBytes(8).toString("hex");
  logger.info({ confirmationCode, product: handled.product }, "Meta data deletion confirmed");
  return c.json({
    url: `${env.FRONTEND_URL}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});
