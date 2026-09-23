import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  labelTable,
  type labelTable as labelTableType,
  projectTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { rejectNulByte } from "../../utils/reject-nul-byte";

type LabelRow = typeof labelTableType.$inferSelect;

async function assignLabelToTask(id: string, taskId: string, userId: string) {
  // #290 S4 sweep: `taskId` is a body field on `attachLabelToTaskRoute`, not covered
  // by `workspaceAccess.fromLabel()` (which only guards `id`) -- a NUL byte here
  // reached `eq(taskTable.id, taskId)` unvalidated and 500'd.
  rejectNulByte(taskId, "Task id");

  const label = await db.query.labelTable.findFirst({
    where: (label, { eq }) => eq(label.id, id),
  });

  if (!label) {
    throw new HTTPException(404, {
      message: "Label not found",
    });
  }

  // `workspaceAccess.fromLabel()` (this route's own middleware) already resolved
  // and reach-checked this label's workspace before this controller ever ran --
  // `lookupWorkspaceId` treats a null `workspaceId` column the same as "row
  // doesn't exist" (`|| null`), so reaching here means it is a real string.
  if (!label.workspaceId) {
    throw new HTTPException(404, {
      message: "Label not found",
    });
  }

  // S2 (Opus review of PR #307, delta round): scoped to the label's own
  // (already reach-checked) workspace in the query itself, so a `taskId`
  // belonging to ANOTHER workspace is indistinguishable from a nonexistent one --
  // both now 404 `Task not found` here, instead of a nonexistent id 404ing while
  // a foreign id resolved and then 400'd "must belong to the same workspace",
  // which is the #290/#285 existence-oracle class applied to task ids.
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        eq(projectTable.workspaceId, label.workspaceId),
      ),
    )
    .limit(1);

  if (!task) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  if (label.taskId === taskId) {
    return label;
  }

  type InsertionResult = {
    taskLabel: LabelRow;
    inserted: boolean;
  };
  const { taskLabel, inserted } = await db.transaction<InsertionResult>(
    async (tx) => {
      const currentLabel = await tx.query.labelTable.findFirst({
        where: (label, { eq }) => eq(label.id, id),
      });

      if (!currentLabel) {
        throw new HTTPException(404, {
          message: "Label not found",
        });
      }

      if (
        currentLabel.workspaceId &&
        currentLabel.workspaceId !== task.workspaceId
      ) {
        throw new HTTPException(400, {
          message: "Label and task must belong to the same workspace",
        });
      }

      if (currentLabel.taskId === taskId) {
        return {
          taskLabel: currentLabel,
          inserted: false,
        };
      }

      const previousTaskId = currentLabel.taskId;
      if (previousTaskId) {
        await tx.delete(labelTable).where(eq(labelTable.id, id));
      }

      const [insertedRow] = await tx
        .insert(labelTable)
        .values({
          name: currentLabel.name,
          color: currentLabel.color,
          taskId,
          workspaceId: task.workspaceId,
        })
        .onConflictDoNothing({
          target: [labelTable.taskId, labelTable.name],
        })
        .returning();

      if (insertedRow) {
        return {
          taskLabel: insertedRow,
          inserted: true,
        };
      }

      const existing = await tx.query.labelTable.findFirst({
        where: and(
          eq(labelTable.taskId, taskId),
          eq(labelTable.name, currentLabel.name),
        ),
      });

      if (!existing) {
        throw new HTTPException(500, {
          message: "Failed to attach label to task",
        });
      }

      return {
        taskLabel: existing,
        inserted: false,
      };
    },
  );

  if (!inserted) {
    return taskLabel;
  }

  await publishEvent("task.label_assigned", {
    label: taskLabel,
    task,
    projectId: task.projectId,
    taskId: task.id,
    userId,
    type: "label_assigned",
  });

  return taskLabel;
}

export default assignLabelToTask;
