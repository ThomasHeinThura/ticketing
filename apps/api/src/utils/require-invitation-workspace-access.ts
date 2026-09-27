import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { rejectNulByte } from "./reject-nul-byte";

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
    // #281 sweep: this id reaches a raw `eq(invitationTable.id, ...)` query below,
    // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
    rejectNulByte(invitationId, "Invitation id");

    const [row] = await db
      .select({ workspaceId: schema.invitationTable.workspaceId })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, invitationId))
      .limit(1);

    if (!row) {
      throw new HTTPException(404, { message: "Invitation not found" });
    }

    c.set("workspaceId", row.workspaceId);

    try {
      return await next();
    } catch (error) {
      // #317 S3 (follow-up to #307's own S3 finding on this exact file): without
      // this, an invitation whose workspace the caller can't reach falls through
      // to `requireWorkspaceMembership`'s 403 "You don't have access to this
      // workspace", while a nonexistent invitation id 404s above -- an existence
      // oracle across every workspace, for whoever holds an old invitation id.
      //
      // NOT fixed by folding `reachableWorkspacePredicate` into the lookup above,
      // unlike the asset/ws routes (`authorize-asset-access.ts`, `index.ts`'s
      // `/ws/:projectId`): that predicate admin-bypasses, but
      // `requireWorkspaceMembership` deliberately does NOT (see its own header
      // comment and the decision log's 2026-09-08 entry, "the instance-admin
      // bypass is not blessed on S4 mutation routes"). Folding it here would let
      // an instance-admin non-member's request resolve `workspaceId` via the
      // bypass, then still 403 at `requireWorkspaceMembership` -- reopening
      // exactly this oracle for that caller. Remapping only this exact 403
      // message instead preserves that no-bypass semantics for every reachable
      // case, the same message-based remap `authorize-asset-access.ts` and
      // `workspace-access-middleware.ts` (pre-#307) already use, and masks only
      // the existence bit.
      if (
        error instanceof HTTPException &&
        error.status === 403 &&
        error.message === "You don't have access to this workspace"
      ) {
        throw new HTTPException(404, { message: "Invitation not found" });
      }
      throw error;
    }
  };
}
