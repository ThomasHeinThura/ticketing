import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { projectMembershipKeys } from "../identity/membership-projection";
import { revokeProjectCreatorGrantsOnSeesAll } from "../project/project-creator-grant";
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
 * LOCK ORDER (checked for deadlocks against the audit chain). This function takes the
 * person row `FOR UPDATE` first, then the grant rows, and only at the very end the audit
 * chain advisory lock (`appendAuditLog`, held until commit). That is the repo-wide order:
 * `invalidateAccountDeletionCredentials` locks the person row before it audits, the
 * identity writers lock person before audit, and `withWorkspaceDeletionAccessLifecycle`
 * audits only AFTER `mutate` (where the sync runs). No transaction here audits and then
 * locks a person row, so person -> audit never meets audit -> person. A new caller must not
 * call this after `appendAuditLog` in the same transaction without locking the person first
 * (`lockPersonsInOrder`).
 *
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
    .select({
      id: schema.personTable.id,
      side: schema.personTable.side,
      organisationId: schema.personTable.organisationId,
    })
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
  let change: "granted" | "revoked" | null = null;
  if (roleId === null) {
    if (!existing) return;
    change = "revoked";
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
    change = "granted";
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
    change = "granted";
    await tx
      .update(schema.membershipGrantTable)
      .set({ roleId, seesAll: true, updatedAt: now })
      .where(eq(schema.membershipGrantTable.id, existing.id));
  }

  await projectMembershipKeys(tx, [
    { personId: person.id, scope: "workspace", scopeId: workspaceId },
  ]);

  // A creator promoted to owner/admin must not keep a project-scope creator grant (decision
  // log 2026-10-14, "A project's creator holds a project-lead membership"): it would replace
  // their workspace authority on that project. Same transaction, audited.
  if (roleId !== null) {
    await revokeProjectCreatorGrantsOnSeesAll(tx, workspaceId, person.id);
  }

  // Audit (rbac.md / security-model.md: `sees_all` changes are audited reach changes).
  // A system action: no acting person. Granting uses `membership.sees_all_granted`;
  // revoking uses `membership.changed` (the catalogue has no separate revoke key). Written
  // in the same transaction as the grant so the two commit or roll back together. Only a real
  // change is recorded; an idempotent re-sync writes nothing. The migration backfill (0123)
  // cannot write hash-chained audit rows from SQL, so it writes none and is recorded by the
  // decision log and the migration itself; the boot reconcile runs this function and does
  // audit.
  if (change !== null) {
    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      organisationId: person.organisationId,
      workspaceId,
      action:
        change === "granted"
          ? "membership.sees_all_granted"
          : "membership.changed",
      entityType: "membership",
      entityId: person.id,
      after: {
        source: "workspace_role",
        scope: "workspace",
        scopeId: workspaceId,
        seesAll: change === "granted",
        ...(desired === null ? {} : { role: desired }),
      },
    });
  }
}

/**
 * Lock the `person` rows of these users in one deterministic order (by person id) so two
 * transactions that each sync the same pair of people in opposite directions cannot
 * deadlock on them. `syncWorkspaceAdminReach` re-locks the same rows, which is free.
 */
export async function lockPersonsInOrder(
  tx: Tx,
  userIds: readonly string[],
): Promise<void> {
  await tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(inArray(schema.personTable.userId, [...userIds]))
    .orderBy(schema.personTable.id)
    .for("update");
}

/**
 * Boot-time reconciliation (idempotent). The writers keep the grant current at every role
 * change, but two cases change the INPUTS to `syncWorkspaceAdminReach` without a role
 * change: a staff `person` created after the member joined (`ensureStaffPersonForUser`,
 * the boot person backfill) and the every-boot `workspace_role.is_system` heal
 * (`seed-default-workspace-roles.ts`, issue #318). So the boot sequence runs this after
 * both seeds: for every legacy `owner`/`admin` membership whose person holds no active
 * direct workspace grant yet, run the same per-member sync in its own transaction.
 * Members who already hold any active direct grant are skipped (cheap, and the sync would
 * leave an admin-made grant alone anyway). Returns the number of members visited.
 */
export async function reconcileWorkspaceAdminReach(): Promise<{
  visited: number;
  failed: number;
}> {
  const database = db;
  const candidates = await database
    .select({
      workspaceId: schema.workspaceUserTable.workspaceId,
      userId: schema.workspaceUserTable.userId,
      personId: schema.personTable.id,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.workspaceUserTable.userId),
    )
    .where(
      and(
        inArray(schema.workspaceUserTable.role, [...REACH_ROLE_KEYS]),
        eq(schema.personTable.side, "staff"),
        notExists(
          database
            .select({ one: sql`1` })
            .from(schema.membershipGrantTable)
            .where(
              and(
                eq(schema.membershipGrantTable.personId, schema.personTable.id),
                eq(schema.membershipGrantTable.scope, "workspace"),
                eq(
                  schema.membershipGrantTable.scopeId,
                  schema.workspaceUserTable.workspaceId,
                ),
                eq(schema.membershipGrantTable.sourceKind, "direct"),
                isNull(schema.membershipGrantTable.revokedAt),
              ),
            ),
        ),
      ),
    );
  // Each member is fail-safe: one bad row (corrupt data, a failed audit write) must never
  // abort API boot. A failure is logged with the workspace and person ids, counted, and
  // the next member is tried; the member simply keeps no grant until the next boot or role
  // change (fail closed: a failed sync never grants reach it could not complete).
  let failed = 0;
  for (const { workspaceId, userId, personId } of candidates) {
    try {
      await database.transaction((tx) =>
        syncWorkspaceAdminReach(tx, workspaceId, userId),
      );
    } catch (error) {
      failed += 1;
      console.error(
        `❌ Owner/admin reach reconcile failed for workspace ${workspaceId}, person ${personId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(
    `✅ Owner/admin reach reconcile: ${candidates.length} member(s) visited, ${failed} failed.`,
  );
  return { visited: candidates.length, failed };
}
