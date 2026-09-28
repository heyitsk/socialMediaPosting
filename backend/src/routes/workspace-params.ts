import { z } from "@hono/zod-openapi";

// Path param shared by every route mounted under /api/workspaces/:workspaceId.
// Membership itself is enforced by requireWorkspace, not by this schema —
// it's here so the OpenAPI doc (and the generated frontend client) knows
// about the param.
export const workspaceParamsSchema = z.object({
  workspaceId: z.string().openapi({ param: { name: "workspaceId", in: "path" } }),
});
