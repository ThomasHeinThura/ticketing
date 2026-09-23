import type { Context } from "hono";

/** Explicit result from a legacy authorization check; response status is not a substitute. */
export type ShadowLegacyAuthorization = "allowed" | "denied" | "unknown";

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
