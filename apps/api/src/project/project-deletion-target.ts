import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import {
  type RegisteredDeletionLoaded,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import type { PendingActionTransaction } from "../pending-action/service";
import { invalidateNativeAuthorization } from "../ws";
import { lockProjectHierarchy } from "./hierarchy.repository";
import { assertNoLiveChildProjects } from "./project-children";
import { revokeProjectCreatorGrantsForProject } from "./project-creator-grant";

// #187: 30 days, the same window `controllers/delete-project.ts` stamps.
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const PROJECT_DELETION_ROUTE = "DELETE /api/project/{id}" as const;
export const MILESTONE_DELETION_ROUTE =
  "DELETE /api/project/{id}/milestones/{milestoneId}" as const;
export const PREREQUISITE_DELETION_ROUTE =
  "DELETE /api/project/{id}/prerequisites/{prerequisiteId}" as const;
export const DOCUMENT_LINK_DELETION_ROUTE =
  "DELETE /api/project/{id}/document-links/{documentLinkId}" as const;

/** Live (not soft-deleted) project row, share-locked so it cannot be deleted under a child. */
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

/**
 * `DELETE /api/project/{id}`: typed exact project name + step-up, browser session only.
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
    const project = await lockLiveProject(tx, id, "update");
    if (!project) return undefined;
    // `last_task_number` moves on every work-item create and is not a property the approver
    // confirmed; everything else (name, slug, archive state, customer) is.
    const { lastTaskNumber: _counter, ...versioned } = project;
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      organisationId: project.organisationId,
      name: project.name,
      summary: {
        projectId: project.id,
        name: project.name,
        slug: project.slug,
        archived: project.archivedAt !== null,
      },
      version: registeredDeletionFingerprint(versioned),
    } satisfies RegisteredDeletionLoaded;
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
