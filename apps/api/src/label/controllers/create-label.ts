import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { labelTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { lockWorkspaceLabelNames } from "../label-name-lock";
import {
  getAssignedLabelQuery,
  getProjectWorkspaceQuery,
  getTaskProjectQuery,
  getWorkspaceBaseLabelQuery,
} from "../repository";

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
    const [task] = await getTaskProjectQuery(db, taskId);

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
      // A workspace-label cascade and every task-level create/edit/delete for
      // this name serialize before taking task/project locks. The cascade can
      // then re-read and lock every copy created before it acquired this key.
      await lockWorkspaceLabelNames(tx, workspaceId, [name]);
      const lockedTask = await lockTaskAndAssertProjectLive(tx, taskId);
      const [project] = await getProjectWorkspaceQuery(
        tx,
        lockedTask.projectId,
      );
      if (!project || project.workspaceId !== workspaceId) {
        throw new HTTPException(404, { message: "Task not found" });
      }
      const [inserted] = await tx
        .insert(labelTable)
        .values({ name, color, taskId, workspaceId: project.workspaceId })
        .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] })
        .returning();
      const label = inserted ?? (await getAssignedLabelQuery(tx, taskId, name));
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

  const label = await db.transaction(async (tx) => {
    await lockWorkspaceLabelNames(tx, workspaceId, [name]);
    const [inserted] = await tx
      .insert(labelTable)
      .values({ name, color, taskId: null, workspaceId })
      .onConflictDoNothing({
        target: [labelTable.workspaceId, labelTable.name],
        where: sql`${labelTable.taskId} is null`,
      })
      .returning();

    return (
      inserted ?? (await getWorkspaceBaseLabelQuery(tx, workspaceId, name))
    );
  });

  if (!label) {
    throw new Error("Failed to create or resolve label");
  }

  return label;
}

export default createLabel;
