import type { Context, Next } from "hono";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";

/**
 * Workspace creation is for a current instance administrator only (owner decision D-A,
 * 12 Nov 2026, final). It replaces the older `DISABLE_WORKSPACE_CREATION` gate, which only
 * restricted creation when the variable was exactly `"true"` and otherwise let every signed-in
 * staff account create a workspace and own it. The variable is still registered
 * (`scripts/ci/env-baseline.json`) and still read by `get-settings.ts`, but it no longer widens
 * or narrows anything here: the answer is always "instance administrators only".
 *
 * `requireCurrentInstanceAdmin` re-reads the administrator role from the database at request
 * time (the first-user bootstrap promotes the user AFTER `signUpEmail` has returned, so a
 * session minted at sign-up can still say `role: "user"`), refuses an impersonation session,
 * and evaluates the `instance:admin` capability policy registered for this route against the
 * credential that actually authenticated the request, so an API key never qualifies.
 *
 * `requireSessionOnly()` (`apps/api/src/utils/require-session-only.ts`, #65) still runs ahead of
 * this middleware on the create route and is what answers a non-session caller with
 * `403 session_required`; this file does not duplicate that check.
 */
export async function requireWorkspaceCreationAllowed(c: Context, next: Next) {
  await requireCurrentInstanceAdmin(c, "POST", "/api/workspace");
  setShadowLegacyAuthorization(c, "allowed");
  return next();
}
