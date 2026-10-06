import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "../database";

export type IdentityExecutor = Pick<typeof db, "select">;

export function getWorkspaceById(workspaceId: string) {
  return db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
}

export function listWorkspaceMembershipsForShadow(
  userId: string,
  workspaceId: string,
) {
  return db
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.workspaceUserTable.workspaceId),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(2);
}

export function getProjectReadEvidence(projectId: string) {
  return db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.workspaceTable.organisationId,
    })
    .from(schema.projectTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
    )
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
}

export function getTaskPolicyEvidence(taskId: string) {
  return db
    .select({ id: schema.taskTable.id, projectId: schema.taskTable.projectId })
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId))
    .limit(1);
}

export function getModernWorkItemVisibilityEvidence(workItemId: string) {
  return db
    .select({
      id: schema.workItemTable.id,
      projectId: schema.workItemTable.projectId,
      workspaceId: schema.workItemTable.workspaceId,
      requesterId: schema.workItemTable.requesterId,
      customerVisibility: schema.workItemTable.customerVisibility,
    })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, workItemId))
    .limit(1);
}

export function listWorkItemWatcherPersonIds(workItemId: string) {
  return db
    .select({ personId: schema.watcherTable.personId })
    .from(schema.watcherTable)
    .where(eq(schema.watcherTable.workItemId, workItemId));
}

export function getTaskAuthorityEvidence(taskId: string) {
  return db
    .select({
      id: schema.taskTable.id,
      projectId: schema.taskTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
      assigneeId: schema.taskTable.userId,
    })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.taskTable.projectId),
    )
    .where(eq(schema.taskTable.id, taskId))
    .limit(1);
}

export function getWorkItemAuthorityEvidence(workItemId: string) {
  return db
    .select({
      id: schema.workItemTable.id,
      projectId: schema.workItemTable.projectId,
      workspaceId: schema.workItemTable.workspaceId,
      assigneeId: schema.workItemTable.assigneeId,
      requesterId: schema.workItemTable.requesterId,
    })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, workItemId))
    .limit(1);
}

export function getCommentOwnerEvidence(commentId: string) {
  return db
    .select({
      id: schema.commentTable.id,
      personId: schema.commentTable.authorId,
      workspaceId: schema.commentTable.workspaceId,
      workItemId: schema.commentTable.workItemId,
    })
    .from(schema.commentTable)
    .where(eq(schema.commentTable.id, commentId))
    .limit(1);
}

export function listWorkspaceMembershipEvidence(
  userId: string,
  workspaceId: string,
) {
  return db
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.workspaceUserTable.workspaceId),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(2);
}

export function getIdentityBase(executor: IdentityExecutor, userId: string) {
  return executor
    .select({
      personId: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
      side: schema.personTable.side,
      active: schema.personTable.active,
      instanceRole: schema.userTable.role,
      banned: schema.userTable.banned,
      organisationActive: schema.organisationTable.active,
      organisationPortalAccess: schema.organisationTable.portalAccess,
      organisationDeletedAt: schema.organisationTable.deletedAt,
    })
    .from(schema.userTable)
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .leftJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.personTable.organisationId),
    )
    .where(eq(schema.userTable.id, userId))
    .limit(1);
}

export function listUserWorkspaceMemberships(
  executor: IdentityExecutor,
  userId: string,
) {
  return executor
    .select({
      workspaceId: schema.workspaceUserTable.workspaceId,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, userId));
}

export function listGenuineWorkspaceRoles(
  executor: IdentityExecutor,
  workspaceIds: string[],
) {
  return executor
    .select({
      workspaceId: schema.workspaceRoleTable.workspaceId,
      role: schema.workspaceRoleTable.role,
    })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        inArray(schema.workspaceRoleTable.workspaceId, workspaceIds),
        eq(schema.workspaceRoleTable.isSystem, true),
      ),
    );
}

export function listScopedIdentityRoles(
  executor: IdentityExecutor,
  personId: string,
) {
  return executor
    .select({
      scope: schema.membershipTable.scope,
      scopeId: schema.membershipTable.scopeId,
      seesAll: schema.membershipTable.seesAll,
      inheritedFrom: schema.membershipTable.inheritedFrom,
      roleId: schema.roleTable.id,
      roleKey: schema.roleTable.key,
      roleScope: schema.roleTable.scope,
      roleWorkspaceId: schema.roleTable.workspaceId,
      rank: schema.roleTable.rank,
      capabilities: schema.roleTable.capabilities,
      projectId: schema.projectTable.id,
      projectWorkspaceId: schema.projectTable.workspaceId,
      workspaceId: schema.workspaceTable.id,
      organisationId: schema.organisationTable.id,
    })
    .from(schema.membershipTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.roleTable.id, schema.membershipTable.roleId),
    )
    .leftJoin(
      schema.projectTable,
      and(
        eq(schema.membershipTable.scope, "project"),
        eq(schema.projectTable.id, schema.membershipTable.scopeId),
      ),
    )
    .leftJoin(
      schema.workspaceTable,
      and(
        eq(schema.membershipTable.scope, "workspace"),
        eq(schema.workspaceTable.id, schema.membershipTable.scopeId),
      ),
    )
    .leftJoin(
      schema.organisationTable,
      and(
        eq(schema.membershipTable.scope, "organisation"),
        eq(schema.organisationTable.id, schema.membershipTable.scopeId),
      ),
    )
    .where(eq(schema.membershipTable.personId, personId));
}

export function listUserTeams(executor: IdentityExecutor, userId: string) {
  return executor
    .select({
      teamId: schema.teamMemberTable.teamId,
      workspaceId: schema.teamTable.workspaceId,
    })
    .from(schema.teamMemberTable)
    .innerJoin(
      schema.teamTable,
      eq(schema.teamTable.id, schema.teamMemberTable.teamId),
    )
    .where(eq(schema.teamMemberTable.userId, userId));
}
