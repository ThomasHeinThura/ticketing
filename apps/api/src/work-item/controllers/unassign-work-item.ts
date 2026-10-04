import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type ActivityActorType,
  type NewActivityInput,
  recordWorkItemActivity,
} from "../activity";
import {
  assertProjectStillLive,
  projectNotDeletedClause,
} from "../assert-work-item-live";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
// The 409 shape is the assign route's own (`assignment.md`'s conditional-write conflict:
// "the assignee changed while this request was in flight"). One class, two action routes
// that clear or move the same field -- the extraction the reviewers asked for when the
// third caller appears (see #359's helper note); a second, identical class here would be
// the copy this comment exists to avoid.
import { WorkItemAssigneeConflictError } from "./assign-work-item";

/**
 * `DELETE /api/work-items/{key}/assign` (`docs/03-features/assignment.md` § API,
 * `work_item:assign` with the `orOwner(row.assignee_id, work_item:update)` branch).
 *
 * THE ASYMMETRY WITH `POST`, and why it needs its own predicate. On the assign route the
 * self-branch reads the REQUEST BODY -- "the NEW assignee is the actor" -- so it is an
 * `orSelfTarget` body predicate. Here the branch reads the LOADED ROW: "the CURRENT holder
 * is the actor" -- `AS-2`'s "unassign self | `work_item:update`" row. That is what an
 * `orOwner` predicate expresses, and why the permissions registry gained
 * `row.assignee_id === identity.personId` in this change rather than reusing the body
 * shape: on this route the body names nobody.
 *
 * CONDITIONAL WRITE, like `POST`'s (`AS-9`: work is never silently unassigned, and by
 * symmetry never unwittingly cleared out from under a colleague). The write is
 * `UPDATE ... WHERE id = :id AND assignee_id = :previousAssigneeId` -- the holder the
 * handler actually read. Zero rows updated means someone else acted first, and the
 * response is the same 409 the assign route returns, carrying who holds it now.
 *
 * IDEMPOTENT NO-OP when the item is already unassigned: 200, and nothing else happens --
 * no `version` bump, no activity row, no event. `AS-9`'s "never silently unassigned"
 * protects against clearing an assignment the caller did not see; there is no assignment
 * here to clear, so the honest answer is "it is already as you asked" rather than an
 * invented conflict or a write that would fabricate history.
 *
 * WHAT THIS DOES NOT DO: the notification fan-out that subscribes to
 * `work_item.unassigned` (`AS-17`/`AS-18`: the event IS emitted here; excluding the actor
 * from their own notification is the fan-out's job), and bulk unassign.
 */

export type UnassignedWorkItem = {
  key: string;
  assigneeId: null;
  previousAssigneeId: string | null;
  version: number;
};

export async function unassignWorkItem(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  /**
   * The assignee the CALLER'S AUTHORITY was decided against -- the value the handler
   * read before `assertCallerHasCapabilityOrSelf`. Required, not defaulted, and the
   * write below pins to THIS value, never to a fresh re-read: the ordinary review of
   * PR #365's F1 demonstrated the alternative. Without the pin, a reassignment landing
   * between the handler's check and this function's own load let a `work_item:update`
   * caller clear the NEW holder's assignment (200, activity and event naming the
   * victim) -- the decision and the write must be made against the same observed fact.
   */
  expectedAssigneeId: string | null,
): Promise<UnassignedWorkItem> {
  const item = await db.query.workItemTable.findFirst({
    where: and(
      eq(workItemTable.key, key),
      isNull(workItemTable.archivedAt),
      isNull(workItemTable.deletedAt),
    ),
  });

  if (!item || item.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  if (item.assigneeId === null) {
    return {
      key: item.key,
      assigneeId: null,
      previousAssigneeId: null,
      version: item.version,
    };
  }

  // F1's pin, read side: the row changed holder since the authority decision was made.
  // Clearing now would clear SOMEONE ELSE'S assignment -- exactly what the branch must
  // never authorise -- so this is the assign family's 409, not a write.
  if (item.assigneeId !== expectedAssigneeId) {
    throw new WorkItemAssigneeConflictError(key, item.assigneeId);
  }

  const previousAssigneeId = item.assigneeId;

  let realtimeEvent:
    | Awaited<ReturnType<typeof recordWorkItemEvent>>
    | undefined;
  const cleared = await db.transaction(async (tx) => {
    await assertProjectStillLive(tx, item.projectId);
    const [updated] = await tx
      .update(workItemTable)
      .set({
        assigneeId: null,
        // Same atomic increment the assign route documents: computing `item.version + 1`
        // in JS from the pre-transaction read is a lost-update bug (#353's ordinary
        // review caught it once already).
        version: sql`${workItemTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workItemTable.id, item.id),
          eq(workItemTable.assigneeId, previousAssigneeId),
          // Issue #490: same TOCTOU class #276/#486/#488 closed elsewhere, same shape as
          // `assign-work-item.ts`'s own fix -- the liveness check above is an unlocked
          // pre-read outside this transaction, and `delete-work-item.ts`'s soft-delete
          // does not bump `version`, so a concurrent soft-delete landing between that
          // pre-read and this conditional UPDATE would otherwise still match on
          // `assigneeId` alone and clear the assignment on a deleted/archived item.
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
          // Issue #493's project-freeze gap, same shape as `assign-work-item.ts`'s own
          // fix: this route's pre-read never even checked the project at all, and even if
          // it had, that read is unlocked and outside this transaction -- a concurrent
          // project soft-delete in the window before this UPDATE would otherwise still
          // match. Falls into the same `!updated` -> `WorkItemAssigneeConflictError`
          // branch below as every other reason this WHERE can fail to match.
          projectNotDeletedClause,
        ),
      )
      .returning({
        key: workItemTable.key,
        version: workItemTable.version,
      });

    if (!updated) {
      const [current] = await tx
        .select({ assigneeId: workItemTable.assigneeId })
        .from(workItemTable)
        .where(eq(workItemTable.id, item.id))
        .limit(1);
      throw new WorkItemAssigneeConflictError(key, current?.assigneeId ?? null);
    }

    // `WI-6`: clearing the assignment is a field change and gets an `activity` row with
    // the same shape every other `assigneeId` change uses (verb `updated`, field
    // `assigneeId`); `recordWorkItemActivity` resolves its public/internal visibility
    // from the shared (verb, field) allowlist -- one allowlist, never a second one here.
    const activityRow: NewActivityInput = {
      workspaceId,
      workItemId: item.id,
      actorId,
      actorType,
      verb: "updated",
      field: "assigneeId",
      oldValue: previousAssigneeId,
      newValue: null,
    };
    await recordWorkItemActivity(tx, [activityRow]);

    // Audit trail (audit-trail.md's action catalogue: "Where a domain event exists for
    // the mutation, the audit action is that event's key" -- this route's own event,
    // `work_item.unassigned`, published below). `projectId` is #344/AU-10's own point: a
    // project-scoped mutation must record it so a workspace audit READ can be
    // reach-filtered to the projects the reader can see. Same transaction as the
    // conditional UPDATE and the activity row above -- `appendAuditLog` takes its own
    // `pg_advisory_xact_lock` internally (see `audit-writer.ts`'s doc comment), so
    // nothing further is needed here for hash-chain serialisation. Mirrors the assign
    // route's own `appendAuditLog` call (PR #353/#344, `assign-work-item.ts`).
    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId,
      projectId: item.projectId,
      action: "work_item.unassigned",
      entityType: "work_item",
      entityId: item.id,
      before: { assigneeId: previousAssigneeId },
      after: { assigneeId: null },
    });

    realtimeEvent = await recordWorkItemEvent(tx, {
      kind: "work_item.unassigned",
      workItemId: item.id,
      key: updated.key,
      workspaceId,
      projectId: item.projectId,
      actorId,
      actorType,
      customerVisible: true,
      payload: {
        key: updated.key,
        url: `/agent/work-items/${encodeURIComponent(updated.key)}`,
        previousAssigneeId,
      },
    });

    return {
      key: updated.key,
      assigneeId: null,
      previousAssigneeId,
      version: updated.version,
    };
  });

  // `AS-17`'s declared event (`events.md`: `previousAssigneeId`), after commit -- the same
  // placement as `work_item.assigned` on the assign route.
  await publishEvent("work_item.unassigned", {
    workItemId: item.id,
    key: item.key,
    workspaceId,
    projectId: item.projectId,
    previousAssigneeId,
    actorId,
    actorType,
  });
  if (realtimeEvent) {
    await publishWorkItemHint(realtimeEvent, {
      kind: "work_item.unassigned",
      key: item.key,
      projectId: item.projectId,
      customerVisible: true,
    });
  }

  return cleared;
}

export default unassignWorkItem;
