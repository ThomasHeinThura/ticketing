import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Invitation route policies.
 *
 * Covers the three native S6a action routes this batch adds (retrofit plan §3, issue #6):
 * accept, reject, cancel. `GET /api/invitation/pending` and `GET /api/invitation/{id}` are
 * S3's pre-existing reads, classified below by #8. `GET /api/invitation/public/{id}` is a
 * DIFFERENT route, registered inline in `apps/api/src/index.ts` itself (not in this
 * sub-router, `apps/api/src/invitation/index.ts`), above the app-wide auth guard -- it is out
 * of this lane's scope as briefed (the brief's route count for this router, "2 of 5 routes
 * unclassified, 3 already done", already excludes it: this router has exactly five routes --
 * pending, {id}, accept, reject, cancel) and is left for whichever lane owns `index.ts`'s
 * inline routes.
 *
 * **`GET /api/invitation/pending` is `self`, kind 2**, added below: `getUserPendingInvitations`
 * (`apps/api/src/invitation/controllers/get-user-pending-invitations.ts`) filters strictly on
 * `invitationTable.email = c.get("userEmail")` -- the caller's own pending invitations, never
 * another user's -- same shape as accept/reject above. `personParam` states the
 * `no_person_parameter` exemption for the same reason.
 *
 * A gap flagged by the lane that first classified this route, found while confirming it: the
 * 2026-09-08 decision (`docs/07-planning/decision-log.md`, "Native organization routes
 * preserve inherited session-only reach") requires every native route touching "workspace,
 * membership, invitation or capability data" to be session-only in the runtime that ships it
 * -- and this route plainly reads invitation data. Accept/reject/cancel all carried
 * `requireSessionOnly()` in their own route middleware; `getPendingRoute`
 * (`apps/api/src/invitation/index.ts`) did not -- it relied only on whatever the app-wide
 * guard populated, which accepted a personal API key or MCP key exactly as readily as a
 * browser session. This was the same class of gap the decision log itself names as R10 (found
 * live at PR #65's pre-remediation head, on four different routes). Fixed in the route-
 * classification integration pass (issue #8): `getPendingRoute` now carries
 * `requireSessionOnly()` in its own middleware, identically to its accept/reject/cancel
 * siblings, so `sessionOnly: true` is declared below to match what the runtime now actually
 * enforces -- not before, since a declared-but-unenforced flag is exactly the
 * declared-and-inert shape `packages/permissions/src/policy.ts`'s own doc comment says this
 * registry exists to refuse.
 *
 * **`GET /api/invitation/{id}` is DEPRECATED and PERMANENTLY DISABLED (2026-09-28), not
 * deleted, and its own runtime shape changed to make a real, honest classification
 * possible.** It used to call the exact same `getInvitationDetails(id)` util
 * (`apps/api/src/utils/check-registration-allowed.ts`) as the fully PUBLIC
 * `GET /api/invitation/public/{id}` above -- same query, same fields returned (invitee
 * email, workspace name, inviter name), same total absence of any recipient or
 * workspace-membership check -- which fit none of the five kinds honestly (flagged, not
 * guessed, for a full session). PR #440's Opus delta pass F4 forced the question: the
 * guard's own fix (checking every matched route, not predicting a terminal one) meant this
 * route's continued absence from the registry would 500 it for everyone regardless.
 * Deleting it outright was the first plan, but `docs/01-architecture/api-design.md`'s
 * Versioning section forbids a breaking removal without a deprecation window once a stable
 * `v2.0.0`+ tag exists (one already does) -- so Thomas's actual decision (2026-09-28) was
 * to keep the OPERATION registered (`deprecated: true`, satisfying the versioning policy --
 * this is not a contract removal) but keep its own session, row-derived workspace,
 * membership and legacy authority gates before the handler refuses unconditionally, even
 * for a caller who passes them. The operation remains disabled and returns no invitation
 * data. See
 * `docs/07-planning/security-reviews/440-runtime-authorization-wiring.md` for the fuller
 * history.
 *
 * **Accept and reject are `self`, kind 2 -- not a capability check against a scope.** Both
 * act ONLY on the calling user's own invitation and (for accept) the membership row it
 * creates for that SAME caller: `acceptInvitation`/`rejectInvitation`
 * (`apps/api/src/invitation/controllers/*`) refuse outright when the invitation's email does
 * not match the caller's own session email (`NotInvitationRecipientError`). There is no
 * workspace-authority question to ask here — the caller is not (yet, for accept; never, for
 * reject) a member of the workspace the invitation belongs to, so `workspace:*` capabilities
 * are meaningless on this path, the same reasoning `POST /api/workspace/{workspaceId}/leave`
 * gives for its own `self` classification. `personParam` states the `no_person_parameter`
 * exemption for the same reason that route does: the route names an invitation id, not a
 * person id — the caller IS the person, identified by their own session.
 *
 * **Cancel is a capability policy.** `member:invite` governs creating and withdrawing
 * invitations. The DELETE route resolves the invitation's workspace, requires an actual
 * workspace membership, then checks this canonical capability with
 * `requireWorkspaceCapability`; pending-action request and approval also revalidate the
 * registered policy and target reach. This lets any role holding `member:invite` revoke
 * within its permitted reach without broadening access to other workspaces or organisations.
 *
 * `scopeSource: "row"` for cancel: `workspaceId` is not a path parameter on
 * `DELETE /api/invitation/{id}` at all -- it is resolved by reading the INVITATION's own row
 * (`apps/api/src/utils/require-invitation-workspace-access.ts`), which is exactly the "scope
 * id read from a loaded row" shape `scopeSource: "row"` describes, even though the row
 * loaded is the invitation's, not the workspace's.
 */
export const invitationPolicies = {
  "GET /api/invitation/pending": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns the caller's own unexpired, unaccepted invitations, filtered by their own session email; the route names no person parameter because the caller is the person",
    },
    sessionOnly: true,
  },

  "POST /api/invitation/{id}/accept": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "creates the caller's own workspace membership from an invitation addressed to their own session email; the route names an invitation id, not a person id, because the caller is the person",
    },
    sessionOnly: true,
  },

  "POST /api/invitation/{id}/reject": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "declines an invitation addressed to the caller's own session email; the route names an invitation id, not a person id, because the caller is the person",
    },
    sessionOnly: true,
  },

  "DELETE /api/invitation/{id}": {
    capability: "member:invite",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },

  // Deprecated, permanently disabled -- see this file's own top comment. Its legacy
  // authority gate is retained on the disabled route; the handler refuses every caller.
  "GET /api/invitation/{id}": {
    capability: "member:invite",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
