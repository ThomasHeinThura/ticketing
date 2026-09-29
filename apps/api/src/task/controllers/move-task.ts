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
import {
  lockLegacyTaskRow,
  lockProjectsAndAssertLive,
} from "../assert-task-project-live";
import { claimTaskNumber } from "./claim-task-numbers";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function isSameProjectMove(
  sourceProjectId: string,
  destinationProjectId: string,
) {
  return sourceProjectId === destinationProjectId;
}

async function resolveDestinationStatus(
  dbOrTx: DbOrTx,
  destinationProjectId: string,
  currentStatus: string,
  requestedStatus?: string,
) {
  const destinationColumns = await dbOrTx
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
  // #290 S4 sweep: `destinationProjectId` is a body field, not covered by
  // `workspaceAccess.fromTask()` (which only guards `taskId`) -- a NUL byte here
  // reached a raw `eq(projectTable.id, destinationProjectId)`-shaped query below
  // unvalidated and 500'd, the same class #281 fixed for path/query ids.
  rejectNulByte(destinationProjectId, "Destination project id");

  const moveResult = await db.transaction(async (tx) => {
    const lockedTask = await lockLegacyTaskRow(tx, taskId);
    if (isSameProjectMove(lockedTask.projectId, destinationProjectId)) {
      throw new HTTPException(400, {
        message: "Task is already in that project",
      });
    }

    // Reject frozen sources before touching a request-selected destination id.
    // These reads only establish reach; sorted row locks below recheck both rows.
    const [sourcePreflight] = await tx
      .select({
        id: projectTable.id,
        workspaceId: projectTable.workspaceId,
        archivedAt: projectTable.archivedAt,
        deletedAt: projectTable.deletedAt,
      })
      .from(projectTable)
      .where(eq(projectTable.id, lockedTask.projectId))
      .limit(1);
    if (
      !sourcePreflight ||
      sourcePreflight.archivedAt !== null ||
      sourcePreflight.deletedAt !== null
    ) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    const [destinationPreflight] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, destinationProjectId),
          eq(projectTable.workspaceId, sourcePreflight.workspaceId),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
        ),
      )
      .limit(1);
    if (!destinationPreflight) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    // Lock the source and destination before reading their current workspace
    // and names. The task row above is authoritative if another move completed
    // after the route's reach middleware ran.
    await lockProjectsAndAssertLive(
      tx,
      [lockedTask.projectId, destinationProjectId],
      [destinationProjectId],
      new Map([[destinationProjectId, "Project not found"]]),
    );

    const [sourceProject] = await tx
      .select({
        id: projectTable.id,
        name: projectTable.name,
        workspaceId: projectTable.workspaceId,
      })
      .from(projectTable)
      .where(eq(projectTable.id, lockedTask.projectId))
      .limit(1);
    if (!sourceProject) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    // S2 (review of PR #307): scope the destination lookup to the source's
    // current workspace so foreign and missing project ids remain indistinct.
    const [destinationProject] = await tx
      .select({
        id: projectTable.id,
        name: projectTable.name,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, destinationProjectId),
          eq(projectTable.workspaceId, sourceProject.workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (!destinationProject) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const resolvedColumn = await resolveDestinationStatus(
      tx,
      destinationProjectId,
      lockedTask.status,
      destinationStatus,
    );
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

    return {
      movedTask: updatedTask,
      sourceProject,
      destinationProject,
      oldStatus: lockedTask.status,
      newStatus: resolvedColumn.slug,
    };
  });

  await publishEvent("task.moved", {
    taskId,
    type: "moved",
    userId: currentUserId,
    fromProjectId: moveResult.sourceProject.id,
    fromProjectName: moveResult.sourceProject.name,
    toProjectId: moveResult.destinationProject.id,
    toProjectName: moveResult.destinationProject.name,
    oldStatus: moveResult.oldStatus,
    newStatus: moveResult.newStatus,
  });

  return {
    task: moveResult.movedTask,
    sourceProjectId: moveResult.sourceProject.id,
    destinationProjectId: moveResult.destinationProject.id,
  };
}

export default moveTask;
