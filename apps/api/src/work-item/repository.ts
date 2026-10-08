import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type db from "../database";
import {
  activityTable,
  commentTable,
  commentVersionTable,
  membershipTable,
  personTable,
  projectTable,
  roleTable,
  slaPolicyTable,
  slaPolicyVersionTable,
  stateTable,
  stateTemplateTable,
  userTable,
  watcherTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
  workItemTable,
  workItemTypeTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

export type WorkItemQueryExecutor =
  | Pick<typeof db, "select">
  | Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "select">;
type Executor = WorkItemQueryExecutor;
type RelationalExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getWorkflowWorkItemQuery(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      typeId: workItemTable.typeId,
      stateId: workItemTable.stateId,
      assigneeId: workItemTable.assigneeId,
      parentId: workItemTable.parentId,
      version: workItemTable.version,
      resolvedAt: workItemTable.resolvedAt,
    })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .limit(1);
}

export async function getWorkflowCurrentStateQuery(
  executor: Executor,
  stateId: string,
) {
  return executor
    .select({
      stateTemplateId: stateTable.stateTemplateId,
      group: stateTemplateTable.group,
    })
    .from(stateTable)
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(eq(stateTable.id, stateId))
    .limit(1);
}

export async function getWorkItemTypeWorkflowQuery(
  executor: Executor,
  typeId: string,
) {
  return executor
    .select({
      workflowId: workItemTypeTable.workflowId,
      isChange: workItemTypeTable.isChange,
    })
    .from(workItemTypeTable)
    .where(eq(workItemTypeTable.id, typeId))
    .limit(1);
}

export async function listWorkspaceStateTemplateGroupsQuery(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({ id: stateTemplateTable.id, group: stateTemplateTable.group })
    .from(stateTemplateTable)
    .where(eq(stateTemplateTable.workspaceId, workspaceId));
}

export async function listProjectAdoptedStatesQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({ id: stateTable.id, stateTemplateId: stateTable.stateTemplateId })
    .from(stateTable)
    .where(
      and(eq(stateTable.projectId, projectId), isNull(stateTable.archivedAt)),
    );
}

export async function getWorkflowActiveVersionQuery(
  executor: Executor,
  workflowId: string,
) {
  return executor
    .select({ activeVersionId: workflowTable.activeVersionId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1);
}

export async function getWorkflowVersionQuery(
  executor: Executor,
  versionId: string,
) {
  return executor
    .select({
      id: workflowVersionTable.id,
      number: workflowVersionTable.number,
    })
    .from(workflowVersionTable)
    .where(eq(workflowVersionTable.id, versionId))
    .limit(1);
}

export async function listWorkflowTransitionsQuery(
  executor: Executor,
  versionId: string,
) {
  return executor
    .select()
    .from(workflowTransitionTable)
    .where(eq(workflowTransitionTable.versionId, versionId));
}

export async function listProjectMembershipRolesQuery(
  executor: Executor,
  personId: string,
  projectId: string,
) {
  return executor
    .select({ roleId: membershipTable.roleId })
    .from(membershipTable)
    .where(
      and(
        eq(membershipTable.personId, personId),
        eq(membershipTable.scopeId, projectId),
      ),
    );
}

export async function listWorkspaceMembershipRolesQuery(
  executor: Executor,
  personId: string,
  workspaceId: string,
) {
  return executor
    .select({ roleId: membershipTable.roleId })
    .from(membershipTable)
    .where(
      and(
        eq(membershipTable.personId, personId),
        eq(membershipTable.scopeId, workspaceId),
      ),
    );
}

export async function listUnarchivedChildrenStateTemplatesQuery(
  executor: Executor,
  parentId: string,
) {
  return executor
    .select({ stateTemplateId: stateTable.stateTemplateId })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .where(
      and(
        eq(workItemTable.parentId, parentId),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
      ),
    );
}

export async function getAncestorQuery(executor: Executor, workItemId: string) {
  return executor
    .select({ parentId: workItemTable.parentId })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .limit(1);
}

export async function listDescendantIdsQuery(
  executor: Executor,
  parentIds: string[],
) {
  return executor
    .select({ id: workItemTable.id })
    .from(workItemTable)
    .where(inArray(workItemTable.parentId, parentIds));
}

export async function findHierarchyRootQuery(
  executor: Executor,
  rootId: string,
) {
  return executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      parentId: workItemTable.parentId,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(eq(workItemTable.id, rootId))
    .orderBy(workItemTable.position, workItemTable.id);
}

export async function listHierarchyChildrenQuery(
  executor: Executor,
  parentIds: string[],
  limit: number,
) {
  return executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      parentId: workItemTable.parentId,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(inArray(workItemTable.parentId, parentIds))
    .orderBy(workItemTable.position, workItemTable.id)
    .limit(limit);
}

export async function findAssigneeEligibilityQuery(
  executor: Executor,
  projectId: string,
  personId: string,
) {
  return executor
    .select({ active: personTable.active })
    .from(membershipTable)
    .innerJoin(personTable, eq(personTable.id, membershipTable.personId))
    .where(
      and(
        eq(membershipTable.scope, "project"),
        eq(membershipTable.scopeId, projectId),
        eq(membershipTable.personId, personId),
      ),
    )
    .limit(1);
}

export async function lockLiveProjectQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .for("share");
}

export async function findWorkItemReachQuery(
  executor: Executor,
  key: string,
  includeOrganisation: boolean,
): Promise<
  Array<{
    id: string;
    projectId: string;
    workspaceId: string;
    organisationId?: string | null;
  }>
> {
  const where = and(
    eq(workItemTable.key, key),
    isNull(workItemTable.deletedAt),
    isNull(workItemTable.archivedAt),
    isNull(projectTable.deletedAt),
  );
  if (includeOrganisation) {
    return executor
      .select({
        id: workItemTable.id,
        projectId: workItemTable.projectId,
        workspaceId: workItemTable.workspaceId,
        organisationId: projectTable.organisationId,
      })
      .from(workItemTable)
      .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(workspaceTable.id, workItemTable.workspaceId),
      )
      .where(where)
      .limit(1);
  }
  return executor
    .select({
      id: workItemTable.id,
      projectId: workItemTable.projectId,
      workspaceId: workItemTable.workspaceId,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .where(where)
    .limit(1);
}

export async function findCommentReachQuery(executor: Executor, id: string) {
  return executor
    .select({
      id: commentTable.id,
      workItemId: commentTable.workItemId,
      workspaceId: commentTable.workspaceId,
      authorId: commentTable.authorId,
    })
    .from(commentTable)
    .innerJoin(workItemTable, eq(commentTable.workItemId, workItemTable.id))
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .where(
      and(
        eq(commentTable.id, id),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
}

export async function getWorkItemSlaSourceQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      workspaceId: workItemTable.workspaceId,
      typeId: workItemTable.typeId,
      priority: workItemTable.priority,
      slaStartedAt: workItemTable.slaStartedAt,
      slaPolicyVersionId: workItemTable.slaPolicyVersionId,
      firstResponseAt: workItemTable.firstResponseAt,
      resolvedAt: workItemTable.resolvedAt,
      createdAt: workItemTable.createdAt,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export async function listWorkItemTypesQuery(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({
      id: workItemTypeTable.id,
      key: workItemTypeTable.key,
      name: workItemTypeTable.name,
      icon: workItemTypeTable.icon,
      category: workItemTypeTable.category,
      isEpic: workItemTypeTable.isEpic,
      isChange: workItemTypeTable.isChange,
    })
    .from(workItemTypeTable)
    .where(eq(workItemTypeTable.workspaceId, workspaceId))
    .orderBy(asc(workItemTypeTable.category), asc(workItemTypeTable.name));
}

export async function getWorkItemByKeyQuery(executor: Executor, key: string) {
  return executor
    .select({
      workItem: workItemTable,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      defaultCommentVisibility: projectTable.defaultCommentVisibility,
      assigneeName: userTable.name,
      assigneeIsWorkspaceMember: workspaceUserTable.id,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .leftJoin(personTable, eq(workItemTable.assigneeId, personTable.id))
    .leftJoin(userTable, eq(personTable.userId, userTable.id))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, workItemTable.workspaceId),
      ),
    )
    .where(eq(workItemTable.key, key))
    .limit(1);
}

export async function findPersonForWorkItemFilterQuery(
  executor: RelationalExecutor,
  callerUserId: string,
) {
  return executor.query.personTable.findFirst({
    where: eq(personTable.userId, callerUserId),
  });
}

export async function listWorkItemsQuery(
  executor: Executor,
  pageWhere: SQL | undefined,
  sort: SQL[],
  limit: number,
) {
  return executor
    .select({
      workItem: workItemTable,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      assigneeName: userTable.name,
      assigneeIsWorkspaceMember: workspaceUserTable.id,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .leftJoin(personTable, eq(workItemTable.assigneeId, personTable.id))
    .leftJoin(userTable, eq(personTable.userId, userTable.id))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, workItemTable.workspaceId),
      ),
    )
    .where(pageWhere)
    .orderBy(...sort)
    .limit(limit);
}

export async function countWorkItemsQuery(
  executor: Executor,
  where: SQL | undefined,
) {
  return executor
    .select({ total: sql<number>`count(*)::int` })
    .from(workItemTable)
    .where(where);
}

export async function findWorkItemTreeRootQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select({ id: workItemTable.id })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export async function findCreateProjectQuery(
  executor: RelationalExecutor,
  projectId: string,
  workspaceId: string,
) {
  return executor.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, projectId),
      eq(projectTable.workspaceId, workspaceId),
      isNull(projectTable.deletedAt),
    ),
  });
}

export async function findCreateWorkItemTypeQuery(
  executor: RelationalExecutor,
  typeId: string,
  workspaceId: string,
) {
  return executor.query.workItemTypeTable.findFirst({
    where: and(
      eq(workItemTypeTable.id, typeId),
      eq(workItemTypeTable.workspaceId, workspaceId),
    ),
  });
}

export async function findDefaultProjectStateQuery(
  executor: RelationalExecutor,
  projectId: string,
) {
  return executor.query.stateTable.findFirst({
    where: and(
      eq(stateTable.projectId, projectId),
      eq(stateTable.isDefault, true),
    ),
  });
}

export async function findWorkspaceDefaultSlaPolicyQuery(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({ slaPolicyId: workspaceTable.defaultSlaPolicyId })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
}

export async function findWorkspaceOwnedSlaPolicyQuery(
  executor: Executor,
  policyId: string,
  workspaceId: string,
) {
  return executor
    .select({ id: slaPolicyTable.id })
    .from(slaPolicyTable)
    .where(
      and(
        eq(slaPolicyTable.id, policyId),
        eq(slaPolicyTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export async function findEffectiveSlaPolicyVersionQuery(
  executor: Executor,
  workspaceId: string,
  policyId: string,
  slaStartedAt: Date,
) {
  return executor
    .select({ id: slaPolicyVersionTable.id })
    .from(slaPolicyVersionTable)
    .where(
      and(
        eq(slaPolicyVersionTable.workspaceId, workspaceId),
        eq(slaPolicyVersionTable.policyId, policyId),
        isNotNull(slaPolicyVersionTable.effectiveFrom),
        lte(slaPolicyVersionTable.effectiveFrom, slaStartedAt),
      ),
    )
    .orderBy(
      desc(slaPolicyVersionTable.effectiveFrom),
      desc(slaPolicyVersionTable.number),
    )
    .limit(1);
}

export async function findWorkItemForShareQuery(
  executor: Executor,
  key: string,
) {
  return executor
    .select()
    .from(workItemTable)
    .where(eq(workItemTable.key, key))
    .for("share");
}

export async function findPersonByUserIdQuery(
  executor: RelationalExecutor,
  userId: string,
) {
  return executor.query.personTable.findFirst({
    where: eq(personTable.userId, userId),
  });
}

export async function findWatcherQuery(
  executor: Executor,
  workItemId: string,
  personId: string,
) {
  return executor
    .select()
    .from(watcherTable)
    .where(
      and(
        eq(watcherTable.workItemId, workItemId),
        eq(watcherTable.personId, personId),
      ),
    )
    .limit(1);
}

export async function findUnassignableWorkItemQuery(
  executor: RelationalExecutor,
  key: string,
) {
  return executor.query.workItemTable.findFirst({
    where: and(
      eq(workItemTable.key, key),
      isNull(workItemTable.archivedAt),
      isNull(workItemTable.deletedAt),
    ),
  });
}

export async function findAssignableWorkItemQuery(
  executor: Executor,
  key: string,
) {
  return executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      assigneeId: workItemTable.assigneeId,
      version: workItemTable.version,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .where(
      and(
        eq(workItemTable.key, key),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
}

export async function findCurrentWorkItemAssigneeQuery(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({ assigneeId: workItemTable.assigneeId })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .limit(1);
}

export async function findStaffPersonOnProjectRosterQuery(
  executor: Executor,
  userId: string,
  projectId: string,
) {
  return executor
    .select({ id: personTable.id })
    .from(personTable)
    .innerJoin(membershipTable, eq(membershipTable.personId, personTable.id))
    .where(
      and(
        eq(personTable.userId, userId),
        eq(personTable.side, "staff"),
        eq(membershipTable.scope, "project"),
        eq(membershipTable.scopeId, projectId),
      ),
    )
    .orderBy(personTable.createdAt)
    .limit(1);
}

export async function findPersonIdByUserIdQuery(
  executor: Executor,
  userId: string,
) {
  return executor
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
}

export async function findWorkItemAssigneeForActorQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select({ assigneeId: workItemTable.assigneeId })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
      ),
    )
    .limit(1);
}

export async function lockWorkItemForCommentQuery(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({
      projectId: workItemTable.projectId,
      key: workItemTable.key,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .for("share");
}

export async function lockCommentForMutationQuery(
  executor: Executor,
  commentId: string,
  workspaceId: string,
) {
  return executor
    .select()
    .from(commentTable)
    .where(
      and(
        eq(commentTable.id, commentId),
        eq(commentTable.workspaceId, workspaceId),
      ),
    )
    .for("update");
}

export async function lockWorkItemForCommentMutationQuery(
  executor: Executor,
  workItemId: string,
  workspaceId: string,
) {
  return executor
    .select({
      id: workItemTable.id,
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.id, workItemId),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .for("share");
}

export async function countCommentVersionsQuery(
  executor: Executor,
  commentId: string,
) {
  return executor
    .select({ value: count() })
    .from(commentVersionTable)
    .where(eq(commentVersionTable.commentId, commentId));
}

export async function findLiveCommentVersionParentQuery(
  executor: Executor,
  commentId: string,
  workItemId: string,
) {
  return executor
    .select({ id: commentTable.id })
    .from(commentTable)
    .where(
      and(
        eq(commentTable.id, commentId),
        eq(commentTable.workItemId, workItemId),
        isNull(commentTable.deletedAt),
      ),
    )
    .limit(1);
}

export async function listCommentVersionPageQuery(
  executor: Executor,
  commentId: string,
  after: { number: number; id: string } | undefined,
  limit: number,
) {
  const conditions: SQL[] = [eq(commentVersionTable.commentId, commentId)];
  if (after) {
    const continuation = or(
      gt(commentVersionTable.number, after.number),
      and(
        eq(commentVersionTable.number, after.number),
        gt(commentVersionTable.id, after.id),
      ),
    );
    if (continuation) conditions.push(continuation);
  }
  return executor
    .select({
      id: commentVersionTable.id,
      number: commentVersionTable.number,
      body: commentVersionTable.body,
      editedBy: commentVersionTable.editedBy,
      createdAt: commentVersionTable.createdAt,
    })
    .from(commentVersionTable)
    .where(and(...conditions))
    .orderBy(asc(commentVersionTable.number), asc(commentVersionTable.id))
    .limit(limit);
}

export async function lockWorkItemByKeyQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select()
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .for("update");
}

export async function lockLiveWorkItemByKeyQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select()
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
      ),
    )
    .for("update");
}

export async function findWorkItemProjectByKeyQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export async function lockParentByKeyQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select()
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .for("share");
}

export async function lockDeletableWorkItemQuery(
  executor: Executor,
  key: string,
  workspaceId: string,
) {
  return executor
    .select({
      id: workItemTable.id,
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
}

export async function listAssignableRosterQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({
      personId: membershipTable.personId,
      roleName: roleTable.name,
      roleRank: roleTable.rank,
      name: userTable.name,
    })
    .from(membershipTable)
    .innerJoin(personTable, eq(personTable.id, membershipTable.personId))
    .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(
      and(
        eq(membershipTable.scope, "project"),
        eq(membershipTable.scopeId, projectId),
        eq(personTable.active, true),
        eq(personTable.side, "staff"),
        eq(personTable.isPlaceholder, false),
      ),
    );
}

export async function listAssignableLoadQuery(
  executor: Executor,
  workspaceId: string,
  personIds: string[],
  closedGroups: string[],
) {
  return executor
    .select({ assigneeId: workItemTable.assigneeId, open: count() })
    .from(workItemTable)
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        isNotNull(workItemTable.assigneeId),
        inArray(workItemTable.assigneeId, personIds),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
        notInArray(stateTemplateTable.group, closedGroups),
      ),
    )
    .groupBy(workItemTable.assigneeId);
}

export async function listRankNeighboursQuery(
  executor: Executor,
  projectId: string,
  stateId: string,
) {
  return executor
    .select({ id: workItemTable.id, position: workItemTable.position })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.projectId, projectId),
        eq(workItemTable.stateId, stateId),
        isNull(workItemTable.deletedAt),
      ),
    );
}

export async function lockTransitionWorkItemQuery(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({
      stateId: workItemTable.stateId,
      assigneeId: workItemTable.assigneeId,
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .for("update");
}

export async function lockTransitionChildrenQuery(
  executor: Executor,
  parentId: string,
) {
  return executor
    .select({ id: workItemTable.id, stateId: workItemTable.stateId })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.parentId, parentId),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
      ),
    )
    .for("share");
}

export async function listTransitionChildStateGroupsQuery(
  executor: Executor,
  stateIds: string[],
) {
  return executor
    .select({ id: stateTable.id, group: stateTemplateTable.group })
    .from(stateTable)
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(inArray(stateTable.id, stateIds));
}

export async function findCurrentTransitionStateQuery(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({ stateId: workItemTable.stateId })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .limit(1);
}

export async function findActivityWorkItemByKeyQuery(
  executor: RelationalExecutor,
  key: string,
) {
  return executor.query.workItemTable.findFirst({
    where: eq(workItemTable.key, key),
  });
}

export async function listWorkItemActivityRowsQuery(
  executor: Executor,
  conditions: SQL[],
  limit: number,
) {
  return executor
    .select({
      id: activityTable.id,
      workItemId: activityTable.workItemId,
      actorId: activityTable.actorId,
      actorType: activityTable.actorType,
      verb: activityTable.verb,
      field: activityTable.field,
      oldValue: activityTable.oldValue,
      newValue: activityTable.newValue,
      payload: activityTable.payload,
      visibility: activityTable.visibility,
      workflowVersionId: activityTable.workflowVersionId,
      createdAt: activityTable.createdAt,
    })
    .from(activityTable)
    .where(and(...conditions))
    .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
    .limit(limit);
}

export async function listWorkItemCommentRowsQuery(
  executor: Executor,
  conditions: SQL[],
  createdAt: SQL,
  limit: number,
) {
  return executor
    .select({
      id: commentTable.id,
      workItemId: commentTable.workItemId,
      authorId: commentTable.authorId,
      actorType: commentTable.actorType,
      body: commentTable.body,
      visibility: commentTable.visibility,
      activityId: commentTable.activityId,
      editedAt: commentTable.editedAt,
      deletedAt: commentTable.deletedAt,
      deletedBy: commentTable.deletedBy,
      createdAt: commentTable.createdAt,
      updatedAt: commentTable.updatedAt,
    })
    .from(commentTable)
    .where(and(...conditions))
    .orderBy(desc(createdAt), desc(commentTable.id))
    .limit(limit);
}
