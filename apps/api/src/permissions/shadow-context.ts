import type { Context } from "hono";

/** Explicit result from a legacy authorization check; response status is not a substitute. */
export type ShadowLegacyAuthorization = "allowed" | "denied" | "unknown";

/** A request value is evidence only after row verification or legacy authorization. */
export function workspaceIdForShadowEvidence(
  workspaceId: string | null,
  source: "row" | "request" | null,
  legacyAllowed: boolean | null,
): string | null {
  if (workspaceId === null) return null;
  return source === "row" || legacyAllowed === true ? workspaceId : null;
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
