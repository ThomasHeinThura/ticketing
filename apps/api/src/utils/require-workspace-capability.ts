import {
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  type Capability,
  expandCapabilities,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

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

    const [member] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, userId),
        ),
      )
      .limit(1);

    if (!builtInRoleHasCapability(member?.role, capability)) {
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
  if (!role || !(role in BUILT_IN_ROLES)) return false;
  const key = role as BuiltInRoleKey;
  return expandCapabilities(BUILT_IN_ROLES[key].capabilities).has(capability);
}
