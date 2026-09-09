import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Capabilities route policy.
 *
 * `GET /api/capabilities` (S2, issue #6, retrofit plan matrix row 15) replaces the client's
 * 16-way `has-permission` fan-out against better-auth's `organization()` plugin with one
 * server-side computation over `hasWorkspacePermission`. Same `sessionOnly` reasoning and the
 * same runtime enforcement as `apps/api/src/workspace/policy.ts` — see that file's comment
 * for the full explanation of why a declaration alone would be inert metadata here (nothing
 * wires `policyRegistry` into `apps/api/src/index.ts` yet; that is issue #8's) and why the
 * restriction is also applied directly by
 * `apps/api/src/utils/require-session-only.ts` in this route's own middleware chain.
 *
 * `workspaceId` arrives on `?workspaceId=` — there is no row this route loads (the controller
 * runs 16 permission checks over the id the caller supplied and asserted membership for; it
 * never queries `workspaceTable`), so the scope id's provenance is the request itself, not a
 * loaded row: `scopeSource: "request"`. `workspace:read` is the floor every workspace member
 * already holds (even the `viewer` built-in role — its compiled statements are `*:read`
 * actions only, per this batch's own capabilities-equivalence finding), so asking "what can I
 * do in this workspace" never requires more authority than seeing the workspace does.
 */
export const capabilitiesPolicies = {
  "GET /api/capabilities": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
