import { and, count, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";

export const COLUMN_DELETION_ROUTE = "DELETE /api/column/{id}" as const;

/**
 * `DELETE /api/column/{id}`: click-confirmed. Same refusals as `controllers/delete-column.ts`:
 * the project must not be soft-deleted (#202) and the column must hold no tasks, checked at
 * request time and again at execution under the column row lock.
 */
export const columnDeletionTarget: RegisteredDeletionTarget = {
  targetType: "column",
  routeKey: COLUMN_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Column not found",
  load: async (tx, id) => {
    const [anchor] = await tx
      .select({ projectId: schema.columnTable.projectId })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.id, id))
      .limit(1);
    if (!anchor) return undefined;
    const [project] = await tx
      .select()
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.id, anchor.projectId),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .for("share")
      .limit(1);
    if (!project) return undefined;
    const [column] = await tx
      .select()
      .from(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.id, id),
          eq(schema.columnTable.projectId, project.id),
        ),
      )
      .for("update")
      .limit(1);
    if (!column) return undefined;
    return {
      id: column.id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      organisationId: project.organisationId,
      name: column.name,
      summary: {
        columnId: column.id,
        name: column.name,
        projectId: project.id,
        projectName: project.name,
      },
      version: registeredDeletionFingerprint(column),
    };
  },
  assertDeletable: async (tx, loaded) => {
    const [tasks] = await tx
      .select({ value: count() })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.columnId, loaded.id));
    if ((tasks?.value ?? 0) > 0)
      throw new HTTPException(409, {
        message:
          "Cannot delete column that contains tasks. Move or delete tasks first.",
      });
  },
  execute: async (tx, { loaded }) => {
    const [deleted] = await tx
      .delete(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.id, loaded.id),
          eq(schema.columnTable.projectId, loaded.projectId ?? ""),
        ),
      )
      .returning({ id: schema.columnTable.id });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
