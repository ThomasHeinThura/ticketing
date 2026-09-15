import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Invitation route policies.
 *
 * Covers the three native S6a action routes this batch adds (retrofit plan §3, issue #6):
 * accept, reject, cancel. `GET /api/invitation/pending`, `GET /api/invitation/{id}` and
 * `GET /api/invitation/public/{id}` are S3's pre-existing reads and stay classified by #8
 * alongside the rest of the inherited surface -- they are listed, unmodified, in
 * `tests/permissions/inherited-uncovered.json`.
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
} as const satisfies PolicyMap;
