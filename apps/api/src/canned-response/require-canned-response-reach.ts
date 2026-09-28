import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

/**
 * `PATCH|DELETE /api/canned-responses/{id}` middleware -- resolves the row's own
 * `workspace_id` by a genuine DB lookup and requires membership in it. Local middleware,
 * not an addition to `workspace-access-middleware.ts`'s closed `resource` union -- same
 * partition-by-file reasoning `work-item/require-comment-reach.ts` gives for its own
 * local middleware. Missing row and out-of-reach row both answer 404 (issue #290's
 * precedent).
 */
export function requireCannedResponseReach(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const id = c.req.param(idKey);
    if (!id) {
      throw new HTTPException(400, { message: "Missing canned response id" });
    }
    rejectNulByte(id, "Canned response id");

    const [row] = await db
      .select({ workspaceId: schema.cannedResponseTable.workspaceId })
      .from(schema.cannedResponseTable)
      .where(eq(schema.cannedResponseTable.id, id))
      .limit(1);

    if (!row) {
      throw new HTTPException(404, { message: "Canned response not found" });
    }

    const apiKey = c.get("apiKey");
    try {
      await validateWorkspaceAccess(userId, row.workspaceId, apiKey?.id);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        throw new HTTPException(404, { message: "Canned response not found" });
      }
      throw error;
    }

    c.set("workspaceId", row.workspaceId);
    return next();
  };
}
