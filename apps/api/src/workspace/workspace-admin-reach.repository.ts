import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import {
  isGenuineBuiltInRoleGrant,
  resolveMembershipRoleFrom,
  workspaceMemberRoles,
} from "../utils/workspace-member-roles";

const REACH_ROLE_KEYS = ["owner", "admin"] as const;
export type ReachRoleKey = (typeof REACH_ROLE_KEYS)[number];

function isReachRoleKey(value: string): value is ReachRoleKey {
  return (REACH_ROLE_KEYS as readonly string[]).includes(value);
}

/** Resolve only an unambiguous legacy owner/admin role, including the genuine-admin check. */
export async function desiredWorkspaceAdminReachRole(
  executor: Executor,
  workspaceId: string,
  userId: string,
): Promise<ReachRoleKey | null> {
  const resolution = resolveMembershipRoleFrom(
    await workspaceMemberRoles(
      executor as Parameters<typeof workspaceMemberRoles>[0],
      workspaceId,
      userId,
    ),
  );
  if (!resolution.ok || !isReachRoleKey(resolution.role)) return null;
  if (resolution.role === "admin") {
    const [row] = await executor
      .select({ isSystem: schema.workspaceRoleTable.isSystem })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.role, "admin"),
        ),
      )
      .limit(1);
    if (!isGenuineBuiltInRoleGrant("admin", row?.isSystem === true))
      return null;
  }
  return resolution.role;
}

export async function findWorkspaceAdminReachRole(
  executor: Executor,
  workspaceId: string,
  key: ReachRoleKey,
): Promise<{ id: string; isSystem: boolean } | undefined> {
  const [row] = await executor
    .select({ id: schema.roleTable.id, isSystem: schema.roleTable.isSystem })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, key),
      ),
    )
    .limit(1);
  return row;
}

export async function createWorkspaceAdminReachRole(
  executor: Executor,
  workspaceId: string,
  key: ReachRoleKey,
): Promise<void> {
  const builtIn = BUILT_IN_ROLES[key];
  await executor
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
}

export async function findWorkspaceAdminReachPersonForUpdate(
  executor: Executor,
  userId: string,
): Promise<
  { id: string; side: string; organisationId: string | null } | undefined
> {
  const [person] = await executor
    .select({
      id: schema.personTable.id,
      side: schema.personTable.side,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .for("update")
    .limit(1);
  return person;
}

export async function findActiveWorkspaceAdminReachGrantForUpdate(
  executor: Executor,
  personId: string,
  workspaceId: string,
): Promise<
  | {
      id: string;
      roleId: string;
      seesAll: boolean;
      directOrigin: string | null;
    }
  | undefined
> {
  const [existing] = await executor
    .select({
      id: schema.membershipGrantTable.id,
      roleId: schema.membershipGrantTable.roleId,
      seesAll: schema.membershipGrantTable.seesAll,
      directOrigin: schema.membershipGrantTable.directOrigin,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, personId),
        eq(schema.membershipGrantTable.scope, "workspace"),
        eq(schema.membershipGrantTable.scopeId, workspaceId),
        eq(schema.membershipGrantTable.sourceKind, "direct"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .for("update")
    .limit(1);
  return existing;
}

export async function revokeWorkspaceAdminReachGrant(
  executor: Executor,
  grantId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(schema.membershipGrantTable)
    .set({
      revokedAt: now,
      revocationReason: "direct_removed",
      membershipId: null,
      updatedAt: now,
    })
    .where(eq(schema.membershipGrantTable.id, grantId));
}

export async function insertWorkspaceAdminReachGrant(
  executor: Executor,
  personId: string,
  workspaceId: string,
  roleId: string,
): Promise<void> {
  await executor.insert(schema.membershipGrantTable).values({
    id: createId(),
    personId,
    scope: "workspace",
    scopeId: workspaceId,
    roleId,
    sourceKind: "direct",
    directOrigin: "system_backfill",
    seesAll: true,
  });
}

export async function updateWorkspaceAdminReachGrant(
  executor: Executor,
  grantId: string,
  roleId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(schema.membershipGrantTable)
    .set({ roleId, seesAll: true, updatedAt: now })
    .where(eq(schema.membershipGrantTable.id, grantId));
}

export async function lockWorkspaceAdminReachPersonsInOrder(
  executor: Executor,
  userIds: readonly string[],
): Promise<void> {
  await executor
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(inArray(schema.personTable.userId, [...userIds]))
    .orderBy(schema.personTable.id)
    .for("update");
}

export async function listWorkspaceAdminReachReconcileCandidates(): Promise<
  {
    workspaceId: string;
    userId: string;
    personId: string;
  }[]
> {
  return db
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
          db
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
}
