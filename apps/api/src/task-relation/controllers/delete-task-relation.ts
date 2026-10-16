import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import {
  deleteTaskRelationById,
  findRelationEndpoints,
  lockProjectsAndAssertLive,
  lockTasksInStableOrder,
} from "../repository";

async function deleteTaskRelation(
  identity: ResolvedIdentity,
  id: string,
  userId: string,
) {
  const rel = await findRelationEndpoints(identity, id);
  if (!rel)
    throw new HTTPException(404, { message: "Task relation not found" });
  const { relation, projectId } = await db.transaction(async (tx) => {
    const tasks = await lockTasksInStableOrder(tx, identity, [
      rel.sourceTaskId,
      rel.targetTaskId,
    ]);
    const sourceTask = tasks.find((task) => task.id === rel.sourceTaskId);
    if (
      !sourceTask ||
      tasks.length !== new Set([rel.sourceTaskId, rel.targetTaskId]).size
    ) {
      throw new HTTPException(404, { message: "Task relation not found" });
    }
    await lockProjectsAndAssertLive(
      tx,
      identity,
      tasks.map((task) => task.projectId),
    );
    const relation = await deleteTaskRelationById(tx, identity, id);
    if (!relation)
      throw new HTTPException(404, { message: "Task relation not found" });
    return { relation, projectId: sourceTask.projectId };
  });
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
