import {
  asStateTemplateId,
  type BlockReason,
  filterOfferableForType,
  legalTransitions,
  offerTransition,
  resolveAutomaticEffects,
  resolveEffects,
  resolveStateTemplateForProject,
  type TransitionOfferContext,
} from "@taskdesk/domain";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import {
  commentTable,
  scheduledTransitionTable,
  workItemTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { type ActivityActorType, recordWorkItemActivity } from "../activity";
import {
  buildGuardContext,
  loadWorkflowTransitionContext,
  resolveActorRoleIds,
} from "../workflow-transition-context";

export type TransitionWorkItemInput = {
  toStateTemplateId: string;
  note?: string;
};

export type TransitionedWorkItem = {
  key: string;
  stateId: string;
  assigneeId: string | null;
  resolvedAt: Date | null;
  version: number;
};

/** Thrown for `WF-4`'s "not from here" 409: no transition matches
 * `(current template, target template, one of the actor's roles)`, the target is
 * excluded by the CAB type-gate (`WF-14`), or the target template has no concrete state
 * in this project (the same 409, per `WF-2`). */
export class NoMatchingTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoMatchingTransitionError";
  }
}

/** Thrown for the 422 "the edge exists but is not available right now" case: a guard,
 * the (always-unsatisfied, interim) approval/CAB gate, or a missing required note. */
export class TransitionBlockedError extends Error {
  constructor(public readonly blockedBy: BlockReason[]) {
    super("This transition is not currently available");
    this.name = "TransitionBlockedError";
  }
}

/** Thrown when the work item's state changed between this request's read and its
 * conditional write -- the same race `assign-work-item.ts` closes for `assignee_id`,
 * applied here to `state_id` instead. */
export class TransitionConflictError extends Error {
  constructor(public readonly currentStateId: string) {
    super("The work item's state changed while this request was in flight");
    this.name = "TransitionConflictError";
  }
}

/**
 * `set_assignee`'s `'default'` (`WF-19`), resolved against what this schema can
 * ACTUALLY answer today: neither `project.default_assignee_id` nor a request-type
 * default column exists yet (`AS-11`/`AS-12` -- `packages/domain`'s own
 * `resolveDefaultAssignee` takes both as arguments, and this codebase has no column to
 * pass for either), so `'default'` always resolves to `null` -- never faked as some
 * other candidate. Disclosed in the PR body's "Not done" section, not a silent gap.
 */
function resolveSetAssigneePersonId(
  personId: string | "default",
): string | null {
  return personId === "default" ? null : personId;
}

/**
 * `POST /api/work-items/{key}/transition` (`docs/03-features/workflows.md`, issue #442
 * -- the execution route the persistence PR (#31/#443) deliberately left unbuilt).
 *
 * `work_item:transition` itself (`WF-4`'s 403) is the ROUTE's own `requireWorkspaceCapability`
 * gate, enforced in `index.ts` before this function is ever called -- this function only
 * ever produces the 409/422 half of `WF-4`'s split ("you may not" vs "not from here" vs
 * "not right now").
 *
 * INTERIM, until #36 (approvals) lands: `requiresApproval`/`requiresCab` are read
 * correctly from the transition row, but `approvalSatisfied`/`cabSatisfied` are always
 * `false` when either flag is set -- there is no `approval` table yet to check against.
 * A transition carrying either flag can never complete through this route today. This is
 * a documented interim state (issue #442's own instruction), not a design decision made
 * here.
 *
 * EFFECTS THIS FUNCTION CANNOT EXECUTE, DISCLOSED (no schema to write to yet):
 * `pause_sla`/`resume_sla` (no `sla_pause` table) and `set_field` (no custom-field/
 * satellite value store) are silently no-ops here -- reading `transition.effects` for
 * either kind and doing nothing, rather than failing the whole transition over a gap in
 * unrelated, not-yet-built infrastructure. `WF-17`/`WF-18`'s automatic mechanism only
 * sets/clears `work_item.resolved_at` for the identical reason -- the `sla_pause` row a
 * real "resolved"/"resumed" write implies does not exist to write.
 * `set_assignee`/`clear_assignee` and `schedule_transition` ARE fully wired.
 *
 * `WF-21` (customer-initiated reopen, executed as a system actor): the three call sites
 * that mechanism names (a reply to a closed request, an upload to a resolved one, a
 * portal reopen action) have no live customer-portal caller identity anywhere in this
 * codebase yet (the same gap every other P2 route touching the portal has disclosed --
 * see `rank-work-item.ts`'s own doc comment). What this route DOES implement: a
 * work item's `is_reopen`-marked transition is not special-cased at all -- it is simply
 * another edge in `transitions`, found and executed by the exact same
 * `legalTransitions`/`offerTransition` path as any other, for whichever actor is legally
 * entitled to take it. The system-actor bypass WF-21 additionally grants those three
 * call sites is out of scope until a caller for them exists.
 */
export async function transitionWorkItem(
  workItemId: string,
  personId: string | null,
  actorId: string,
  actorType: ActivityActorType,
  input: TransitionWorkItemInput,
): Promise<TransitionedWorkItem> {
  const ctx = await loadWorkflowTransitionContext(workItemId);
  if (!ctx) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  if (!ctx.activeVersion) {
    throw new NoMatchingTransitionError(
      "This work item's type has no active workflow version",
    );
  }

  const actorRoleIds = await resolveActorRoleIds(
    personId,
    ctx.workItem.workspaceId,
    ctx.workItem.projectId,
  );
  const legal = legalTransitions(
    ctx.transitions,
    ctx.currentStateTemplateId,
    actorRoleIds,
  );
  const offerable = filterOfferableForType(legal, ctx.isChangeType);
  const targetTemplateId = asStateTemplateId(input.toStateTemplateId);
  const match = offerable.find((t) => t.toStateTemplateId === targetTemplateId);
  if (!match) {
    throw new NoMatchingTransitionError(
      "No transition matches the requested target for this actor from the work item's current state",
    );
  }

  const resolution = resolveStateTemplateForProject(
    match.toStateTemplateId,
    ctx.adoptedStates,
  );
  if (!resolution.ok) {
    // `WF-2`: the same 409 as "no matching transition" -- the target template has no
    // concrete state in this project.
    throw new NoMatchingTransitionError(
      "The target state is not available in this work item's project",
    );
  }

  const hasNote =
    typeof input.note === "string" && input.note.trim().length > 0;
  const guardContext = await buildGuardContext(ctx);
  const offerContext: TransitionOfferContext = {
    ...guardContext,
    approvalSatisfied: false,
    cabSatisfied: false,
    hasNote,
  };
  const offer = offerTransition(match, offerContext);
  if (!offer.available) {
    throw new TransitionBlockedError(offer.blockedBy);
  }

  const fromStateId = ctx.workItem.stateId;
  const toStateId = resolution.stateId;
  const fromGroup = ctx.currentGroup;
  const toGroup = ctx.templateGroups.get(match.toStateTemplateId) ?? fromGroup;

  const authoredEffects = resolveEffects(match);
  const automaticEffects = resolveAutomaticEffects(fromGroup, toGroup);

  let assigneeIdPatch: string | null | undefined;
  const scheduleEffects: { afterMinutes: number; toStateTemplateId: string }[] =
    [];
  for (const effect of authoredEffects) {
    if (effect.kind === "set_assignee") {
      assigneeIdPatch = resolveSetAssigneePersonId(effect.personId);
    } else if (effect.kind === "clear_assignee") {
      assigneeIdPatch = null;
    } else if (effect.kind === "schedule_transition") {
      scheduleEffects.push({
        afterMinutes: effect.afterMinutes,
        toStateTemplateId: effect.toStateTemplateId,
      });
    }
    // `pause_sla`/`resume_sla`/`set_field`: no backing table yet -- disclosed no-op,
    // see this function's own doc comment.
  }

  let resolvedAtPatch: Date | null | undefined;
  for (const effect of automaticEffects) {
    if (effect.kind === "resolve_sla") {
      resolvedAtPatch = new Date();
    } else if (effect.kind === "reopen_sla") {
      resolvedAtPatch = null;
    }
  }

  const result = await db.transaction(async (tx) => {
    const updateValues: Partial<typeof workItemTable.$inferInsert> = {
      stateId: toStateId,
      version: sql`${workItemTable.version} + 1` as unknown as number,
      updatedAt: new Date(),
    };
    if (assigneeIdPatch !== undefined) {
      updateValues.assigneeId = assigneeIdPatch;
    }
    if (resolvedAtPatch !== undefined) {
      updateValues.resolvedAt = resolvedAtPatch;
    }

    const [updated] = await tx
      .update(workItemTable)
      .set(updateValues)
      .where(
        and(
          eq(workItemTable.id, ctx.workItem.id),
          eq(workItemTable.stateId, fromStateId),
        ),
      )
      .returning({
        key: workItemTable.key,
        version: workItemTable.version,
        assigneeId: workItemTable.assigneeId,
        resolvedAt: workItemTable.resolvedAt,
      });

    if (!updated) {
      const [current] = await tx
        .select({ stateId: workItemTable.stateId })
        .from(workItemTable)
        .where(eq(workItemTable.id, ctx.workItem.id))
        .limit(1);
      throw new TransitionConflictError(current?.stateId ?? fromStateId);
    }

    for (const schedule of scheduleEffects) {
      const scheduleResolution = resolveStateTemplateForProject(
        asStateTemplateId(schedule.toStateTemplateId),
        ctx.adoptedStates,
      );
      if (!scheduleResolution.ok) {
        // Structurally the validation panel's own job to catch before publish
        // (`WF-9`-adjacent) -- skipped here rather than failing an otherwise-legal
        // transition over a workflow-authoring gap in an unrelated effect.
        continue;
      }
      await tx.insert(scheduledTransitionTable).values({
        projectId: ctx.workItem.projectId,
        workItemId: ctx.workItem.id,
        transitionId: match.id,
        fromStateId: toStateId,
        toStateId: scheduleResolution.stateId,
        dueAt: new Date(Date.now() + schedule.afterMinutes * 60_000),
        state: "pending",
      });
    }

    const [transitionActivity] = await recordWorkItemActivity(tx, [
      {
        workspaceId: ctx.workItem.workspaceId,
        workItemId: ctx.workItem.id,
        actorId,
        actorType,
        verb: "transitioned",
        oldValue: fromStateId,
        newValue: toStateId,
        workflowVersionId: ctx.activeVersion?.id ?? null,
      },
    ]);

    if (
      assigneeIdPatch !== undefined &&
      assigneeIdPatch !== ctx.workItem.assigneeId
    ) {
      await recordWorkItemActivity(tx, [
        {
          workspaceId: ctx.workItem.workspaceId,
          workItemId: ctx.workItem.id,
          actorId,
          actorType,
          verb: "updated",
          field: "assigneeId",
          oldValue: ctx.workItem.assigneeId,
          newValue: assigneeIdPatch,
        },
      ]);
    }

    // `WF-10`/`WF-11`/`WF-12`: a supplied note is stored as a comment, visibility from
    // the transition's own `note_visibility`, linked to the `transitioned` activity row
    // so the activity stream renders both as one entry.
    if (hasNote && input.note !== undefined && transitionActivity) {
      await tx.insert(commentTable).values({
        workspaceId: ctx.workItem.workspaceId,
        workItemId: ctx.workItem.id,
        authorId: actorId,
        actorType,
        body: input.note,
        visibility: match.noteVisibility,
        activityId: transitionActivity.id,
      });
    }

    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId: ctx.workItem.workspaceId,
      projectId: ctx.workItem.projectId,
      action: "work_item.transitioned",
      entityType: "work_item",
      entityId: ctx.workItem.id,
      before: { stateId: fromStateId },
      after: { stateId: toStateId },
    });

    return {
      key: updated.key,
      stateId: toStateId,
      assigneeId: updated.assigneeId,
      resolvedAt: updated.resolvedAt,
      version: updated.version,
    };
  });

  await publishEvent("work_item.transitioned", {
    workItemId: ctx.workItem.id,
    key: result.key,
    workspaceId: ctx.workItem.workspaceId,
    projectId: ctx.workItem.projectId,
    fromStateId,
    toStateId,
    workflowVersion: ctx.activeVersion.number,
    note: input.note,
    actorId,
    actorType,
  });

  return result;
}

export default transitionWorkItem;
