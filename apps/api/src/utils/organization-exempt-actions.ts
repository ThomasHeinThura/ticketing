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
  // Creates or declines a membership; the caller's EXISTING role is not consulted, and
  // better-auth runs its own last-owner guard on `leave`.
  "accept-invitation",
  "reject-invitation",
  "leave",
] as const;

/** Lookup form of {@link ROLE_INDEPENDENT_ORGANIZATION_ACTIONS}. */
export const ROLE_INDEPENDENT_ORGANIZATION_ACTION_SET: ReadonlySet<string> =
  new Set(ROLE_INDEPENDENT_ORGANIZATION_ACTIONS);
