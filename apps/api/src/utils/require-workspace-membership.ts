import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

/**
 * Require the caller to be an actual `workspace_member` of the workspace
 * already resolved into the context by `workspaceAccess.*`.
 *
 * WHY THIS EXISTS, and it is a preservation not an invention. The inherited
 * `/organization/update` and `/organization/delete` routes both begin with
 * `adapter.findMemberByOrgId(...)` and refuse a non-member outright
 * (`USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`) — better-auth has no notion of
 * a TaskDesk instance admin.
 *
 * TaskDesk's shared authorization path does: `validateWorkspaceAccess` returns
 * early for `user.role === "admin"`, and `hasWorkspacePermission` short-circuits
 * on `isInstanceAdmin`. Mounting the native write routes on that path alone
 * would therefore hand every instance admin the ability to rename or DELETE
 * any workspace in the instance — a brand-new authority, acquired silently as
 * a side effect of moving a route. Retrofit plan R4 predicts exactly this
 * shape of change for the reads; for a destructive write it is not acceptable
 * as a side effect.
 *
 * This restores the inherited precondition at the route, without touching the
 * shared evaluator that every other authenticated route depends on (which is
 * #7's and #66's to change, not this lane's).
 *
 * RESIDUAL, PINNED AND FLAGGED: an instance admin who IS a member of the
 * workspace still passes `requireWorkspacePermission` through the bypass,
 * whatever their workspace role. That is pre-existing shared behaviour, it is
 * asserted in `tests/api-integration/workspace-write-authorization.test.ts`
 * so it cannot drift unnoticed, and closing it is a decision about the shared
 * evaluator rather than about these routes.
 */
export async function requireWorkspaceMembership(c: Context, next: Next) {
  const userId = c.get("userId");
  const workspaceId = c.get("workspaceId");
  if (!userId || !workspaceId) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  const [membership] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  return next();
}
