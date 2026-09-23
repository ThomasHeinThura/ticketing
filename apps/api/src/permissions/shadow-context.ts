import type { Context } from "hono";

/** Explicit result from a legacy authorization check; response status is not a substitute. */
export type ShadowLegacyAuthorization = "allowed" | "denied";

export function setShadowLegacyAuthorization(
  c: Context,
  result: ShadowLegacyAuthorization,
): void {
  c.set("legacyAuthorization", result);
}
