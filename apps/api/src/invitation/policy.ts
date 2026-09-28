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
 * this is not a contract removal) but change its own HANDLER to reuse
 * `cancelInvitationRoute`'s exact middleware chain and then still refuse unconditionally,
 * even for a caller who passes it. That reuse is what makes `capability: "member:invite"`
 * below an HONEST declaration, not a guess: the runtime now genuinely enforces it (same
 * middleware, same capability, same scope resolution as cancel), the handler's own
 * unconditional throw is simply an ADDITIONAL restriction beyond what's declared here, not
 * a mismatch with it -- a caller who is refused for lacking `member:invite` and a caller who
 * has it but still gets refused both see the same class of response (403), so no capability
 * ever actually unlocks real data through this operation again. See
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
 * **Cancel is different, and is a capability policy.** It is an action a workspace
 * ADMIN/OWNER takes on someone ELSE's still-pending invitation, so it needs the same
 * authority shape as the S5 membership-write routes. `member:invite` is reused rather than a
 * new `member:cancel` capability invented: rbac.md's Members group (`docs/01-architecture/
 * rbac.md`) has exactly two entries, `member:invite` and `member:remove`, and neither is an
 * exact name-for-name match for "revoke a pending invitation" -- `member:invite` is the
 * closer fit (the same authority that may extend an invitation may also withdraw it) and is
 * recorded here as a gap for #7 to resolve, the same way `workspace/policy.ts` already
 * records its own `workspace:manage_members` reuse for two routes with no exact match. The
 * RUNTIME check, `requireWorkspacePermission({ invitation: ["cancel"] })`
 * (`apps/api/src/utils/require-workspace-permission.ts`, called from
 * `apps/api/src/invitation/index.ts`), reads the INHERITED `invitation` resource's `cancel`
 * action -- a DIFFERENT action string from create's `invitation: ["create"]` above, even
 * though both are declared with the same `member:invite` capability name here. The
 * declaration and the runtime check are allowed to diverge in GRANULARITY (one canonical
 * capability standing in for two distinct inherited actions) without disagreeing about WHO
 * holds it: both actions are granted to exactly `admin`/`owner` on the compiled default roles
 * (`legacy-better-auth-access-control.ts`), so no role can invite but not cancel, or cancel
 * but not invite, under the current seed data.
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

  // Deprecated, permanently disabled -- see this file's own top comment for the full
  // reasoning. Declared identically to cancel (same middleware chain, same capability),
  // because that is genuinely what the runtime now enforces; the handler's own
  // unconditional refusal is an additional restriction on top, not a mismatch with this.
  "GET /api/invitation/{id}": {
    capability: "member:invite",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
