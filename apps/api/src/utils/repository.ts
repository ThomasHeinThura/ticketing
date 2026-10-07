import type { SQL, SQLWrapper } from "drizzle-orm";
import {
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import db, { schema } from "../database";

type WorkspaceLookupResource =
  | "project"
  | "task"
  | "label"
  | "timeEntry"
  | "activity"
  | "comment"
  | "column"
  | "workflowRule"
  | "workflow"
  | "workflowVersion"
  | "savedView";

export type WorkspaceLookupRow = {
  workspaceId: string | null;
  projectId?: string;
  workItemId?: string;
  organisationId?: string | null;
} | null;

export async function lookupWorkspaceResource(
  resource: WorkspaceLookupResource,
  id: string,
  reach: (workspaceId: SQLWrapper) => SQL,
  observerOnly: boolean,
): Promise<WorkspaceLookupRow> {
  const liveProject = observerOnly
    ? [isNull(schema.projectTable.deletedAt)]
    : [];
  switch (resource) {
    case "project":
      return (
        (
          await db
            .select({
              workspaceId: schema.projectTable.workspaceId,
              projectId: schema.projectTable.id,
              organisationId: schema.workspaceTable.organisationId,
            })
            .from(schema.projectTable)
            .innerJoin(
              schema.workspaceTable,
              eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
            )
            .where(
              and(
                eq(schema.projectTable.id, id),
                reach(schema.projectTable.workspaceId),
                ...liveProject,
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "task":
      return (
        (
          await db
            .select({
              workspaceId: schema.projectTable.workspaceId,
              projectId: schema.taskTable.projectId,
              workItemId: schema.taskTable.id,
              organisationId: schema.workspaceTable.organisationId,
            })
            .from(schema.taskTable)
            .innerJoin(
              schema.projectTable,
              eq(schema.taskTable.projectId, schema.projectTable.id),
            )
            .innerJoin(
              schema.workspaceTable,
              eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
            )
            .where(
              and(
                eq(schema.taskTable.id, id),
                reach(schema.projectTable.workspaceId),
                ...liveProject,
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "label":
      return (
        (
          await db
            .select({ workspaceId: schema.labelTable.workspaceId })
            .from(schema.labelTable)
            .where(
              and(
                eq(schema.labelTable.id, id),
                reach(schema.labelTable.workspaceId),
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "timeEntry":
      return (
        (
          await db
            .select({
              workspaceId: schema.projectTable.workspaceId,
              projectId: schema.taskTable.projectId,
              workItemId: schema.taskTable.id,
              organisationId: schema.workspaceTable.organisationId,
            })
            .from(schema.timeEntryTable)
            .innerJoin(
              schema.taskTable,
              eq(schema.timeEntryTable.taskId, schema.taskTable.id),
            )
            .innerJoin(
              schema.projectTable,
              eq(schema.taskTable.projectId, schema.projectTable.id),
            )
            .innerJoin(
              schema.workspaceTable,
              eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
            )
            .where(
              and(
                eq(schema.timeEntryTable.id, id),
                reach(schema.projectTable.workspaceId),
                ...liveProject,
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "activity":
    case "comment":
      return (
        (
          await db
            .select({
              workspaceId: schema.projectTable.workspaceId,
              projectId: schema.taskTable.projectId,
              workItemId: schema.taskTable.id,
              organisationId: schema.workspaceTable.organisationId,
            })
            .from(schema.taskActivityTable)
            .innerJoin(
              schema.taskTable,
              eq(schema.taskActivityTable.taskId, schema.taskTable.id),
            )
            .innerJoin(
              schema.projectTable,
              eq(schema.taskTable.projectId, schema.projectTable.id),
            )
            .innerJoin(
              schema.workspaceTable,
              eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
            )
            .where(
              and(
                eq(schema.taskActivityTable.id, id),
                ...(resource === "comment"
                  ? [eq(schema.taskActivityTable.type, "comment")]
                  : []),
                reach(schema.projectTable.workspaceId),
                ...liveProject,
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "column":
      return (
        (
          await db
            .select({
              workspaceId: schema.projectTable.workspaceId,
              projectId: schema.columnTable.projectId,
              organisationId: schema.workspaceTable.organisationId,
            })
            .from(schema.columnTable)
            .innerJoin(
              schema.projectTable,
              eq(schema.columnTable.projectId, schema.projectTable.id),
            )
            .innerJoin(
              schema.workspaceTable,
              eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
            )
            .where(
              and(
                eq(schema.columnTable.id, id),
                reach(schema.projectTable.workspaceId),
                ...liveProject,
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "workflowRule":
      return (
        (
          await db
            .select({
              workspaceId: schema.projectTable.workspaceId,
              projectId: schema.workflowRuleTable.projectId,
              organisationId: schema.workspaceTable.organisationId,
            })
            .from(schema.workflowRuleTable)
            .innerJoin(
              schema.projectTable,
              eq(schema.workflowRuleTable.projectId, schema.projectTable.id),
            )
            .innerJoin(
              schema.workspaceTable,
              eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
            )
            .where(
              and(
                eq(schema.workflowRuleTable.id, id),
                reach(schema.projectTable.workspaceId),
                ...liveProject,
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "workflow":
      return (
        (
          await db
            .select({ workspaceId: schema.workflowTable.workspaceId })
            .from(schema.workflowTable)
            .where(
              and(
                eq(schema.workflowTable.id, id),
                reach(schema.workflowTable.workspaceId),
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "workflowVersion":
      return (
        (
          await db
            .select({ workspaceId: schema.workflowTable.workspaceId })
            .from(schema.workflowVersionTable)
            .innerJoin(
              schema.workflowTable,
              eq(
                schema.workflowVersionTable.workflowId,
                schema.workflowTable.id,
              ),
            )
            .where(
              and(
                eq(schema.workflowVersionTable.id, id),
                reach(schema.workflowTable.workspaceId),
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    case "savedView":
      return (
        (
          await db
            .select({ workspaceId: schema.savedViewTable.workspaceId })
            .from(schema.savedViewTable)
            .where(
              and(
                eq(schema.savedViewTable.id, id),
                reach(schema.savedViewTable.workspaceId),
              ),
            )
            .limit(1)
        )[0] ?? null
      );
  }
}

export function listTaskWorkspaceRows(taskIds: string[], reach: SQL) {
  return db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(and(inArray(schema.taskTable.id, taskIds), reach));
}

import { userTable } from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getUserRole(userId: string) {
  return db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
}

export function getUserAnonymousFlag(userId: string) {
  return db
    .select({ isAnonymous: schema.userTable.isAnonymous })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
}

export function getUserLocaleByEmail(email: string) {
  return db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
}

export function getEnabledApiKeyByHash(hashedKey: string, now: Date) {
  return db
    .select()
    .from(schema.apikeyTable)
    .where(
      and(
        eq(schema.apikeyTable.key, hashedKey),
        eq(schema.apikeyTable.enabled, true),
        or(
          isNull(schema.apikeyTable.expiresAt),
          gt(schema.apikeyTable.expiresAt, now),
        ),
      ),
    )
    .limit(1);
}

export function listWorkspaceMembershipUserIds(
  executor: Executor,
  userIds: string[],
  workspaceId: string,
) {
  return executor
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        inArray(schema.workspaceUserTable.userId, userIds),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    );
}

export function listAdminUserIds(executor: Executor, userIds: string[]) {
  return executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(
      and(
        inArray(schema.userTable.id, userIds),
        eq(schema.userTable.role, "admin"),
      ),
    );
}

export function lockWorkspaceMembership(
  executor: Executor,
  userId: string,
  workspaceId: string,
) {
  return executor
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .for("update");
}

export function getGlobalAdmin(executor: Executor, userId: string) {
  return executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .for("share");
}

export function getLiveProjectWorkspace(executor: Executor, projectId: string) {
  return executor
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
}

export function getReachableAsset(id: string, reachPredicate: SQL) {
  return db
    .select({
      id: schema.assetTable.id,
      objectKey: schema.assetTable.objectKey,
      mimeType: schema.assetTable.mimeType,
      filename: schema.assetTable.filename,
      workspaceId: schema.assetTable.workspaceId,
    })
    .from(schema.assetTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.assetTable.projectId, schema.projectTable.id),
    )
    .where(and(eq(schema.assetTable.id, id), reachPredicate))
    .limit(1);
}

export function getAssetDeniedByReach(id: string, reachPredicate: SQL) {
  return db
    .select({ workspaceId: schema.assetTable.workspaceId })
    .from(schema.assetTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.assetTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.assetTable.id, id),
        isNull(schema.projectTable.deletedAt),
        not(reachPredicate),
      ),
    )
    .limit(1);
}

export function getApiKeyForWorkspaceAccess(apiKeyId: string, userId: string) {
  return db
    .select()
    .from(schema.apikeyTable)
    .where(
      and(
        eq(schema.apikeyTable.id, apiKeyId),
        or(
          eq(schema.apikeyTable.referenceId, userId),
          eq(schema.apikeyTable.userId, userId),
        ),
        eq(schema.apikeyTable.enabled, true),
      ),
    )
    .limit(1);
}

export function getWorkspaceMembership(userId: string, workspaceId: string) {
  return db
    .select()
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export function getWorkspaceMembershipRole(
  userId: string,
  workspaceId: string,
) {
  return db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export function getInvitationWorkspaceId(invitationId: string) {
  return db
    .select({ workspaceId: schema.invitationTable.workspaceId })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
}

export function getExistingProjectStates(
  executor: Pick<typeof db, "select" | "insert">,
  projectId: string,
) {
  return executor
    .select({ id: schema.stateTable.id })
    .from(schema.stateTable)
    .where(eq(schema.stateTable.projectId, projectId))
    .limit(1);
}

export function listProjectStateTemplates(
  executor: Pick<typeof db, "select" | "insert">,
  workspaceId: string,
) {
  return executor
    .select()
    .from(schema.stateTemplateTable)
    .where(
      and(
        eq(schema.stateTemplateTable.workspaceId, workspaceId),
        isNull(schema.stateTemplateTable.archivedAt),
      ),
    );
}

export function listAllWorkspaceIds() {
  return db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable);
}

export function listWorkspaceRoleKeys(workspaceIds: string[], roles: string[]) {
  return db
    .select({
      workspaceId: schema.workspaceRoleTable.workspaceId,
      role: schema.workspaceRoleTable.role,
    })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        inArray(schema.workspaceRoleTable.workspaceId, workspaceIds),
        inArray(schema.workspaceRoleTable.role, roles),
      ),
    );
}

export async function listWorkspaceRolesForWorkspace(
  executor: Pick<typeof db, "select">,
  workspaceId: string,
) {
  return executor
    .select()
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, workspaceId));
}

export function getWorkspaceRoleSystemFlag(
  executor: Pick<typeof db, "select">,
  workspaceId: string,
  role: string,
) {
  return executor
    .select({ isSystem: schema.workspaceRoleTable.isSystem })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
}

export function listWorkspaceDefaultsNeedingBackfill() {
  const hasTypeSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.workItemTypeTable)
      .where(
        eq(schema.workItemTypeTable.workspaceId, schema.workspaceTable.id),
      );
  const hasTemplateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTemplateTable)
      .where(
        eq(schema.stateTemplateTable.workspaceId, schema.workspaceTable.id),
      );
  return db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(
      sql`${notExists(hasTypeSubquery())} or ${notExists(hasTemplateSubquery())}`,
    );
}

export function getExistingWorkspaceType(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({ id: schema.workItemTypeTable.id })
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
    .limit(1);
}

export function getExistingWorkspaceTemplate(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({ id: schema.stateTemplateTable.id })
    .from(schema.stateTemplateTable)
    .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
    .limit(1);
}

export function listLegacyProjectsNeedingStates() {
  const hasStateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, schema.projectTable.id));
  const hasActiveTemplateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTemplateTable)
      .where(
        and(
          eq(
            schema.stateTemplateTable.workspaceId,
            schema.projectTable.workspaceId,
          ),
          isNull(schema.stateTemplateTable.archivedAt),
        ),
      );
  return db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.projectTable)
    .where(
      sql`${isNull(schema.projectTable.deletedAt)} and ${notExists(
        hasStateSubquery(),
      )} and ${exists(hasActiveTemplateSubquery())}`,
    );
}

export function countProjectsWithoutActiveTemplates() {
  const hasStateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, schema.projectTable.id));
  const hasActiveTemplateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTemplateTable)
      .where(
        and(
          eq(
            schema.stateTemplateTable.workspaceId,
            schema.projectTable.workspaceId,
          ),
          isNull(schema.stateTemplateTable.archivedAt),
        ),
      );
  return db
    .select({ stuckCount: sql<string>`count(*)` })
    .from(schema.projectTable)
    .where(
      sql`${isNull(schema.projectTable.deletedAt)} and ${notExists(
        hasStateSubquery(),
      )} and ${notExists(hasActiveTemplateSubquery())}`,
    );
}

export function findInternalOrganisation(executor: Pick<typeof db, "select">) {
  return executor
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.isInternal, true))
    .limit(1);
}

export function listUsersForInternalPersonSeed() {
  return db.select({ id: schema.userTable.id }).from(schema.userTable);
}

export function listExistingPersonUserIds() {
  return db
    .select({ userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(isNotNull(schema.personTable.userId));
}
