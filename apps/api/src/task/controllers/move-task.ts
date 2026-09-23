import { and, asc, eq, isNull, max } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  assetTable,
  columnTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { claimTaskNumber } from "./claim-task-numbers";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function isSameProjectMove(
  sourceProjectId: string,
  destinationProjectId: string,
) {
  return sourceProjectId === destinationProjectId;
}

async function resolveDestinationStatus(
  destinationProjectId: string,
  currentStatus: string,
  requestedStatus?: string,
) {
  const destinationColumns = await db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, destinationProjectId))
    .orderBy(asc(columnTable.position));

  const [firstColumn] = destinationColumns;

  if (!firstColumn) {
    throw new HTTPException(400, {
      message: "Destination project does not have a workflow",
    });
  }

  const requestedColumn = requestedStatus
    ? destinationColumns.find((column) => column.slug === requestedStatus)
    : null;

  if (requestedStatus && !requestedColumn) {
    throw new HTTPException(400, {
      message: "Selected status is not valid for the destination project",
    });
  }

  const matchingCurrentColumn = destinationColumns.find(
    (column) => column.slug === currentStatus,
  );

  return requestedColumn ?? matchingCurrentColumn ?? firstColumn;
}

async function getNextTaskPosition(
  dbOrTx: DbOrTx,
  projectId: string,
  status: string,
  columnId: string,
) {
  const [maxPositionResult] = await dbOrTx
    .select({ maxPosition: max(taskTable.position) })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(taskTable.status, status),
        eq(taskTable.columnId, columnId),
      ),
    );

  return (maxPositionResult?.maxPosition ?? 0) + 1;
}

async function moveTask({
  taskId,
  destinationProjectId,
  destinationStatus,
  currentUserId,
}: {
  taskId: string;
  destinationProjectId: string;
  destinationStatus?: string;
  currentUserId: string;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  // #290 S4 sweep: `destinationProjectId` is a body field, not covered by
  // `workspaceAccess.fromTask()` (which only guards `taskId`) -- a NUL byte here
  // reached a raw `eq(projectTable.id, destinationProjectId)`-shaped query below
  // unvalidated and 500'd, the same class #281 fixed for path/query ids.
  rejectNulByte(destinationProjectId, "Destination project id");

  if (isSameProjectMove(existingTask.projectId, destinationProjectId)) {
    throw new HTTPException(400, {
      message: "Task is already in that project",
    });
  }

  // #202: the source is checked. #187's `deleted_at` window (PR-16) means a
  // soft-deleted project is gone for ordinary use, so it can neither be a move's
  // source nor its destination -- otherwise this route would be a way to pull a
  // task *out* of a deleted project (and back in) during the recovery window.
  const sourceProject = await db.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, existingTask.projectId),
      isNull(projectTable.deletedAt),
    ),
  });

  if (!sourceProject) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  // S2 (Opus review of PR #307, delta round): scoped to the source project's own
  // (already reach-checked, via `workspaceAccess.fromTask()` on `taskId`)
  // workspace in the query itself, so a `destinationProjectId` belonging to
  // ANOTHER workspace is indistinguishable from a nonexistent one -- both now 404
  // `Project not found` here, instead of a nonexistent id 404ing while a foreign
  // id resolved and then 400'd "can only be moved within the same workspace",
  // which is the #290/#285 existence-oracle class applied to project ids. The
  // soft-delete freeze applies to the destination too, same as before.
  const destinationProject = await db.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, destinationProjectId),
      eq(projectTable.workspaceId, sourceProject.workspaceId),
      isNull(projectTable.deletedAt),
    ),
  });

  if (!destinationProject) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const resolvedColumn = await resolveDestinationStatus(
    destinationProjectId,
    existingTask.status,
    destinationStatus,
  );

  const movedTask = await db.transaction(async (tx) => {
    const [nextTaskNumber, nextPosition] = await Promise.all([
      claimTaskNumber(destinationProjectId, tx),
      getNextTaskPosition(
        tx,
        destinationProjectId,
        resolvedColumn.slug,
        resolvedColumn.id,
      ),
    ]);

    const [updatedTask] = await tx
      .update(taskTable)
      .set({
        projectId: destinationProjectId,
        status: resolvedColumn.slug,
        columnId: resolvedColumn.id,
        number: nextTaskNumber,
        position: nextPosition,
      })
      .where(eq(taskTable.id, taskId))
      .returning();

    if (!updatedTask) {
      throw new HTTPException(500, {
        message: "Failed to move task",
      });
    }

    await tx
      .update(assetTable)
      .set({ projectId: destinationProjectId })
      .where(eq(assetTable.taskId, taskId));

    return updatedTask;
  });

  await publishEvent("task.moved", {
    taskId,
    type: "moved",
    userId: currentUserId,
    fromProjectId: sourceProject.id,
    fromProjectName: sourceProject.name,
    toProjectId: destinationProject.id,
    toProjectName: destinationProject.name,
    oldStatus: existingTask.status,
    newStatus: resolvedColumn.slug,
  });

  return {
    task: movedTask,
    sourceProjectId: sourceProject.id,
    destinationProjectId: destinationProject.id,
  };
}

export default moveTask;
