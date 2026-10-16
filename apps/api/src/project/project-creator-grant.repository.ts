import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "../database";
import type { Executor } from "../database/executor";

export const PROJECT_LEAD_ROLE_KEY = "project-lead";
export const PROJECT_CREATOR_ORIGIN = "project_creator";

export type ProjectCreatorGrantFilter =
  | { kind: "member"; workspaceId: string; personId: string }
  | { kind: "project"; workspaceId: string; projectId: string };

export async function findProjectLeadRole(
  executor: Executor,
  workspaceId: string,
): Promise<{ id: string; isSystem: boolean } | undefined> {
  const [row] = await executor
    .select({ id: schema.roleTable.id, isSystem: schema.roleTable.isSystem })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "project"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, PROJECT_LEAD_ROLE_KEY),
      ),
    )
    .limit(1);
  return row;
}

export async function insertProjectLeadRole(
  executor: Executor,
  workspaceId: string,
): Promise<void> {
  const lead = BUILT_IN_ROLES.lead;
  await executor
    .insert(schema.roleTable)
    .values({
      id: createId(),
      scope: "project",
      workspaceId,
      key: PROJECT_LEAD_ROLE_KEY,
      name: "Project lead",
      description:
        "Project-scope lead granted to the creator of a project (rbac.md built-in lead capabilities).",
      rank: lead.rank,
      capabilities: [...lead.capabilities],
      isSystem: true,
      isEditable: true,
    })
    .onConflictDoNothing();
}

export async function findCreatorPersonForUpdate(
  executor: Executor,
  userId: string,
): Promise<{ id: string; side: string; organisationId: string } | undefined> {
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

export async function findCreatorPerson(
  executor: Executor,
  userId: string,
): Promise<{ id: string } | undefined> {
  const [person] = await executor
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  return person;
}

export async function creatorHasWorkspaceSeesAll(
  executor: Executor,
  personId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: schema.membershipTable.id })
    .from(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, personId),
        eq(schema.membershipTable.scope, "workspace"),
        eq(schema.membershipTable.scopeId, workspaceId),
        eq(schema.membershipTable.seesAll, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function hasActiveDirectProjectGrant(
  executor: Executor,
  personId: string,
  projectId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: schema.membershipGrantTable.id })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, personId),
        eq(schema.membershipGrantTable.scope, "project"),
        eq(schema.membershipGrantTable.scopeId, projectId),
        eq(schema.membershipGrantTable.sourceKind, "direct"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function insertProjectCreatorGrant(
  executor: Executor,
  input: { personId: string; projectId: string; roleId: string },
): Promise<void> {
  await executor.insert(schema.membershipGrantTable).values({
    id: createId(),
    personId: input.personId,
    scope: "project",
    scopeId: input.projectId,
    roleId: input.roleId,
    sourceKind: "direct",
    directOrigin: PROJECT_CREATOR_ORIGIN,
    seesAll: false,
  });
}

function creatorGrantPredicate(
  executor: Executor,
  filter: ProjectCreatorGrantFilter,
) {
  const scopePredicate =
    filter.kind === "project"
      ? inArray(
          schema.membershipGrantTable.scopeId,
          executor
            .select({ id: schema.projectTable.id })
            .from(schema.projectTable)
            .where(
              and(
                eq(schema.projectTable.id, filter.projectId),
                eq(schema.projectTable.workspaceId, filter.workspaceId),
              ),
            ),
        )
      : inArray(
          schema.membershipGrantTable.scopeId,
          executor
            .select({ id: schema.projectTable.id })
            .from(schema.projectTable)
            .where(eq(schema.projectTable.workspaceId, filter.workspaceId)),
        );
  const personPredicate =
    filter.kind === "member"
      ? eq(schema.membershipGrantTable.personId, filter.personId)
      : undefined;
  return and(
    eq(schema.membershipGrantTable.scope, "project"),
    scopePredicate,
    eq(schema.membershipGrantTable.sourceKind, "direct"),
    eq(schema.membershipGrantTable.directOrigin, PROJECT_CREATOR_ORIGIN),
    isNull(schema.membershipGrantTable.revokedAt),
    personPredicate,
  );
}

export async function listCreatorGrantPersonIds(
  executor: Executor,
  filter: ProjectCreatorGrantFilter,
): Promise<string[]> {
  const rows = await executor
    .select({ personId: schema.membershipGrantTable.personId })
    .from(schema.membershipGrantTable)
    .where(creatorGrantPredicate(executor, filter));
  return rows.map((row) => row.personId);
}

export async function lockCreatorGrantPeople(
  executor: Executor,
  personIds: readonly string[],
): Promise<{ id: string; organisationId: string | null }[]> {
  if (personIds.length === 0) return [];
  return await executor
    .select({
      id: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(inArray(schema.personTable.id, [...personIds]))
    .orderBy(schema.personTable.id)
    .for("update");
}

export async function lockCreatorGrants(
  executor: Executor,
  filter: ProjectCreatorGrantFilter,
): Promise<{ id: string; personId: string; scopeId: string }[]> {
  return await executor
    .select({
      id: schema.membershipGrantTable.id,
      personId: schema.membershipGrantTable.personId,
      scopeId: schema.membershipGrantTable.scopeId,
    })
    .from(schema.membershipGrantTable)
    .where(creatorGrantPredicate(executor, filter))
    .orderBy(schema.membershipGrantTable.id)
    .for("update");
}

export async function revokeCreatorGrants(
  executor: Executor,
  grantIds: readonly string[],
  now: Date,
): Promise<void> {
  if (grantIds.length === 0) return;
  await executor
    .update(schema.membershipGrantTable)
    .set({
      revokedAt: now,
      revocationReason: "direct_removed",
      membershipId: null,
      updatedAt: now,
    })
    .where(inArray(schema.membershipGrantTable.id, [...grantIds]));
}
