/**
 * The single canonical list of organization routes where the caller's own membership role is
 * NOT an authorization input — issue #82.
 *
 * ## Why this file exists
 *
 * Two consumers must agree about which organization actions are role-independent:
 *
 * - `organization-plugin-role-guard.ts` — the runtime guard, which refuses a **non-exempt**
 *   action with `409 MALFORMED_MEMBERSHIP_ROLE` when the caller holds a malformed row;
 * - `auth-openapi.ts` — the contract, which attaches that `409` to exactly the same set.
 *
 * They were two independent literals, and they had already **diverged**: `list-user-teams`
 * was documented as exempt but was missing from the runtime list, so a caller holding a
 * corrupt row anywhere was refused a role-independent action that the published contract
 * said would succeed. Two lists that must agree and are maintained separately is the
 * "convention instead of a constraint" defect class this repository keeps producing; the fix
 * is one source, not one more entry written into two places.
 *
 * ## What belongs here
 *
 * An action is exempt when TaskDesk's malformed-role refusal would refuse a decision that
 * does not depend on the malformed value. Guarding those turns a real defect — a corrupt row
 * in workspace A — into an unrelated outage: unable to create workspace B, unable to list
 * their own invitations, unable even to leave the workspace whose row is broken. Fail-closed
 * means refusing the decisions that *depend* on the corrupt value, not bricking the account
 * that holds it.
 *
 * The **write** half of the guard is not affected by this list: no exempt action may write a
 * multi-role value either.
 *
 * ## Three corrections from formal review, each against this file's own stated criterion —
 * and each one an audit that checked one route and missed its siblings, which is this
 * repository's recurring defect class, not three unrelated bugs
 *
 * **Added (round 2): `list-teams`, `set-active-team`, `list-team-members`.** The audit that
 * added `list-user-teams` above (because better-auth's own handler for it never calls
 * `hasPermission`) checked only that one route in `crud-team.mjs` and missed three siblings
 * with the identical property — confirmed directly against the installed better-auth
 * source: none of `listOrganizationTeams`, `setActiveTeam`, or `listTeamMembers` calls
 * `hasPermission` anywhere in their handlers, matching `listUserTeams` exactly. Leaving them
 * off produced the same unrelated-outage defect this file exists to prevent, just for three
 * more routes.
 *
 * **Removed (round 2): `leave`.** Its exemption rested on "better-auth runs its own
 * last-owner guard on `leave`", which is false as a blanket claim: `leaveOrganization`
 * (`crud-members.mjs`) does check `member.role.split(",").includes(creatorRole)` — so the
 * caller's role IS consulted, meeting this file's own criterion for "must be guarded", not
 * "is independent of it". That check also has no `.trim()`, so a legacy row like `" owner"`
 * (a single, padded, no-comma value) defeats the last-owner protection: the sole owner could
 * leave and strand the workspace with zero owners. Migration `0050`'s repair pass auto-heals
 * that shape for any row predating the migration, and the write guard plus the CHECK
 * constraint refuse it going forward — but the exemption's stated rationale was still wrong,
 * and this file must not carry an exemption whose own justification does not hold. `leave` is
 * now guarded like every other role-dependent action: a caller holding a malformed row is
 * refused `409` before reaching better-auth's own (trim-unaware) last-owner check.
 *
 * **Added (round 3): `get-full-organization`, `list-invitations`, `list-members`,
 * `get-active-member`, `get-active-member-role`.** Round 2's audit covered every route
 * `hasPermission`-gates or doesn't, but stopped there — it never asked the wider question:
 * which mounted routes never consult a role at ALL, by any mechanism. All five confirmed
 * directly against the installed better-auth source (`crud-org.mjs`, `crud-invites.mjs`,
 * `crud-members.mjs`) to call only `adapter.checkMembership` or `adapter.findMemberByOrgId`
 * — both of which filter solely on `userId`/`organizationId` (`organization/adapter.mjs`),
 * never `role`. This is the exact harm this file's own opening paragraph names as the reason
 * it exists: `list-invitations` was refused for a caller with one corrupt row anywhere,
 * which is precisely "unable to list their own invitations" — the file was contradicting its
 * own stated purpose for three routes it had simply never checked.
 *
 * Recovery remains available through the actions listed below — a caller can still list and
 * switch workspaces, create a new one, view organization/member/invitation state, and
 * respond to invitations while an administrator repairs the malformed row elsewhere. `leave`
 * is the one action that genuinely still requires the row be fixed first.
 */
export const ROLE_INDEPENDENT_ORGANIZATION_ACTIONS = [
  // Acts on no existing organization at all.
  "create",
  "check-slug",
  // Scoped to the caller's own user, not to a role in an organization.
  "list",
  "set-active",
  "list-user-invitations",
  "list-user-teams",
  "get-invitation",
  // Creates or declines a membership; the caller's EXISTING role is not consulted.
  "accept-invitation",
  "reject-invitation",
  // Better-auth's own handlers for these never call `hasPermission` -- confirmed directly
  // against the installed source, the same criterion that already exempted `list-user-teams`.
  "list-teams",
  "set-active-team",
  "list-team-members",
  // Round 3: never consult a role by ANY mechanism -- only `checkMembership` /
  // `findMemberByOrgId`, both of which filter on userId/organizationId, never role.
  "get-full-organization",
  "list-invitations",
  "list-members",
  "get-active-member",
  "get-active-member-role",
] as const;

/** Lookup form of {@link ROLE_INDEPENDENT_ORGANIZATION_ACTIONS}. */
export const ROLE_INDEPENDENT_ORGANIZATION_ACTION_SET: ReadonlySet<string> =
  new Set(ROLE_INDEPENDENT_ORGANIZATION_ACTIONS);
