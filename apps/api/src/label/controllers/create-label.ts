import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { labelTable, projectTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { rejectNulByte } from "../../utils/reject-nul-byte";

async function createLabel(
  name: string,
  color: string,
  taskId: string | undefined,
  workspaceId: string,
  userId: string,
) {
  if (taskId) {
    // #290 S4 sweep: `taskId` is a body field, not covered by any
    // `workspaceAccess.*` lookup (`createLabelRoute` scopes from `workspaceId`, not
    // `taskId`) -- a NUL byte here reached `eq(taskTable.id, taskId)` unvalidated and
    // 500'd, the same class #281 fixed for path/query ids.
    rejectNulByte(taskId, "Task id");
    const [task] = await db
      .select({
        id: taskTable.id,
        projectId: taskTable.projectId,
        workspaceId: projectTable.workspaceId,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(eq(taskTable.id, taskId))
      .limit(1);

    if (!task) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    if (task.workspaceId !== workspaceId) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    const { label, inserted, projectId } = await db.transaction(async (tx) => {
      const lockedTask = await lockTaskAndAssertProjectLive(tx, taskId);
      const [project] = await tx
        .select({ workspaceId: projectTable.workspaceId })
        .from(projectTable)
        .where(eq(projectTable.id, lockedTask.projectId));
      if (!project || project.workspaceId !== workspaceId) {
        throw new HTTPException(404, { message: "Task not found" });
      }
      const [inserted] = await tx
        .insert(labelTable)
        .values({ name, color, taskId, workspaceId: project.workspaceId })
        .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] })
        .returning();
      const label =
        inserted ??
        (await tx.query.labelTable.findFirst({
          where: and(eq(labelTable.taskId, taskId), eq(labelTable.name, name)),
        }));
      return { label, inserted, projectId: lockedTask.projectId };
    });

    if (!label) {
      throw new Error("Failed to create or resolve label");
    }

    if (inserted) {
      await publishEvent("task.label_created", {
        projectId,
        taskId: task.id,
        userId: userId,
        type: "label_created",
      });
    }
    return label;
  }

  const [inserted] = await db
    .insert(labelTable)
    .values({ name, color, taskId: null, workspaceId })
    .onConflictDoNothing({
      target: [labelTable.workspaceId, labelTable.name],
      where: sql`${labelTable.taskId} is null`,
    })
    .returning();

  const label =
    inserted ??
    (await db.query.labelTable.findFirst({
      where: and(
        eq(labelTable.workspaceId, workspaceId),
        eq(labelTable.name, name),
        isNull(labelTable.taskId),
      ),
    }));

  if (!label) {
    throw new Error("Failed to create or resolve label");
  }

  return label;
}

export default createLabel;
