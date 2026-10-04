import type { Context } from "hono";

/** Explicit result from a legacy authorization check; response status is not a substitute. */
export type ShadowLegacyAuthorization = "allowed" | "denied" | "unknown";

/**
 * A request-sourced id is trustworthy evidence only once IT ITSELF is confirmed against a
 * real `workspace` row — never because some legacy authorization path merely said
 * "allowed". `validateWorkspaceAccess` may allow an instance administrator to address a
 * workspace without membership, so "the legacy path allowed it" is not proof of verification
 * the way it is for a member (whose "allowed" can only come from a real `workspace_user` row
 * naming that exact id). The caller does the row check
 * itself (`runShadowEvaluation`'s lookup in `shadow-middleware.ts`); this function only
 * gates on its result, for every caller alike, admin or not.
 */
export function workspaceIdForShadowEvidence(
  workspaceId: string | null,
  verified: boolean,
): string | null {
  if (workspaceId === null) return null;
  return verified ? workspaceId : null;
}

/** Clear any earlier gate result before beginning another authorization decision. */
export function markShadowLegacyAuthorizationUnknown(c: Context): void {
  c.set("legacyAuthorization", "unknown");
}

export function setShadowLegacyAuthorization(
  c: Context,
  result: ShadowLegacyAuthorization,
): void {
  c.set("legacyAuthorization", result);
}

/**
 * Whether this exact matched GET route may use the typed observer-only row lookup. Public,
 * self, portal, delegated, write, and unmatched routes are deliberately excluded.
 */
export async function hasMatchedRowScopedCapabilityPolicy(
  c: Context,
): Promise<boolean> {
  if (c.req.method !== "GET") return false;
  const [{ attributedRouteKey }, { policyRegistry }, permissions] =
    await Promise.all([
      import("./shadow-middleware"),
      import("../policy-registry"),
      import("@taskdesk/permissions"),
    ]);
  const routeKey = attributedRouteKey(c);
  const entry = routeKey ? policyRegistry.get(routeKey) : undefined;
  return Boolean(
    entry?.kind === "capability" &&
      permissions.isCapabilityPolicy(entry.policy) &&
      entry.policy.scopeSource === "row",
  );
}
