import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { projectTable, workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type ActivityActorType,
  diffWorkItemFieldChanges,
  type NewActivityInput,
  recordWorkItemActivity,
  resolveVisibility,
} from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
  projectNotDeletedClause,
} from "../assert-work-item-live";
import type { BulkItemDecision } from "../bulk-reach";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import {
  type AssignWorkItemInput,
  assignWorkItem,
  WorkItemAssigneeConflictError,
} from "./assign-work-item";
import { deleteWorkItem } from "./delete-work-item";
import {
  NoMatchingTransitionError,
  SlaPauseConflictError,
  TransitionBlockedError,
  TransitionConflictError,
  transitionWorkItem,
} from "./transition-work-item";

// `POST /api/work-items/bulk` (`work_item:read` at the workspace level per the spec's own
// route table, "then each item is re-checked against its own capability; failures reported
// per WI-25").
//
// Supported operations (`WI-24`-`WI-27`):
// - `"delete"` (`work_item:delete`)
// - `"assign"` (`work_item:assign`)
// - `"set_priority"` (`work_item:set_priority`)
// - `"archive"` (`work_item:update`, `WI-20`)
// - `"transition"` (`work_item:transition`, `WI-26`)
//
// Label add/remove (`work_item_label` join table) and cycle/module (`feature.cycles`) are
// outside P1 schema scope.
//
// PER-ITEM AUTHORIZATION: every id gets the SAME two decisions a single-item call gets, from
// the same source (`../bulk-reach.ts` -> `utils/caller-reach.ts`): project REACH (an
// unreachable or missing id answers the identical "not found", `WI-25`: "a failure reason
// must not reveal whether an inaccessible work item exists") and the operation's
// project-level CAPABILITY (`work_item:delete` / `work_item:assign` /
// `work_item:set_priority` / `work_item:update` / `work_item:transition`; reachable but not
// permitted is reported per item as "Insufficient permissions").
//
// TRANSACTION SHAPE (`WI-25`): "transactional per item, not per batch: 47 of 50
// succeeding reports 3 failures with reasons rather than rolling everything back."
//
// `WI-27`: "one audit row per item plus one summary row."

export type BulkWorkItemOperation =
  | { operation: "delete" }
  | { operation: "assign"; assigneeId: string }
  | {
      operation: "set_priority";
      priority: "low" | "medium" | "high" | "urgent" | null;
    }
  | { operation: "archive" }
  | {
      operation: "transition";
      toStateTemplateId: string;
      identity: ResolvedIdentity;
    };

export type BulkWorkItemFailure = { id: string; reason: string };

export type BulkWorkItemResult = {
  succeeded: string[];
  failed: BulkWorkItemFailure[];
};

async function setPriorityWorkItem(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  priority: "low" | "medium" | "high" | "urgent" | null,
): Promise<void> {
  const { updated, activityRows, realtimeEvent } = await db.transaction(
    async (tx) => {
      const [locked] = await tx
        .select()
        .from(workItemTable)
        .where(
          and(
            eq(workItemTable.key, key),
            eq(workItemTable.workspaceId, workspaceId),
            isNull(workItemTable.deletedAt),
            isNull(workItemTable.archivedAt),
          ),
        )
        .for("update");

      assertWorkItemStillLive(locked);
      await assertProjectStillLive(tx, locked.projectId);

      const [updated] = await tx
        .update(workItemTable)
        .set({
          priority,
          version: sql`${workItemTable.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItemTable.id, locked.id),
            isNull(workItemTable.deletedAt),
            isNull(workItemTable.archivedAt),
            projectNotDeletedClause,
          ),
        )
        .returning();

      if (!updated) {
        throw new HTTPException(404, { message: "Work item not found" });
      }

      const activityRows = diffWorkItemFieldChanges(
        { priority: locked.priority },
        { priority: updated.priority },
        {
          workspaceId: updated.workspaceId,
          workItemId: updated.id,
          actorId,
          actorType,
        },
      );

      if (activityRows.length > 0) {
        await recordWorkItemActivity(tx, activityRows);
      }

      await appendAuditLog(tx, {
        actorId,
        actorType,
        workspaceId,
        projectId: updated.projectId,
        action: "work_item.updated",
        entityType: "work_item",
        entityId: updated.id,
        before: { priority: locked.priority },
        after: { priority: updated.priority },
      });

      const visibleChanges = activityRows
        .filter(
          (row) => row.verb === "updated" && typeof row.field === "string",
        )
        .map((row) => ({
          field: row.field,
          from: row.oldValue,
          to: row.newValue,
          visibility: resolveVisibility(row),
        }));
      const realtimeEvent =
        visibleChanges.length > 0
          ? await recordWorkItemEvent(tx, {
              kind: "work_item.updated",
              workItemId: updated.id,
              key: updated.key,
              workspaceId: updated.workspaceId,
              projectId: updated.projectId,
              actorId,
              actorType,
              customerVisible: visibleChanges.some(
                (change) => change.visibility === "public",
              ),
              payload: {
                key: updated.key,
                url: `/agent/work-items/${encodeURIComponent(updated.key)}`,
                changes: visibleChanges,
              },
            })
          : undefined;

      return { updated, activityRows, realtimeEvent };
    },
  );

  if (activityRows.length > 0) {
    const changes = activityRows
      .filter(
        (row: NewActivityInput): row is NewActivityInput & { field: string } =>
          row.verb === "updated" && typeof row.field === "string",
      )
      .map((row) => ({
        field: row.field,
        from: row.oldValue,
        to: row.newValue,
        visibility: resolveVisibility(row),
      }));

    await publishEvent("work_item.updated", {
      workItemId: updated.id,
      key: updated.key,
      workspaceId: updated.workspaceId,
      projectId: updated.projectId,
      changes,
      actorId,
      actorType,
    });
    if (realtimeEvent) {
      await publishWorkItemHint(realtimeEvent, {
        kind: "work_item.updated",
        key: updated.key,
        projectId: updated.projectId,
        customerVisible: changes.some(
          (change) => change.visibility === "public",
        ),
      });
    }
  }
}

async function archiveWorkItem(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: workItemTable.id,
        projectId: workItemTable.projectId,
        deletedAt: workItemTable.deletedAt,
        archivedAt: workItemTable.archivedAt,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
        ),
      )
      .limit(1)
      .for("update");

    assertWorkItemStillLive(locked);
    await assertProjectStillLive(tx, locked.projectId);

    const [archived] = await tx
      .update(workItemTable)
      .set({
        archivedAt: now,
        version: sql`${workItemTable.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(workItemTable.id, locked.id),
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
          projectNotDeletedClause,
        ),
      )
      .returning();

    if (!archived) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    await recordWorkItemActivity(tx, [
      {
        workspaceId,
        workItemId: archived.id,
        actorId,
        actorType,
        verb: "archived",
        field: null,
        oldValue: null,
        newValue: now.toISOString(),
      },
    ]);

    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId,
      projectId: archived.projectId,
      action: "work_item.updated",
      entityType: "work_item",
      entityId: archived.id,
      before: { archivedAt: null },
      after: { archivedAt: now.toISOString() },
    });
  });
}

async function transitionWorkItemByKey(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  identity: ResolvedIdentity,
  toStateTemplateId: string,
): Promise<void> {
  const [row] = await db
    .select({
      id: workItemTable.id,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .limit(1);

  if (!row) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  await transitionWorkItem(
    row.id,
    identity,
    identity.personId,
    actorId,
    actorType,
    { toStateTemplateId },
  );
}

async function runOne(
  id: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  op: BulkWorkItemOperation,
): Promise<void> {
  if (op.operation === "delete") {
    await deleteWorkItem(id, workspaceId, actorId, actorType);
    return;
  }
  if (op.operation === "assign") {
    const input: AssignWorkItemInput = { assigneeId: op.assigneeId };
    await assignWorkItem(id, workspaceId, actorId, actorType, null, input);
    return;
  }
  if (op.operation === "set_priority") {
    await setPriorityWorkItem(id, workspaceId, actorId, actorType, op.priority);
    return;
  }
  if (op.operation === "archive") {
    await archiveWorkItem(id, workspaceId, actorId, actorType);
    return;
  }
  await transitionWorkItemByKey(
    id,
    workspaceId,
    actorId,
    actorType,
    op.identity,
    op.toStateTemplateId,
  );
}

export async function bulkWorkItems(
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  workItemKeys: string[],
  op: BulkWorkItemOperation,
  /**
   * Per-item PROJECT reach and project-level capability, decided from the same source the
   * single-item routes use (`bulk-reach.ts`). An unreachable item fails with the identical
   * "not found" reason a nonexistent key gets (`WI-25`); a reachable item the caller may not
   * act on fails with "Insufficient permissions", as the single-item route would answer 403.
   */
  authorise: (key: string) => Promise<BulkItemDecision>,
): Promise<BulkWorkItemResult> {
  const succeeded: string[] = [];
  const failed: BulkWorkItemFailure[] = [];

  for (const key of workItemKeys) {
    try {
      const decision = await authorise(key);
      if (decision === "not_found") {
        throw new HTTPException(404, { message: "Work item not found" });
      }
      if (decision === "forbidden") {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      await runOne(key, workspaceId, actorId, actorType, op);
      succeeded.push(key);
    } catch (error) {
      if (error instanceof HTTPException) {
        const body = error.message || (await error.getResponse().text());
        failed.push({ id: key, reason: body || "failed" });
      } else if (
        error instanceof WorkItemAssigneeConflictError ||
        error instanceof NoMatchingTransitionError ||
        error instanceof TransitionConflictError ||
        error instanceof SlaPauseConflictError ||
        error instanceof TransitionBlockedError
      ) {
        failed.push({ id: key, reason: error.message || "failed" });
      } else {
        failed.push({ id: key, reason: "failed" });
      }
    }
  }

  await appendAuditLog(db, {
    actorId,
    actorType,
    workspaceId,
    action: "bulk.performed",
    entityType: "workspace",
    entityId: workspaceId,
    before: null,
    after: {
      operation: op.operation,
      requested: workItemKeys.length,
      succeeded: succeeded.length,
      failed: failed.length,
    },
  });

  return { succeeded, failed };
}

export default bulkWorkItems;
