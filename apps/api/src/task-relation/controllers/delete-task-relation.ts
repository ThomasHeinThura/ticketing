import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskRelationTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  lockLegacyTaskRow,
  lockProjectsAndAssertLive,
} from "../../task/assert-task-project-live";
import { findRelationEndpoints } from "../repository";

async function deleteTaskRelation(id: string, userId: string) {
  const [rel] = await findRelationEndpoints(db, id);

  if (!rel) {
    throw new HTTPException(404, {
      message: "Task relation not found",
    });
  }

  const { relation, projectId } = await db.transaction(async (tx) => {
    const taskIds = [rel.sourceTaskId, rel.targetTaskId].sort();
    const firstTask = await lockLegacyTaskRow(tx, taskIds[0] ?? "");
    const secondTask = await lockLegacyTaskRow(
      tx,
      taskIds[1] ?? taskIds[0] ?? "",
    );
    const sourceTask =
      firstTask.id === rel.sourceTaskId ? firstTask : secondTask;
    await lockProjectsAndAssertLive(tx, [
      firstTask.projectId,
      secondTask.projectId,
    ]);
    const [relation] = await tx
      .delete(taskRelationTable)
      .where(eq(taskRelationTable.id, id))
      .returning();
    return { relation, projectId: sourceTask.projectId };
  });

  if (!relation) {
    throw new HTTPException(404, {
      message: "Task relation not found",
    });
  }

  await publishEvent("task-relation.deleted", {
    ...relation,
    taskId: rel.sourceTaskId,
    sourceTaskId: rel.sourceTaskId,
    targetTaskId: rel.targetTaskId,
    projectId,
    userId,
  });

  return relation;
}

export default deleteTaskRelation;
