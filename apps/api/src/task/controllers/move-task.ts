import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { insertRequiredTaskActivity } from "../../activity/repository";
import db from "../../database";
import type { Executor } from "../../database/executor";
import { publishEvent } from "../../events";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { assertProjectStillLive } from "../../work-item/assert-work-item-live";
import {
  findLiveUnarchivedProjectInWorkspace,
  findMaxTaskPositionInStatusAndColumn,
  findNotDeletedProjectInWorkspace,
  findProjectFreezeState,
  findProjectIdentity,
  listColumnsForMove,
  lockLiveProjectForMove,
  lockTaskRowForIdentity,
  moveTaskAndAssetsForIdentity,
} from "../repository";
import { claimTaskNumberForIdentity } from "./claim-task-numbers";

type DbOrTx = Executor;

function isSameProjectMove(
  sourceProjectId: string,
  destinationProjectId: string,
) {
  return sourceProjectId === destinationProjectId;
}

async function resolveDestinationStatus(
  identity: ResolvedIdentity,
  dbOrTx: DbOrTx,
  destinationProjectId: string,
  currentStatus: string,
  requestedStatus?: string,
) {
  const destinationColumns = await listColumnsForMove(
    dbOrTx,
    identity,
    destinationProjectId,
  );

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
  identity: ResolvedIdentity,
  dbOrTx: DbOrTx,
  projectId: string,
  status: string,
  columnId: string,
) {
  const maxPositionResult = await findMaxTaskPositionInStatusAndColumn(
    dbOrTx,
    identity,
    projectId,
    status,
    columnId,
  );

  return (maxPositionResult?.maxPosition ?? 0) + 1;
}

async function moveTask({
  identity,
  taskId,
  destinationProjectId,
  destinationStatus,
  currentUserId,
}: {
  identity: ResolvedIdentity;
  taskId: string;
  destinationProjectId: string;
  destinationStatus?: string;
  currentUserId: string;
}) {
  // #290 S4 sweep: `destinationProjectId` is a body field, not covered by
  // `workspaceAccess.fromTask()` (which only guards `taskId`) -- a NUL byte here
  // reached a raw `eq(projectTable.id, destinationProjectId)`-shaped query below
  // unvalidated and 500'd, the same class #281 fixed for path/query ids.
  const moveResult = await db.transaction(async (tx) => {
    const lockedTask = await lockTaskRowForIdentity(tx, identity, taskId);
    if (!lockedTask) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    // Malformed destinations cannot be queried safely, but their validation still
    // follows an authoritative source liveness lock. Valid destinations retain the
    // existing source preflight and sorted-lock sequence below.
    if (destinationProjectId.includes("\u0000")) {
      await assertProjectStillLive(tx, lockedTask.projectId, "Task not found");
      rejectNulByte(destinationProjectId, "Destination project id");
    }

    // Reject frozen sources before touching a request-selected destination id.
    // These reads only establish reach; sorted row locks below recheck both rows.
    const sourcePreflight = await findProjectFreezeState(
      tx,
      identity,
      lockedTask.projectId,
    );
    if (
      !sourcePreflight ||
      sourcePreflight.archivedAt !== null ||
      sourcePreflight.deletedAt !== null
    ) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    if (isSameProjectMove(lockedTask.projectId, destinationProjectId)) {
      await assertProjectStillLive(tx, lockedTask.projectId, "Task not found");
      throw new HTTPException(400, {
        message: "Task is already in that project",
      });
    }

    const destinationPreflight = await findLiveUnarchivedProjectInWorkspace(
      tx,
      identity,
      destinationProjectId,
      sourcePreflight.workspaceId,
    );
    if (!destinationPreflight) {
      // A plain source preflight may have gone stale while checking destination reach.
      await assertProjectStillLive(tx, lockedTask.projectId, "Task not found");
      throw new HTTPException(404, { message: "Project not found" });
    }

    // Keep the shared project lock order, but select the source error only after
    // both rows have been checked under locks.
    const lockedProjectLiveness = new Map<string, boolean>();
    for (const projectId of [
      ...new Set([lockedTask.projectId, destinationProjectId]),
    ].sort()) {
      const isDestination = projectId === destinationProjectId;
      const liveProject = await lockLiveProjectForMove(
        tx,
        identity,
        projectId,
        {
          mode: isDestination ? "update" : "share",
          ...(isDestination
            ? { workspaceId: sourcePreflight.workspaceId }
            : {}),
        },
      );
      lockedProjectLiveness.set(projectId, liveProject !== undefined);
    }
    if (!lockedProjectLiveness.get(lockedTask.projectId)) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    if (!lockedProjectLiveness.get(destinationProjectId)) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const sourceProject = await findProjectIdentity(
      tx,
      identity,
      lockedTask.projectId,
    );
    if (!sourceProject) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    // S2 (review of PR #307): scope the destination lookup to the source's
    // current workspace so foreign and missing project ids remain indistinct.
    const destinationProject = await findNotDeletedProjectInWorkspace(
      tx,
      identity,
      destinationProjectId,
      sourceProject.workspaceId,
    );
    if (!destinationProject) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const resolvedColumn = await resolveDestinationStatus(
      identity,
      tx,
      destinationProjectId,
      lockedTask.status,
      destinationStatus,
    );
    const [nextTaskNumber, nextPosition] = await Promise.all([
      claimTaskNumberForIdentity(identity, destinationProjectId, tx),
      getNextTaskPosition(
        identity,
        tx,
        destinationProjectId,
        resolvedColumn.slug,
        resolvedColumn.id,
      ),
    ]);

    const updatedTask = await moveTaskAndAssetsForIdentity(
      tx,
      identity,
      taskId,
      lockedTask.projectId,
      destinationProjectId,
      {
        status: resolvedColumn.slug,
        columnId: resolvedColumn.id,
        number: nextTaskNumber,
        position: nextPosition,
      },
    );

    if (!updatedTask) {
      throw new HTTPException(500, {
        message: "Failed to move task",
      });
    }

    await insertRequiredTaskActivity(tx, identity, {
      taskId: updatedTask.id,
      type: "moved",
      userId: currentUserId,
      content: null,
      eventData: {
        fromProjectId: sourceProject.id,
        fromProjectName: sourceProject.name,
        toProjectId: destinationProject.id,
        toProjectName: destinationProject.name,
        oldStatus: lockedTask.status,
        newStatus: resolvedColumn.slug,
      },
    });

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
