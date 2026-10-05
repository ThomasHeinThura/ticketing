import { planAssignment } from "@taskdesk/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { projectTable, workItemTable } from "../../database/schema";
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
import { resolveAssigneeEligibility } from "../assignee-eligibility";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";

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
  actorPersonId: string | null,
  input: AssignWorkItemInput,
): Promise<AssignedWorkItem> {
  // Opus security review of PR #433, F1: `requireWorkItemReach()` enforces the
  // #202/#204 soft-deleted-project freeze for single-item routes via this same
  // join, but the bulk route calls this controller directly with `middleware: []`
  // and never goes through that middleware. Mirrored here (join, not the relational
  // `findFirst`, since no relations are declared on these tables) so every caller
  // -- including bulk -- is covered regardless of which middleware chain it went
  // through.
  const [item] = await db
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      assigneeId: workItemTable.assigneeId,
      version: workItemTable.version,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .where(
      and(
        eq(workItemTable.key, key),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);

  if (!item || item.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  // The no-op decision comes FIRST, from `packages/domain`'s `planAssignment` (#287) --
  // the single source for "assigning the current holder is not a reassignment". The Opus
  // review's S5 flagged the earlier inline copy: two sources for one rule. Adopting the
  // domain planner's order also settles the ordinary review's F4: a redundant re-assign
  // of a holder who has since been deactivated returns 200 and re-affirms the STORED
  // assignment (`AS-8`'s retention), because no new assignment is being made.
  const plan = planAssignment(
    item.assigneeId,
    input.assigneeId,
    actorPersonId ?? "",
  );
  if (plan.action === "noop") {
    return {
      key: item.key,
      assigneeId: input.assigneeId,
      previousAssigneeId: item.assigneeId,
      version: item.version,
    };
  }

  // `AS-5`, from the domain rule itself (`evaluateAssigneeEligibility`, #287, shared via
  // `resolveAssigneeEligibility` -- `../assignee-eligibility.ts`): on the project roster,
  // and active. One source, one reason -- also reused by the workflow-transition route's
  // `set_assignee` effect (Opus security review of PR #457, B2).
  const eligibility = await resolveAssigneeEligibility(
    db,
    item.projectId,
    input.assigneeId,
  );
  if (!eligibility.eligible) {
    throw new HTTPException(400, {
      message:
        eligibility.reason === "not_on_roster"
          ? "That person is not on this project's roster -- add them to the project first"
          : "That person is deactivated and cannot be assigned work",
    });
  }

  // NOT `item.assigneeId` -- that is a pre-transaction read and can go stale under a
  // race (Opus delta review 3, finding A1): a rival assignment can commit between this
  // read and the conditional UPDATE below, displacing the holder this variable would
  // otherwise name. `expectedCurrentAssigneeId` is what the UPDATE's own WHERE clause
  // checks against, so whenever the UPDATE actually matches and succeeds, this is
  // provably the true prior holder -- including the first-assign case, where an absent
  // `expectedCurrentAssigneeId` correctly becomes `null` (matching `IS NULL`).
  const previousAssigneeId = input.expectedCurrentAssigneeId ?? null;

  let realtimeEvent:
    | Awaited<ReturnType<typeof recordWorkItemEvent>>
    | undefined;
  const assigned = await db.transaction(async (tx) => {
    await assertProjectStillLive(tx, item.projectId);
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
          // Issue #490: same TOCTOU class #276/#486/#488 closed elsewhere. The liveness
          // check above is an unlocked pre-read outside this transaction, and
          // `delete-work-item.ts`'s soft-delete does not bump `version`, so a concurrent
          // soft-delete landing between that pre-read and this conditional UPDATE would
          // otherwise still match on `assigneeId` alone and assign a deleted/archived item.
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
          // Issue #493's project-freeze gap: the pre-read above also checked
          // `project.deleted_at`, but that too is an unlocked read outside this
          // transaction -- a concurrent project soft-delete in the same window would
          // otherwise still match here, since nothing about THIS conditional UPDATE
          // touches the project row. Zero rows matched because of this clause alone falls
          // into the same `!updated` -> `WorkItemAssigneeConflictError` branch below as
          // every other reason this WHERE can fail to match.
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

    // Audit trail (audit-trail.md's action catalogue: "Where a domain event exists for
    // the mutation, the audit action is that event's key" -- this route's own event,
    // `work_item.assigned`, published below regardless of whether this was a first
    // assign or a reassign). `projectId` is #344/AU-10's own point: a project-scoped
    // mutation must record it so a workspace audit READ can be reach-filtered to the
    // projects the reader can see. This is the first mutation route to call
    // `appendAuditLog` -- #344 landing (PR #375, `audit_log.project_id`) is what
    // unblocked it (decision log, 2026-09-23, "It must land before the first
    // project-scoped audit writer merges"). Same transaction as the conditional UPDATE
    // and the activity row above -- `appendAuditLog` takes its own
    // `pg_advisory_xact_lock` internally (see `audit-writer.ts`'s doc comment), so
    // nothing further is needed here for hash-chain serialisation.
    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId,
      projectId: item.projectId,
      action: "work_item.assigned",
      entityType: "work_item",
      entityId: item.id,
      before: { assigneeId: previousAssigneeId },
      after: { assigneeId: input.assigneeId },
    });

    realtimeEvent = await recordWorkItemEvent(tx, {
      kind: "work_item.assigned",
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
        assigneeId: input.assigneeId,
        previousAssigneeId,
      },
    });

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
  if (realtimeEvent) {
    await publishWorkItemHint(realtimeEvent, {
      kind: "work_item.assigned",
      key: item.key,
      projectId: item.projectId,
      customerVisible: true,
    });
  }

  return assigned;
}

export default assignWorkItem;
