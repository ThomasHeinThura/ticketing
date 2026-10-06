import { type Capability, isCapability } from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";

type PermissionMap = Record<string, readonly string[]>;

export type ApiKeyPermissionScope = {
  permissions?: Record<string, string[]> | null;
};

/**
 * Convert only exact resource/action pairs already present in the canonical capability
 * registry. This keeps strict policy evaluation under the same RBAC ∩ stored-key-scope
 * rule as the legacy middleware and terminal capability checks; unknown Better Auth
 * statements never become capabilities.
 */
export function apiKeyCapabilitySubset(
  apiKey: ApiKeyPermissionScope | undefined,
): readonly Capability[] {
  const permissions = apiKey?.permissions;
  if (
    !permissions ||
    typeof permissions !== "object" ||
    Array.isArray(permissions)
  ) {
    return [];
  }

  const capabilities: Capability[] = [];
  for (const [resource, actions] of Object.entries(permissions)) {
    if (
      !Array.isArray(actions) ||
      actions.some((action) => typeof action !== "string")
    ) {
      return [];
    }
    for (const action of actions) {
      const candidate = `${resource}:${action}`;
      if (isCapability(candidate)) capabilities.push(candidate);
    }
  }
  return [...new Set(capabilities)];
}

/**
 * The one API-key narrowing predicate shared by legacy permissions, canonical
 * capabilities, and routes that explicitly declare an API-key scope. A missing
 * credential means a session request; a present key without a complete valid
 * scope has no grants.
 */
export function apiKeyScopeSatisfies(
  apiKey: ApiKeyPermissionScope | undefined,
  required: PermissionMap,
): boolean {
  if (!apiKey) return true;
  const granted = apiKey.permissions;
  if (!granted || typeof granted !== "object" || Array.isArray(granted)) {
    return false;
  }
  for (const actions of Object.values(granted)) {
    if (
      !Array.isArray(actions) ||
      actions.some((action) => typeof action !== "string")
    ) {
      return false;
    }
  }
  return Object.entries(required).every(([resource, actions]) => {
    const grantedActions = granted[resource];
    return (
      grantedActions !== undefined &&
      actions.every((action) => grantedActions.includes(action))
    );
  });
}

/** Apply a canonical resource:action capability to the legacy stored scope shape. */
export function apiKeyHasCapabilityScope(
  apiKey: ApiKeyPermissionScope | undefined,
  capability: Capability,
): boolean {
  const separator = capability.indexOf(":");
  if (separator <= 0 || separator === capability.length - 1) return false;
  return apiKeyScopeSatisfies(apiKey, {
    [capability.slice(0, separator)]: [capability.slice(separator + 1)],
  });
}

/** API-key scopes narrow workspace roles; a missing scope cannot grant authority. */
export function apiKeyHasPermissionScope(
  c: Context,
  required: PermissionMap,
): boolean {
  const apiKey = c.get("apiKey") as ApiKeyPermissionScope | undefined;
  return apiKeyScopeSatisfies(apiKey, required);
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

/** Canonical-capability form for role-only handlers with a separate admin check. */
export function requireApiKeyCapabilityScope(capability: Capability) {
  return async (c: Context, next: Next) => {
    const apiKey = c.get("apiKey") as ApiKeyPermissionScope | undefined;
    if (!apiKeyHasCapabilityScope(apiKey, capability)) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient API key scope" });
    }
    return next();
  };
}
