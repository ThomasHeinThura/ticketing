import {
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  type Capability,
  expandCapabilities,
} from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "./workspace-member-roles";

/**
 * Require the caller's OWN, freshly-read workspace role to hold `capability` — evaluated
 * against the CANONICAL capability vocabulary (`@taskdesk/permissions`'s `BUILT_IN_ROLES`,
 * documented in `docs/01-architecture/rbac.md`), never the inherited better-auth-shaped
 * `{ resource: action[] }` statements `requireWorkspacePermission`
 * (`require-workspace-permission.ts`) reads.
 *
 * WHY THIS FILE EXISTS — the defect it closes. `POST
 * /api/workspace/{workspaceId}/transfer-ownership` used to declare the capability
 * `workspace:manage_members` in its route policy (metadata only — nothing wired it to a
 * runtime check) while its ACTUAL authority came from a hardcoded string comparison inside
 * `transferWorkspaceOwnership`'s transaction: `caller.role !== "owner"`. That produced THREE
 * different answers to "who may transfer ownership": the route policy said
 * `workspace:manage_members`, the permission-matrix fixture (generated from the route
 * policy) therefore read `manager → allow`, and the only role that could actually call the
 * route successfully was `owner`. This module is what makes the declared capability
 * (`workspace:transfer_ownership`, granted only to `owner` — rbac.md § Capabilities) the
 * thing the runtime actually checks, so the three answers can never disagree again.
 *
 * DELIBERATELY NOT `requireWorkspacePermission` + `requireWorkspaceRoleAuthority`. Those two
 * read `workspace_role.permission`, the inherited better-auth statements shape, which has no
 * notion of `workspace:transfer_ownership` (or of `manager`/`lead`/`customer` at all — those
 * three TaskDesk roles are not defined on the better-auth `ac` side, only in
 * `@taskdesk/permissions`'s `BUILT_IN_ROLES`). Re-keying the seeded rows to the
 * `workspace:*` vocabulary is #7's capability migration, not this lane's. This module reads
 * the caller's plain `workspace_member.role` string (the same column
 * `requireWorkspaceMembership` and the controller's own in-transaction check read) and asks
 * only whether that string names a `BUILT_IN_ROLES` key whose (compiled) capability set
 * includes `capability` — which today means exactly `"owner"`, because `owner` is the only
 * built-in role `workspace:transfer_ownership` is granted to, and there is nowhere yet a
 * custom, editable role could acquire it (`role.capabilities` — the NEW capability-string
 * column — does not exist on `workspace_role` yet; only `.permission`, the legacy shape,
 * does). An unrecognised role string (a custom role's own kebab-slug `key`) simply holds no
 * built-in capability at all here and is refused, which is the correct, fail-closed answer
 * until that migration lands.
 *
 * NO INSTANCE-ADMIN BYPASS, ON PURPOSE. Unlike `requireWorkspaceRoleAuthority`, this
 * middleware never calls `isInstanceAdmin`. `transferWorkspaceOwnership`'s own doc comment
 * already establishes the intended behaviour: "An instance admin who is not this workspace's
 * owner fails that read exactly like anyone else." Adding a bypass here — even a
 * fail-closed one resolved from the caller's own row, the way that other middleware does for
 * the two S4 mutation routes — would be inventing new behaviour this route never had; it
 * would also number a NINTH bypass to be tracked separately. There is nothing to bypass:
 * this function only reads `workspace_member.role`, exactly like the in-transaction check
 * it runs alongside.
 *
 * TWO INDEPENDENT CHECKS, ONE SHARED ANSWER. This middleware runs BEFORE the handler, outside
 * any transaction — the same shape every other S4/S5 write route's authority gate runs in.
 * `transferWorkspaceOwnership`'s in-transaction re-read of `workspace_member.role` under
 * `pg_advisory_xact_lock` still runs afterwards, unchanged in its OWN role, as the
 * concurrency-safety check that makes two simultaneous transfers from the same owner mutually
 * exclusive (see that file and `workspace-membership-writes-negative.test.ts`'s concurrent
 * probe). Both checks now call `builtInRoleHasCapability` — the same pure function, reading
 * the same `BUILT_IN_ROLES` data — so they can never independently drift out of agreement the
 * way the declared policy and the old hardcoded check did.
 */
export function requireWorkspaceCapability(capability: Capability) {
  return async (c: Context, next: Next) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    if (!workspaceId || !userId) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    // Fail-closed against duplicate `workspace_member` rows for this pair
    // (`workspace_member` has no unique constraint on
    // `(workspace_id, user_id)` -- `workspaceMemberRoles`'s doc comment):
    // the capability is granted only when EVERY row for the pair grants it,
    // never when an arbitrary one does. `roles.length === 0` is checked
    // explicitly rather than relying on `.every()` alone -- `[].every(...)`
    // is vacuously `true` in JS, which would silently grant a non-member
    // every capability.
    const roles = await workspaceMemberRoles(db, workspaceId, userId);

    // ONE predicate, shared with `transferWorkspaceOwnership`'s own
    // in-transaction check, so the two cannot reduce the same rows
    // differently. They used to: this gate reduced with `.every(...)` while
    // the controller reduced with `length !== 1`, so for `["owner", "owner"]`
    // the gate GRANTED and the controller REFUSED. Fail-closed, and therefore
    // not an escalation -- but it locked the only owner out of the transfer
    // route while nobody else held the capability, making ownership unmovable
    // without database surgery. Found by the independent security review of
    // pull request #77.
    //
    // `isUnambiguousMembership` subsumes the old `roles.length === 0` guard
    // (which existed because `[].every(...)` is vacuously `true` in JS and
    // would have granted a non-member every capability) and additionally
    // denies the duplicated-row case instead of reasoning about it. Refusing
    // to answer when the membership state is corrupt is the fail-closed
    // reading, and issue #88's `UNIQUE (workspace_id, user_id)` constraint
    // makes that case unreachable once it lands.
    if (
      !isUnambiguousMembership(roles) ||
      !builtInRoleHasCapability(roles[0], capability)
    ) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    return next();
  };
}

/**
 * Does the built-in role named `role` hold `capability`, per the compiled
 * `BUILT_IN_ROLES` capability data (`@taskdesk/permissions`) — implications expanded, exactly
 * as `capabilityGrid()` (the permission-matrix fixture generator) computes it.
 *
 * Exported (rather than kept private to this module) so
 * `transferWorkspaceOwnership`'s own in-transaction check can call the identical function —
 * see that file. A role string that names no `BUILT_IN_ROLES` key (a custom, editable role's
 * own slug) holds no built-in capability here and returns `false`: fail-closed, never a
 * silent "unknown means allow".
 */
export function builtInRoleHasCapability(
  role: string | null | undefined,
  capability: Capability,
): boolean {
  // `Object.hasOwn`, not `role in BUILT_IN_ROLES` -- `in` also matches
  // `Object.prototype` members, so role values like `"toString"`,
  // `"constructor"`, `"hasOwnProperty"`, `"valueOf"` and `"__proto__"` would
  // pass this check with `BUILT_IN_ROLES[key].capabilities === undefined`,
  // and `expandCapabilities(undefined)` throws `TypeError: stored is not
  // iterable`. Same idiom already used at
  // `packages/permissions/src/capabilities.ts`'s `isCapability`.
  //
  // AND IT IS REACHABLE TODAY -- an earlier version of this comment said it
  // was not, and that was wrong. The independent security review of pull
  // request #77 measured it: `dynamicAccessControl` is enabled
  // (`apps/api/src/auth.ts`) and the plugin's `create-role` validates the role
  // name as a bare `z.string()`, so `create-role` with `role: "constructor"`
  // returns 200 and writes a real `workspace_role` row, which can then be
  // assigned to a member. So this is a live guard, not a defensive one against
  // a hypothetical future route.
  if (!role || !Object.hasOwn(BUILT_IN_ROLES, role)) return false;
  const key = role as BuiltInRoleKey;
  return expandCapabilities(BUILT_IN_ROLES[key].capabilities).has(capability);
}
