import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

/**
 * Resolves `workspaceId` into the context FROM an invitation id path
 * param, for `DELETE /api/invitation/{id}` (cancel) -- the one S6a route
 * whose caller supplies an invitation id but not a workspace id directly.
 *
 * Deliberately NOT added as another `workspaceAccess.from*` case
 * (`workspace-access-middleware.ts`): every existing case there fails
 * uniformly with 400 "Workspace ID could not be determined" when its lookup
 * comes up empty, which is the right answer for "this project/task/label id
 * doesn't resolve to a workspace". Here a missing id means "no such
 * invitation", which is a 404, not a 400 -- a different failure mode than
 * that shared middleware's contract, not an extension of it.
 *
 * Once `workspaceId` is set, `requireWorkspaceMembership` /
 * `requireWorkspacePermission` / `requireWorkspaceRoleAuthority` run exactly
 * as they do after any other `workspaceAccess.*` middleware -- they only
 * ever read `c.get("workspaceId")`, never how it got there.
 */
export function requireInvitationWorkspaceAccess(idParam = "id") {
  return async (c: Context, next: Next) => {
    const invitationId = c.req.param(idParam);
    if (!invitationId) {
      throw new HTTPException(400, {
        message: "Invitation id is required",
      });
    }

    const [row] = await db
      .select({ workspaceId: schema.invitationTable.workspaceId })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, invitationId))
      .limit(1);

    if (!row) {
      throw new HTTPException(404, { message: "Invitation not found" });
    }

    c.set("workspaceId", row.workspaceId);
    return next();
  };
}
