import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";

/**
 * Require an actual workspace membership for routes whose contract requires membership in
 * addition to global reach or a capability check. `workspaceAccess.*` has already resolved
 * the resource scope; this guard checks the caller's persisted membership row and records the
 * legacy decision for shadow comparison.
 */
export async function requireWorkspaceMembership(c: Context, next: Next) {
  markShadowLegacyAuthorizationUnknown(c);
  const userId = c.get("userId");
  const workspaceId = c.get("workspaceId");
  if (!userId || !workspaceId) {
    setShadowLegacyAuthorization(c, "denied");
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
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  setShadowLegacyAuthorization(c, "allowed");
  return next();
}
