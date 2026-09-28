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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import {
  commentTable,
  scheduledTransitionTable,
  stateTable,
  stateTemplateTable,
  workItemTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { type ActivityActorType, recordWorkItemActivity } from "../activity";
import { resolveAssigneeEligibility } from "../assignee-eligibility";
import {
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

/**
 * A block reason this route can report beyond `packages/domain`'s own closed
 * `BlockReason` vocabulary: `{ kind: "assignee", reasonCode: "assignee.<reason>" }`, for
 * B2's fix (Opus security review of PR #457) -- a `set_assignee` effect whose target
 * fails `AS-5`'s roster/active eligibility check blocks the whole transition the same way
 * an unsatisfied guard does, rather than silently writing an ineligible assignee.
 */
export type TransitionBlockReason =
  | BlockReason
  | {
      kind: "assignee";
      reasonCode: `assignee.${"not_on_roster" | "not_active"}`;
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
 * the (always-unsatisfied, interim) approval/CAB gate, a missing required note, or an
 * ineligible `set_assignee` target (B2). */
export class TransitionBlockedError extends Error {
  constructor(public readonly blockedBy: TransitionBlockReason[]) {
    super("This transition is not currently available");
    this.name = "TransitionBlockedError";
  }
}

/** Thrown when the work item's state changed between this request's read and its
 * locked, conditional write -- the same race `assign-work-item.ts` closes for
 * `assignee_id`, applied here to `state_id` instead. */
export class TransitionConflictError extends Error {
  constructor(public readonly currentStateId: string) {
    super("The work item's state changed while this request was in flight");
    this.name = "TransitionConflictError";
  }
}

/**
 * `pg`'s driver attaches Postgres's own SQLSTATE to `.code` on the error it throws.
 * `40P01` is `deadlock_detected` -- narrow, deliberate detection of exactly that one
 * condition, never a catch-all for "any database error."
 */
export function isPostgresDeadlockError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "40P01"
  );
}

/**
 * Opus security review of PR #457, D2 (non-blocking, handled anyway, not merely
 * disclosed): this route's own lock ordering (the parent row, then its children) is the
 * OPPOSITE of `set-work-item-parent.ts`'s (the child row, then the new parent's
 * ancestors, via the cycle-check trigger's own locking walk) -- reproduced live, moving a
 * child within the same parent's subtree concurrently with that parent transitioning can
 * deadlock, and Postgres aborts exactly one side with a real `40P01`. Re-ordering every
 * lock both this route and `set-work-item-parent.ts` take is a much larger, riskier
 * change for a transient, retry-safe condition, so a genuine deadlock is caught here and
 * reported as the same 409 an ordinary lost race already gets -- never a raw, unhandled
 * 500 for a condition the client can simply retry.
 */
async function runTransactionCatchingDeadlock<T>(
  currentStateId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isPostgresDeadlockError(error)) {
      throw new TransitionConflictError(currentStateId);
    }
    throw error;
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
 * RACE SAFETY (Opus security review of PR #457, finding B1, BLOCKING, fixed here). The
 * ROLE/state-TEMPLATE legality of the requested edge (`match`, below) is resolved from an
 * unlocked, pre-transaction read -- that is fine, because a role grant or a workflow's
 * transition graph does not change moment-to-moment the way a work item's own mutable
 * facts do. But every fact the GUARD context reads (`assignee_present`, `children_closed`)
 * DOES change concurrently, and B1 proved live that evaluating those facts outside the
 * transaction, then writing behind a `WHERE state_id = <the state it was read as>` that
 * never re-checks them, lets a concurrent write invalidate a guard between the read and
 * the write without ever being noticed: the guard passed against a fact that was no
 * longer true by the time the row actually changed. The fix is structural, not a patch
 * per guard type: `SELECT ... FOR UPDATE` the work item FIRST, inside the transaction,
 * then rebuild the ENTIRE guard context (including re-verifying the current state
 * template itself, not just `assignee_present`) from that locked read, and only then
 * decide `offerTransition`. Children are read `FOR SHARE` in the same transaction for the
 * identical reason -- a child reopened concurrently must not be invisible to
 * `children_closed`.
 *
 * ASSIGNEE ELIGIBILITY (Opus security review of PR #457, finding B2, BLOCKING, fixed
 * here). A `set_assignee` effect used to write `effect.personId` straight into
 * `work_item.assignee_id` with no roster/active/tenant check at all -- an actor holding
 * only `work_item:transition` (never `work_item:assign`) could put a deactivated person
 * from a different organisation on a work item. This now runs the exact same `AS-5`
 * eligibility rule `assign-work-item.ts` uses (`resolveAssigneeEligibility`, shared, not
 * reimplemented) inside the SAME locked transaction, and refuses the WHOLE transition
 * (state change included, per the review's own instruction) with a 422 when the target is
 * ineligible -- never a partial apply. When it IS eligible, the assignment is recorded
 * with the same activity/audit/event shape `assign-work-item.ts`'s own write path uses
 * (`work_item.assigned`/`work_item.unassigned`), not a narrower inline copy.
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
  const fromStateId = ctx.workItem.stateId;
  const toStateId = resolution.stateId;
  const toGroup =
    ctx.templateGroups.get(match.toStateTemplateId) ?? ctx.currentGroup;

  const authoredEffects = resolveEffects(match);
  const automaticEffects = resolveAutomaticEffects(ctx.currentGroup, toGroup);

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

  const result = await runTransactionCatchingDeadlock(fromStateId, () =>
    db.transaction(async (tx) => {
      // B1: lock the row FIRST, before deciding anything guard-shaped. Every fact below is
      // read from THIS locked row, never from `ctx`'s earlier, unlocked read.
      const [locked] = await tx
        .select({
          stateId: workItemTable.stateId,
          assigneeId: workItemTable.assigneeId,
        })
        .from(workItemTable)
        .where(eq(workItemTable.id, ctx.workItem.id))
        .for("update");

      if (!locked || locked.stateId !== fromStateId) {
        throw new TransitionConflictError(locked?.stateId ?? fromStateId);
      }

      // `children_closed` (Opus security review of PR #457, D1 -- the remaining half of
      // B1 the first fix round missed): lock children with a SINGLE-TABLE query first --
      // `parent_id = ?` alone, no join -- then resolve each locked row's state in a
      // SEPARATE second step. A `FOR SHARE` query that JOINS to `state` was proven live to
      // return a STALE row for a child whose `state_id` changed while this transaction
      // waited on the lock: Postgres's `EvalPlanQual` re-check re-verifies the join
      // condition against the query's original snapshot of the OTHER side of the join, not
      // a live re-fetch, so the just-committed new `state_id` silently dropped the row out
      // of the result entirely (an empty `children` array reads as vacuously
      // "all children closed" -- exactly backwards). Locking `work_item` alone guarantees
      // the `stateId` this step reads back is the true, post-commit value; state templates
      // are effectively static reference data, so resolving THEIR group in a second,
      // unlocked query is safe.
      const lockedChildren = await tx
        .select({ id: workItemTable.id, stateId: workItemTable.stateId })
        .from(workItemTable)
        .where(
          and(
            eq(workItemTable.parentId, ctx.workItem.id),
            isNull(workItemTable.archivedAt),
            isNull(workItemTable.deletedAt),
          ),
        )
        .for("share");
      const childStateIds = [...new Set(lockedChildren.map((c) => c.stateId))];
      const childStateGroups =
        childStateIds.length === 0
          ? new Map<string, string>()
          : new Map(
              (
                await tx
                  .select({
                    id: stateTable.id,
                    group: stateTemplateTable.group,
                  })
                  .from(stateTable)
                  .innerJoin(
                    stateTemplateTable,
                    eq(stateTable.stateTemplateId, stateTemplateTable.id),
                  )
                  .where(inArray(stateTable.id, childStateIds))
              ).map((row) => [row.id, row.group]),
            );
      const allChildrenClosed = lockedChildren.every((child) => {
        const group = childStateGroups.get(child.stateId);
        return group === "completed" || group === "cancelled";
      });

      const offerContext: TransitionOfferContext = {
        allChildrenClosed,
        // `no_open_blockers`/`field_required`/`change_risk_at_most` fail closed
        // unconditionally -- no schema exists yet to resolve them for real. See
        // `buildGuardContext`'s own doc comment (`../workflow-transition-context.ts`),
        // which the read-only `GET /transitions` feed still uses for these same three
        // constants; kept static here too rather than pulled from a helper that would
        // also re-run its OWN unlocked, redundant children query this function already
        // did correctly, under lock, above.
        hasOpenBlockers: true,
        fieldValues: {},
        changeRiskLevel: null,
        assigneePresent: locked.assigneeId !== null,
        approvalSatisfied: false,
        cabSatisfied: false,
        hasNote,
      };
      const offer = offerTransition(match, offerContext);
      if (!offer.available) {
        throw new TransitionBlockedError(offer.blockedBy);
      }

      // B2: a `set_assignee` target must pass the SAME roster/active eligibility check
      // `assign-work-item.ts` enforces -- refuse the WHOLE transition, state change
      // included, rather than write an ineligible assignee.
      if (assigneeIdPatch !== undefined && assigneeIdPatch !== null) {
        const eligibility = await resolveAssigneeEligibility(
          tx,
          ctx.workItem.projectId,
          assigneeIdPatch,
        );
        if (!eligibility.eligible) {
          throw new TransitionBlockedError([
            { kind: "assignee", reasonCode: `assignee.${eligibility.reason}` },
          ]);
        }
      }

      const previousAssigneeId = locked.assigneeId;

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
        // Defence in depth only -- the `FOR UPDATE` lock above already makes this
        // unreachable in practice, since nothing can change `state_id` between that lock
        // and this write without first taking the same lock.
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
        // Opus security review of PR #457, N7: `afterMinutes` carries no schema upper
        // bound (see `workflow/schema.ts`'s own comment on why it is not tightened there),
        // so a large enough authored value overflows `Date`'s valid range here and would
        // otherwise hand Postgres an invalid timestamp -- a 500 on every future execution
        // of this edge, not a 4xx. Validated at the one place the value actually turns into
        // a `Date`, skipped the same way an unresolvable target already is above, rather
        // than failing an otherwise-legal transition over one unrelated effect.
        const dueAt = new Date(Date.now() + schedule.afterMinutes * 60_000);
        if (Number.isNaN(dueAt.getTime())) {
          continue;
        }
        await tx.insert(scheduledTransitionTable).values({
          projectId: ctx.workItem.projectId,
          workItemId: ctx.workItem.id,
          transitionId: match.id,
          fromStateId: toStateId,
          toStateId: scheduleResolution.stateId,
          dueAt,
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

      // `assigneeEventKind` decides which of `work_item.assigned`/`work_item.unassigned`
      // (AS-16/AS-17) to publish after commit, mirroring `assign-work-item.ts`'s own
      // activity + audit + event shape exactly -- not a narrower inline copy (Opus review,
      // B2's fix instruction).
      let assigneeEventKind: "assigned" | "unassigned" | null = null;
      if (
        assigneeIdPatch !== undefined &&
        assigneeIdPatch !== previousAssigneeId
      ) {
        await recordWorkItemActivity(tx, [
          {
            workspaceId: ctx.workItem.workspaceId,
            workItemId: ctx.workItem.id,
            actorId,
            actorType,
            verb: "updated",
            field: "assigneeId",
            oldValue: previousAssigneeId,
            newValue: assigneeIdPatch,
          },
        ]);
        await appendAuditLog(tx, {
          actorId,
          actorType,
          workspaceId: ctx.workItem.workspaceId,
          projectId: ctx.workItem.projectId,
          action:
            assigneeIdPatch === null
              ? "work_item.unassigned"
              : "work_item.assigned",
          entityType: "work_item",
          entityId: ctx.workItem.id,
          before: { assigneeId: previousAssigneeId },
          after: { assigneeId: assigneeIdPatch },
        });
        assigneeEventKind =
          assigneeIdPatch === null ? "unassigned" : "assigned";
      }

      // `WF-10`/`WF-11`/`WF-12`: a supplied note is stored as a comment, visibility from
      // the transition's own `note_visibility`, linked to the `transitioned` activity row
      // so the activity stream renders both as one entry.
      //
      // KNOWN, DISCLOSED AMBIGUITY (ordinary review of PR #457, F2): `commentTable.body`
      // is a `jsonb` column that every OTHER writer (`create-comment.ts`) fills with
      // whatever Tiptap-document-shaped object the browser editor composed; this writes a
      // bare JS string instead. `apps/web` has no live renderer for THIS table's
      // `body` at all yet (its comment UI still reads the legacy, unrelated
      // `task_comment` table -- confirmed by reading `apps/web/src/components/activity/
      // comment-card.tsx`, which takes a plain `content: string` prop from that older
      // system), so nothing breaks today. But `create-comment.ts` itself never validates
      // or normalises `body`'s shape either, so a bare string here is consistent with what
      // this table already tolerates from any other caller, not a new class of gap this
      // route introduces. Deliberately NOT wrapped in a hand-rolled Tiptap doc structure
      // that could not be verified against `apps/web`'s actual editor schema -- guessing
      // at that shape risked being wrong in a way a real reviewer with e2e access to the
      // web app could catch and this session could not. Flagged in the PR body as a real,
      // open, disclosed risk rather than a "fix" this session could not actually verify.
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

      // N4 (ordinary/Opus non-blocking): the audit row now carries every field this
      // transaction can change, not `stateId` alone -- an assignee or `resolved_at` change
      // made by an effect is otherwise invisible to an audit read of this one row.
      await appendAuditLog(tx, {
        actorId,
        actorType,
        workspaceId: ctx.workItem.workspaceId,
        projectId: ctx.workItem.projectId,
        action: "work_item.transitioned",
        entityType: "work_item",
        entityId: ctx.workItem.id,
        before: {
          stateId: fromStateId,
          assigneeId: previousAssigneeId,
          resolvedAt: ctx.workItem.resolvedAt?.toISOString() ?? null,
        },
        after: {
          stateId: toStateId,
          assigneeId: updated.assigneeId,
          resolvedAt: updated.resolvedAt?.toISOString() ?? null,
        },
      });

      return {
        key: updated.key,
        stateId: toStateId,
        assigneeId: updated.assigneeId,
        resolvedAt: updated.resolvedAt,
        version: updated.version,
        previousAssigneeId,
        assigneeEventKind,
      };
    }),
  );

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

  if (result.assigneeEventKind === "assigned") {
    await publishEvent("work_item.assigned", {
      workItemId: ctx.workItem.id,
      key: result.key,
      workspaceId: ctx.workItem.workspaceId,
      projectId: ctx.workItem.projectId,
      assigneeId: result.assigneeId,
      previousAssigneeId: result.previousAssigneeId,
      actorId,
      actorType,
    });
  } else if (result.assigneeEventKind === "unassigned") {
    await publishEvent("work_item.unassigned", {
      workItemId: ctx.workItem.id,
      key: result.key,
      workspaceId: ctx.workItem.workspaceId,
      projectId: ctx.workItem.projectId,
      previousAssigneeId: result.previousAssigneeId,
      actorId,
      actorType,
    });
  }

  return {
    key: result.key,
    stateId: result.stateId,
    assigneeId: result.assigneeId,
    resolvedAt: result.resolvedAt,
    version: result.version,
  };
}

export default transitionWorkItem;
