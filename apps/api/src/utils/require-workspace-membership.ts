import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import { getWorkspaceMembershipRole } from "./repository";

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

  const [membership] = await getWorkspaceMembershipRole(userId, workspaceId);

  if (!membership) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  setShadowLegacyAuthorization(c, "allowed");
  return next();
}
