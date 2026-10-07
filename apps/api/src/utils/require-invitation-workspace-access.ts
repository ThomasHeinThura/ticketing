import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { rejectNulByte } from "./reject-nul-byte";
import { getInvitationWorkspaceId, getWorkspaceMembership } from "./repository";

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

    const [row] = await getInvitationWorkspaceId(invitationId);

    if (!row) {
      throw new HTTPException(404, { message: "Invitation not found" });
    }

    // #317 S3 (follow-up to #307's own S3 finding on this exact file): without
    // this, an invitation whose workspace the caller can't reach falls through
    // to `requireWorkspaceMembership`'s 403 "You don't have access to this
    // workspace", while a nonexistent invitation id 404s above -- an existence
    // oracle across every workspace, for whoever holds an old invitation id.
    //
    // Checked HERE, directly, rather than by wrapping `next()` in a
    // try/catch and remapping whatever it throws: Hono's own `compose()`
    // (`hono/dist/compose.js`) attaches the app's `onError` handler to
    // EVERY middleware frame, so a 403 thrown two frames down
    // (`requireWorkspaceMembership`) is already converted into a Response
    // by the time `await next()` resolves here -- there is no exception left
    // for an outer `catch` to see. Checking membership in this same frame,
    // before calling `next()`, sidesteps that entirely.
    //
    // This mirrors `requireWorkspaceMembership`'s own query (a real
    // `workspace_member` row, deliberately NO instance-admin bypass -- see
    // that file's header comment and the 2026-09-08 decision-log entry,
    // "the instance-admin bypass is not blessed on S4 mutation routes")
    // rather than `reachableWorkspacePredicate` (`workspace-access-
    // middleware.ts`), which DOES admin-bypass: folding that one in here
    // would let a non-member instance admin's request resolve `workspaceId`
    // via the bypass and then still 403 at `requireWorkspaceMembership` --
    // reopening exactly this oracle for that caller. Running the identical
    // no-bypass check here instead means a non-member (admin or not) gets
    // the same 404 an unknown invitation id gives. `requireWorkspaceMembership`
    // still runs after `next()`, redundantly re-confirming the same row for
    // every caller who reaches it -- it is not removed from the route, so
    // any future change to its own check is inherited automatically.
    const userId = c.get("userId");
    if (userId) {
      const [membership] = await getWorkspaceMembership(
        userId,
        row.workspaceId,
      );

      if (!membership) {
        throw new HTTPException(404, { message: "Invitation not found" });
      }
    }

    c.set("workspaceId", row.workspaceId);
    // #400 F1 (Opus review): row-derived, never from the caller's request -- label it
    // so shadow mode's evidence gate keeps it instead of always nulling it.
    c.set("workspaceIdSource", "row");
    return next();
  };
}
