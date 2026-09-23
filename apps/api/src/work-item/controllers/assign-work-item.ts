import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  membershipTable,
  personTable,
  workItemTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type ActivityActorType,
  type NewActivityInput,
  recordWorkItemActivity,
} from "../activity";

/**
 * `POST /api/work-items/{key}/assign` (`docs/03-features/assignment.md` § API,
 * `work_item:assign` with the `orSelfTarget(body.assigneeId, work_item:update)` branch).
 *
 * WHY A CONDITIONAL WRITE RATHER THAN `If-Match`. The spec models this route on
 * `POST /work-items/{key}/rank` (`WI-7`): it is an ACTION, not a field `PATCH`, so it is
 * deliberately exempt from the version header. The lost-update race it still has to
 * close is "two people assign the same item at once", and the spec names the primitive:
 * `UPDATE ... WHERE assignee_id IS NULL` for a plain assign, or
 * `WHERE assignee_id = $expectedCurrentAssigneeId` for a targeted reassign. Zero rows
 * updated means someone else won; the caller gets 409 carrying the CURRENT assignee so
 * the UI can show who took it (AS-3's confirmation flow reads exactly that).
 *
 * WHY THE UNCONDITIONAL CASE REQUIRES `assignee_id IS NULL`. Per the spec's own wording,
 * an unconditional assign is only a claim on UNASSIGNED work. Replacing an existing
 * holder always names the holder the caller saw (`expectedCurrentAssigneeId`), which is
 * what makes AS-3's "asked to confirm" honest rather than decorative.
 *
 * ROSTER (AS-5). The assignable list is the project roster, not the workspace directory:
 * a `membership` row scoped to this project for the target person. Only ACTIVE people are
 * eligible, unconditionally -- the same rule the spec generalises from the v1 "default
 * assignee is inactive" edge case.
 *
 * WHAT THIS DOES NOT DO (each a later slice, named on the route): clearing an assignment
 * (`DELETE`, AS-2's self-unassign branch needs its own row-based predicate), the
 * `GET /api/projects/{id}/assignable` picker feed, bulk assign, default assignees
 * (AS-11/12), workflow effects (AS-13) and the `work_item.assigned`/`unassigned`
 * notification fan-out (AS-16/17 -- the EVENTS below are emitted; the fan-out is a
 * separate subscriber slice). Workflow-version stamping (`workflow_version_id`) is not
 * touched by assignment in this slice.
 */

/** Thrown when the conditional write matched no row: someone else changed the assignee
 * between the handler's read and its write. The handler turns this into the spec's 409
 * carrying the row's current `assigneeId`. */
export class WorkItemAssigneeConflictError extends Error {
  constructor(
    public readonly key: string,
    public readonly currentAssigneeId: string | null,
  ) {
    super(
      `The assignee changed while this request was in flight; the work item is now ${
        currentAssigneeId === null
          ? "unassigned"
          : `assigned to ${currentAssigneeId}`
      }`,
    );
    this.name = "WorkItemAssigneeConflictError";
  }
}

export type AssignWorkItemInput = {
  assigneeId: string;
  expectedCurrentAssigneeId?: string | null;
};

export type AssignedWorkItem = {
  key: string;
  assigneeId: string;
  previousAssigneeId: string | null;
  version: number;
};

export async function assignWorkItem(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  input: AssignWorkItemInput,
): Promise<AssignedWorkItem> {
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

  // AS-5: the assignable list is the PROJECT ROSTER, active only. One lookup answers
  // both questions, so "not on the roster" and "deactivated" cannot be confused by two
  // queries drifting apart.
  const [roster] = await db
    .select({ active: personTable.active })
    .from(membershipTable)
    .innerJoin(personTable, eq(personTable.id, membershipTable.personId))
    .where(
      and(
        eq(membershipTable.scope, "project"),
        eq(membershipTable.scopeId, item.projectId),
        eq(membershipTable.personId, input.assigneeId),
      ),
    )
    .limit(1);

  // AS-5 applies to EVERY assignment, including a redundant re-assign of the current
  // holder: a deactivated holder is reported (400) rather than silently re-affirmed.
  // `AS-8`'s retention is about DISPLAY of an assignment that already exists; it is not a
  // licence to make a new one to an inactive person.
  if (!roster) {
    throw new HTTPException(400, {
      message:
        "That person is not on this project's roster -- add them to the project first",
    });
  }
  if (!roster.active) {
    throw new HTTPException(400, {
      message: "That person is deactivated and cannot be assigned work",
    });
  }

  // Idempotent no-op: assigning the current holder changes nothing and emits nothing.
  // A "reassign" to the person already holding the item is not a reassignment.
  if (item.assigneeId === input.assigneeId) {
    return {
      key: item.key,
      assigneeId: input.assigneeId,
      previousAssigneeId: item.assigneeId,
      version: item.version,
    };
  }

  const previousAssigneeId = item.assigneeId;

  const assigned = await db.transaction(async (tx) => {
    const expected = input.expectedCurrentAssigneeId ?? null;
    const [updated] = await tx
      .update(workItemTable)
      .set({
        assigneeId: input.assigneeId,
        // ATOMIC increment -- `item.version + 1` computed in JS from the pre-transaction
        // read was a lost-update bug the ordinary review of PR #353 caught: a concurrent
        // `PATCH` between the read and this write collapsed two bumps into one and could
        // even move the version BACKWARDS for an `If-Match` reader. The CAS clause below
        // guards the ASSIGNEE; this expression guards the version.
        version: sql`${workItemTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workItemTable.id, item.id),
          expected === null
            ? isNull(workItemTable.assigneeId)
            : eq(workItemTable.assigneeId, expected),
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

    // `WI-6`: an assignment change is a field change and gets an `activity` row, with the
    // same shape `diffWorkItemFieldChanges` produces for every other field (`verb:
    // "updated"`, the column name as `field`). `resolveVisibility` decides public vs
    // internal from the `(verb, field)` pair inside `recordWorkItemActivity` -- one
    // allowlist, never a second one invented here.
    const activityRow: NewActivityInput = {
      workspaceId,
      workItemId: item.id,
      actorId,
      actorType,
      verb: "updated",
      field: "assigneeId",
      oldValue: previousAssigneeId,
      newValue: input.assigneeId,
    };
    await recordWorkItemActivity(tx, [activityRow]);

    return {
      key: updated.key,
      assigneeId: input.assigneeId,
      previousAssigneeId,
      version: updated.version,
    };
  });

  // `AS-16`/`AS-17`'s declared event (`events.md`: `assigneeId`, `previousAssigneeId`),
  // emitted AFTER commit -- the same after-commit placement every other `publishEvent`
  // in this codebase uses. The notification fan-out that subscribes to it is a separate
  // slice; this route's job is to make the fact true and publish it.
  await publishEvent("work_item.assigned", {
    workItemId: item.id,
    key: item.key,
    workspaceId,
    projectId: item.projectId,
    assigneeId: input.assigneeId,
    previousAssigneeId,
    actorId,
    actorType,
  });

  return assigned;
}

export default assignWorkItem;
