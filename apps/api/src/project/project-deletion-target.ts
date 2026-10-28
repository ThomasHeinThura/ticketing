import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import {
  type RegisteredDeletionLoaded,
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import type { PendingActionTransaction } from "../pending-action/service";
import { invalidateNativeAuthorization } from "../ws";
import {
  loadProjectAncestorIds,
  lockProjectHierarchy,
} from "./hierarchy.repository";
import { assertNoLiveChildProjects } from "./project-children";
import { revokeProjectCreatorGrantsForProject } from "./project-creator-grant";

// #187: 30 days, the same window `controllers/delete-project.ts` stamps.
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Live project row lock for project sub-resource deletion. */
async function lockLiveProject(
  tx: PendingActionTransaction,
  projectId: string,
  mode: "share" | "update",
) {
  const [project] = await tx
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .for(mode)
    .limit(1);
  return project;
}

export const PROJECT_DELETION_ROUTE = "DELETE /api/project/{id}" as const;
export const MILESTONE_DELETION_ROUTE =
  "DELETE /api/project/{id}/milestones/{milestoneId}" as const;
export const PREREQUISITE_DELETION_ROUTE =
  "DELETE /api/project/{id}/prerequisites/{prerequisiteId}" as const;
export const DOCUMENT_LINK_DELETION_ROUTE =
  "DELETE /api/project/{id}/document-links/{documentLinkId}" as const;

/**
 * Freeze the project and its inherited-roster parents for a deletion summary. Membership
 * writers lock the affected person first and then the project row `FOR SHARE`; this routine
 * follows that same order before taking the project rows `FOR UPDATE`.
 */
async function lockProjectDeletionScope(
  tx: PendingActionTransaction,
  project: typeof schema.projectTable.$inferSelect,
) {
  await lockProjectHierarchy(tx, project.workspaceId);
  const ancestorIds = await loadProjectAncestorIds(
    tx,
    project.workspaceId,
    project.id,
  );
  const scopeIds = [...new Set([project.id, ...ancestorIds])];
  const rosterPeople = await tx
    .select({ personId: schema.membershipTable.personId })
    .from(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.scope, "project"),
        inArray(schema.membershipTable.scopeId, scopeIds),
      ),
    );
  const activeGrantPeople = await tx
    .select({ personId: schema.membershipGrantTable.personId })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.scope, "project"),
        inArray(schema.membershipGrantTable.scopeId, scopeIds),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  const peopleIds = [
    ...new Set([
      ...rosterPeople.map(({ personId }) => personId),
      ...activeGrantPeople.map(({ personId }) => personId),
    ]),
  ].sort();
  if (peopleIds.length) {
    await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(inArray(schema.personTable.id, peopleIds))
      .orderBy(asc(schema.personTable.id))
      .for("update");
  }
  const lockedProjects = await tx
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.workspaceId, project.workspaceId),
        inArray(schema.projectTable.id, scopeIds),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .orderBy(asc(schema.projectTable.id))
    .for("update");
  if (lockedProjects.length !== scopeIds.length) return undefined;
  const lockedTarget = lockedProjects.find((row) => row.id === project.id);
  if (!lockedTarget) return undefined;
  return { project: lockedTarget, scopeIds };
}

async function projectDeletionImpact(
  tx: PendingActionTransaction,
  projectId: string,
  rosterScopeIds: readonly string[],
) {
  const memberRows = await tx
    .selectDistinct({ personId: schema.membershipTable.personId })
    .from(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.scope, "project"),
        inArray(schema.membershipTable.scopeId, [...rosterScopeIds]),
      ),
    );
  const workItemRows = await tx
    .select({ id: schema.workItemTable.id })
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.projectId, projectId),
        isNull(schema.workItemTable.deletedAt),
      ),
    );
  const [legacyTaskCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.taskTable)
    .where(eq(schema.taskTable.projectId, projectId));
  const [workflowRuleCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.workflowRuleTable)
    .where(eq(schema.workflowRuleTable.projectId, projectId));
  const [sourceLinkCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.externalLinkTable)
    .innerJoin(
      schema.taskTable,
      eq(schema.taskTable.id, schema.externalLinkTable.taskId),
    )
    .where(eq(schema.taskTable.projectId, projectId));
  const workItemIds = workItemRows.map(({ id }) => id);
  const comments = workItemIds.length
    ? await tx
        .select({ id: schema.commentTable.id })
        .from(schema.commentTable)
        .where(
          and(
            inArray(schema.commentTable.workItemId, workItemIds),
            isNull(schema.commentTable.deletedAt),
          ),
        )
    : [];
  const attachments =
    workItemIds.length || comments.length
      ? await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.attachmentTable)
          .where(
            and(
              isNull(schema.attachmentTable.deletedAt),
              sql`(${workItemIds.length ? sql`${inArray(schema.attachmentTable.workItemId, workItemIds)}` : sql`false`}
                OR ${
                  comments.length
                    ? sql`${inArray(
                        schema.attachmentTable.commentId,
                        comments.map(({ id }) => id),
                      )}`
                    : sql`false`
                })`,
            ),
          )
      : [{ count: 0 }];
  return {
    workItems: workItemRows.length,
    legacyTasks: legacyTaskCount?.count ?? 0,
    members: memberRows.length,
    attachments: attachments[0]?.count ?? 0,
    workflowRules: workflowRuleCount?.count ?? 0,
    sourceLinks: sourceLinkCount?.count ?? 0,
  };
}

/**
 * `DELETE /api/project/{id}`: typed project key + step-up, browser session only.
 * Execution is the same soft delete `controllers/delete-project.ts` performs, plus the
 * creator-grant revocation, inside the approval transaction.
 */
export const projectDeletionTarget: RegisteredDeletionTarget = {
  targetType: "project",
  routeKey: PROJECT_DELETION_ROUTE,
  confirmation: "typed_name_step_up",
  sessionOnly: true,
  notFound: "Project not found",
  // P1-5: refused (409) at the delete request and again at approval while live child projects
  // exist; `execute` re-checks under the hierarchy lock.
  assertDeletable: async (tx, loaded) => {
    await assertNoLiveChildProjects(tx, loaded.workspaceId, loaded.id);
  },
  load: async (tx, id) => {
    const [anchor] = await tx
      .select()
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.id, id),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (!anchor) return undefined;
    const lockedScope = await lockProjectDeletionScope(tx, anchor);
    if (!lockedScope) return undefined;
    const { project, scopeIds: rosterScopeIds } = lockedScope;
    const impact = await projectDeletionImpact(tx, project.id, rosterScopeIds);
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      organisationId: project.organisationId,
      // `deletion-targets.ts` uses loaded.name as the typed confirmation value.
      name: project.slug,
      summary: {
        projectId: project.id,
        name: project.slug,
        projectName: project.name,
        slug: project.slug,
        archived: project.archivedAt !== null,
        impact,
        recoveryDays: 30,
      },
      version: registeredDeletionFingerprint({
        ...project,
        impact,
        rosterScopeIds: [...rosterScopeIds].sort(),
      }),
    } satisfies RegisteredDeletionLoaded;
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [project] = await tx
      .select({
        id: schema.projectTable.id,
        workspaceId: schema.projectTable.workspaceId,
        organisationId: schema.projectTable.organisationId,
      })
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.id, id),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .limit(1);
    return project
      ? {
          id: project.id,
          workspaceId: project.workspaceId,
          projectId: project.id,
          organisationId: project.organisationId,
        }
      : undefined;
  },
  execute: async (tx, { loaded }) => {
    // Serialises with re-parenting, so a child cannot be attached between this check and the
    // soft delete.
    await lockProjectHierarchy(tx, loaded.workspaceId);
    await assertNoLiveChildProjects(tx, loaded.workspaceId, loaded.id);
    const [row] = await tx
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(),
        purgeAfter: new Date(Date.now() + PURGE_AFTER_MS),
      })
      .where(
        and(
          eq(schema.projectTable.id, loaded.id),
          eq(schema.projectTable.workspaceId, loaded.workspaceId),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .returning({ id: schema.projectTable.id });
    if (!row)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    await revokeProjectCreatorGrantsForProject(
      tx,
      loaded.workspaceId,
      loaded.id,
    );
    return {
      afterCommit: () =>
        invalidateNativeAuthorization({ projectId: loaded.id }),
    };
  },
};

function projectChildTarget<
  Table extends
    | typeof schema.milestoneTable
    | typeof schema.prerequisiteTable
    | typeof schema.documentLinkTable,
>(definition: {
  targetType: string;
  idKey: string;
  routeKey: string;
  notFound: string;
  table: Table;
  name: (row: Table["$inferSelect"]) => string;
}): RegisteredDeletionTarget {
  const table = definition.table as typeof schema.milestoneTable;
  return {
    targetType: definition.targetType,
    routeKey: definition.routeKey,
    confirmation: "click",
    sessionOnly: false,
    notFound: definition.notFound,
    load: async (tx, id) => {
      const [anchor] = await tx
        .select({ projectId: table.projectId })
        .from(table)
        .where(eq(table.id, id))
        .limit(1);
      if (!anchor) return undefined;
      // Parent before child, matching every other project sub-resource writer.
      const project = await lockLiveProject(tx, anchor.projectId, "share");
      if (!project) return undefined;
      const [row] = await tx
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.projectId, project.id)))
        .for("update")
        .limit(1);
      if (!row) return undefined;
      const name = definition.name(row as Table["$inferSelect"]);
      return {
        id: row.id,
        workspaceId: project.workspaceId,
        projectId: project.id,
        organisationId: project.organisationId,
        name,
        summary: {
          [definition.idKey]: row.id,
          name,
          projectId: project.id,
          projectName: project.name,
        },
        version: registeredDeletionFingerprint(row),
      };
    },
    readScope: async (
      tx,
      id,
    ): Promise<RegisteredDeletionReadScope | undefined> => {
      const [row] = await tx
        .select({ id: table.id, projectId: table.projectId })
        .from(table)
        .where(eq(table.id, id))
        .limit(1);
      if (!row) return undefined;
      const [project] = await tx
        .select({
          id: schema.projectTable.id,
          workspaceId: schema.projectTable.workspaceId,
          organisationId: schema.projectTable.organisationId,
        })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, row.projectId),
            isNull(schema.projectTable.deletedAt),
          ),
        )
        .limit(1);
      return project
        ? {
            id: row.id,
            workspaceId: project.workspaceId,
            projectId: project.id,
            organisationId: project.organisationId,
          }
        : undefined;
    },
    execute: async (tx, { loaded }) => {
      const [deleted] = await tx
        .delete(table)
        .where(
          and(
            eq(table.id, loaded.id),
            eq(table.projectId, loaded.projectId ?? ""),
          ),
        )
        .returning({ id: table.id });
      if (!deleted)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      return {};
    },
  };
}

export const milestoneDeletionTarget = projectChildTarget({
  targetType: "milestone",
  idKey: "milestoneId",
  routeKey: MILESTONE_DELETION_ROUTE,
  notFound: "Milestone not found",
  table: schema.milestoneTable,
  name: (row) => row.name,
});

export const prerequisiteDeletionTarget = projectChildTarget({
  targetType: "prerequisite",
  idKey: "prerequisiteId",
  routeKey: PREREQUISITE_DELETION_ROUTE,
  notFound: "Prerequisite not found",
  table: schema.prerequisiteTable,
  name: (row) => row.title,
});

export const documentLinkDeletionTarget = projectChildTarget({
  targetType: "document_link",
  idKey: "documentLinkId",
  routeKey: DOCUMENT_LINK_DELETION_ROUTE,
  notFound: "Document link not found",
  table: schema.documentLinkTable,
  name: (row) => row.title,
});
