import { and, eq, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { rejectNulByte } from "../../utils/reject-nul-byte";

async function createTaskRelation({
  sourceTaskId,
  targetTaskId,
  relationType,
  userId,
  workspaceId,
}: {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  userId: string;
  workspaceId: string;
}) {
  // #285's S4 finding: `targetTaskId` reaches the `eq(taskTable.id, targetTaskId)`
  // query below unvalidated -- `sourceTaskId` is already checked by
  // `scopeToSourceTask` (task-relation/index.ts) before this controller runs, but
  // this is the one field that middleware never sees.
  rejectNulByte(targetTaskId, "Task id");

  if (sourceTaskId === targetTaskId) {
    throw new HTTPException(400, {
      message: "Cannot create a relation between a task and itself",
    });
  }

  const [sourceTask] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, sourceTaskId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!sourceTask) {
    throw new HTTPException(404, { message: "Source task not found" });
  }

  const [targetTask] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, targetTaskId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!targetTask) {
    throw new HTTPException(404, { message: "Target task not found" });
  }

  const existing = await db
    .select({ id: taskRelationTable.id })
    .from(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.relationType, relationType),
        or(
          and(
            eq(taskRelationTable.sourceTaskId, sourceTaskId),
            eq(taskRelationTable.targetTaskId, targetTaskId),
          ),
          and(
            eq(taskRelationTable.sourceTaskId, targetTaskId),
            eq(taskRelationTable.targetTaskId, sourceTaskId),
          ),
        ),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new HTTPException(409, {
      message: "This relation already exists",
    });
  }

  const [relation] = await db
    .insert(taskRelationTable)
    .values({
      sourceTaskId,
      targetTaskId,
      relationType,
    })
    .returning();

  if (!relation) {
    throw new HTTPException(500, {
      message: "Failed to create task relation",
    });
  }

  await publishEvent("task-relation.created", {
    ...relation,
    taskId: sourceTaskId,
    projectId: sourceTask.projectId,
    userId,
  });

  return relation;
}

export default createTaskRelation;
