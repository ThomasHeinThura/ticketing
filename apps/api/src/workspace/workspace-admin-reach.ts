import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";
import { projectMembershipKeys } from "../identity/membership-projection";
import {
  isGenuineBuiltInRoleGrant,
  resolveMembershipRoleFrom,
  workspaceMemberRoles,
} from "../utils/workspace-member-roles";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Owner / admin workspace reach (decision log 2026-10-14, "Workspace owners and admins hold
 * an explicit `sees_all` grant"; `rbac.md` § Reach step 2).
 *
 * A workspace `owner` or `admin` holds an explicit `sees_all` grant on that workspace. The
 * grant is a canonical `membership` row (`scope = 'workspace'`, `sees_all = true`) with a
 * DIRECT `membership_grant` behind it, exactly the provenance shape the identity writers
 * use (`projectMembershipKeys`, `identity/repository.ts`): `rbac.md` says `sees_all` is
 * true only when the selected DIRECT grant carries it, and external (SCIM / OIDC / JIT)
 * grants can never set or inherit it.
 *
 * PROVENANCE. Every grant this module writes has `source_kind = 'direct'` and
 * `direct_origin = 'system_backfill'` (no granting person). `system_backfill` is written by
 * nothing else, so that value alone identifies "a grant derived from the legacy
 * `workspace_member` owner/admin role". Consequences:
 *
 *  - Revocation only ever touches `system_backfill` grants. An explicit, admin-made direct
 *    grant (`direct_origin = 'admin'`) is never revoked, rewritten or duplicated by a role
 *    change; an owner/admin who also holds one keeps whatever that grant says.
 *  - An SCIM / OIDC / JIT grant for the same person and workspace is never deleted here.
 *    When ours is revoked, `projectMembershipKeys` reprojects the effective membership from
 *    whatever active grants remain (an external grant then wins, with `sees_all = false`),
 *    or removes the membership when none remain.
 *
 * CARRIER ROLE. The grant needs a `role` row of `scope = 'workspace'` anchored in the
 * workspace. We create one per workspace and key (`owner` / `admin`), `is_system = true`,
 * with an EMPTY capability list on purpose: authority for these two roles keeps coming from
 * the legacy `workspace_member.role` + compiled-in `BUILT_IN_ROLES` path, so this row is a
 * reach carrier only. A capability snapshot here could outlive a later narrowing of
 * `BUILT_IN_ROLES` and silently keep a removed capability; an empty list cannot.
 *
 * Callers invoke `syncWorkspaceAdminReach` inside the same transaction, after the
 * `workspace_member` write and under the workspace membership lock they already hold, for
 * every user whose legacy role may have changed. It is idempotent and derives everything
 * from the current `workspace_member` rows, so calling it for an unchanged member is safe.
 */
const REACH_ROLE_KEYS = ["owner", "admin"] as const;
type ReachRoleKey = (typeof REACH_ROLE_KEYS)[number];

function isReachRoleKey(value: string): value is ReachRoleKey {
  return (REACH_ROLE_KEYS as readonly string[]).includes(value);
}

/** The reach-carrying role this user's legacy membership resolves to, or `null`. */
async function desiredReachRoleKey(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<ReachRoleKey | null> {
  const resolution = resolveMembershipRoleFrom(
    await workspaceMemberRoles(tx, workspaceId, userId),
  );
  // Ambiguous (duplicate rows), malformed or absent membership: fail closed, no grant.
  if (!resolution.ok || !isReachRoleKey(resolution.role)) return null;
  if (resolution.role === "admin") {
    // A custom `workspace_role` that merely took the name `admin` is not the built-in.
    const [row] = await tx
      .select({ isSystem: schema.workspaceRoleTable.isSystem })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.role, "admin"),
        ),
      )
      .limit(1);
    if (!isGenuineBuiltInRoleGrant("admin", row?.isSystem === true)) {
      return null;
    }
  }
  return resolution.role;
}

async function ensureReachRole(
  tx: Tx,
  workspaceId: string,
  key: ReachRoleKey,
): Promise<string | null> {
  const select = () =>
    tx
      .select({
        id: schema.roleTable.id,
        isSystem: schema.roleTable.isSystem,
      })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.workspaceId, workspaceId),
          eq(schema.roleTable.key, key),
        ),
      )
      .limit(1);
  let [row] = await select();
  if (!row) {
    const builtIn = BUILT_IN_ROLES[key];
    await tx
      .insert(schema.roleTable)
      .values({
        id: createId(),
        scope: "workspace",
        workspaceId,
        key,
        name: key === "owner" ? "Owner" : "Admin",
        description:
          "Workspace-wide reach carrier (explicit sees_all). Authority is not read from this row.",
        rank: builtIn.rank,
        capabilities: [],
        isSystem: true,
        isEditable: false,
      })
      .onConflictDoNothing();
    [row] = await select();
  }
  // A same-keyed custom row is never trusted as the carrier: fail closed (no reach).
  return row?.isSystem === true ? row.id : null;
}

/**
 * Make the person's `sees_all` grant on this workspace match their current legacy
 * `workspace_member` role: present for an unambiguous genuine `owner` / `admin`, absent
 * otherwise. Idempotent.
 */
export async function syncWorkspaceAdminReach(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [person] = await tx
    .select({ id: schema.personTable.id, side: schema.personTable.side })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .for("update")
    .limit(1);
  // No provisioned staff person: there is nothing to hold a grant.
  if (person?.side !== "staff") return;

  const desired = await desiredReachRoleKey(tx, workspaceId, userId);
  const roleId =
    desired === null ? null : await ensureReachRole(tx, workspaceId, desired);

  const [existing] = await tx
    .select({
      id: schema.membershipGrantTable.id,
      roleId: schema.membershipGrantTable.roleId,
      seesAll: schema.membershipGrantTable.seesAll,
      directOrigin: schema.membershipGrantTable.directOrigin,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, person.id),
        eq(schema.membershipGrantTable.scope, "workspace"),
        eq(schema.membershipGrantTable.scopeId, workspaceId),
        eq(schema.membershipGrantTable.sourceKind, "direct"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .for("update")
    .limit(1);

  // An explicit admin-made direct grant is not ours to change, in either direction.
  if (existing && existing.directOrigin !== "system_backfill") return;

  const now = new Date();
  if (roleId === null) {
    if (!existing) return;
    await tx
      .update(schema.membershipGrantTable)
      .set({
        revokedAt: now,
        revocationReason: "direct_removed",
        membershipId: null,
        updatedAt: now,
      })
      .where(eq(schema.membershipGrantTable.id, existing.id));
  } else if (!existing) {
    await tx.insert(schema.membershipGrantTable).values({
      id: createId(),
      personId: person.id,
      scope: "workspace",
      scopeId: workspaceId,
      roleId,
      sourceKind: "direct",
      directOrigin: "system_backfill",
      seesAll: true,
    });
  } else if (existing.roleId !== roleId || !existing.seesAll) {
    await tx
      .update(schema.membershipGrantTable)
      .set({ roleId, seesAll: true, updatedAt: now })
      .where(eq(schema.membershipGrantTable.id, existing.id));
  }

  await projectMembershipKeys(tx, [
    { personId: person.id, scope: "workspace", scopeId: workspaceId },
  ]);
}

/**
 * Remove this workspace's reach rows before the workspace row itself is deleted.
 * `membership.role_id` and `membership_grant.role_id` are `ON DELETE RESTRICT`, so the
 * `role` rows that `workspace.id` cascades to cannot be deleted while a grant or membership
 * still references them. Only workspace-scoped DIRECT `system_backfill` grants and the
 * workspace-scoped memberships are removed; nothing outside these workspaces is touched.
 */
export async function removeWorkspaceAdminReach(
  tx: Tx,
  workspaceIds: readonly string[],
): Promise<void> {
  if (workspaceIds.length === 0) return;
  await tx
    .delete(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.scope, "workspace"),
        inArray(schema.membershipGrantTable.scopeId, [...workspaceIds]),
        eq(schema.membershipGrantTable.sourceKind, "direct"),
        eq(schema.membershipGrantTable.directOrigin, "system_backfill"),
      ),
    );
  await tx
    .delete(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.scope, "workspace"),
        inArray(schema.membershipTable.scopeId, [...workspaceIds]),
      ),
    );
}
