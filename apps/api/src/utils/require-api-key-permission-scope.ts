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

/**
 * API-key permission statements narrow a person's workspace role. A null scope means the
 * key is unrestricted; an explicit empty or incomplete scope refuses the request.
 * `requireWorkspaceCapability` continues to make the independent canonical role check.
 */
export function apiKeyHasPermissionScope(
  c: Context,
  required: PermissionMap,
): boolean {
  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  return (
    !apiKey?.permissions || permissionsSatisfy(apiKey.permissions, required)
  );
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
