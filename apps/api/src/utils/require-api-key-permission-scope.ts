import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";

type PermissionMap = Record<string, readonly string[]>;

function permissionsSatisfy(
  granted: Record<string, string[]>,
  required: PermissionMap,
): boolean {
  return Object.entries(required).every(([resource, actions]) => {
    const grantedActions = granted[resource];
    return (
      grantedActions !== undefined &&
      actions.every((action) => grantedActions.includes(action))
    );
  });
}

/** API-key scopes narrow workspace roles; a missing scope cannot grant authority. */
export function apiKeyHasPermissionScope(
  c: Context,
  required: PermissionMap,
): boolean {
  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  if (!apiKey) return true;
  if (apiKey.permissions === null || apiKey.permissions === undefined) {
    return false;
  }
  return permissionsSatisfy(apiKey.permissions, required);
}

/** Enforce only the API-key narrowing layer; callers still need a role-capability gate. */
export function requireApiKeyPermissionScope(required: PermissionMap) {
  return async (c: Context, next: Next) => {
    if (!apiKeyHasPermissionScope(c, required)) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient API key scope" });
    }
    return next();
  };
}
