import { createId } from "@paralleldrive/cuid2";
import {
  asStateTemplateId,
  type BlockReason,
  filterOfferableForType,
  isChangeApprovalEdge,
  isGateSatisfied,
  legalTransitions,
  offerTransition,
  resolveAutomaticEffects,
  resolveEffects,
  resolveStateTemplateForProject,
  type StateGroup,
  type TransitionOfferContext,
  type WorkflowTransition,
} from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { lockApprovalsForWorkItemTransition } from "../../approval/repository";
import { closePendingApprovalsOnTransition } from "../../approval/service";
import { appendAuditLog } from "../../audit/audit-writer";
import { transitionRequiresFields } from "../../custom-field/logic";
import {
  guardFieldValues,
  missingRequiredForTransition,
} from "../../custom-field/repository";
import db from "../../database";
import { slaPauseTable } from "../../database/migration-schema";
import {
  commentTable,
  scheduledTransitionTable,
  stateTable,
  stateTemplateTable,
  workItemSlaCacheTable,
  workItemTable,
  workspaceTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { enqueueOutboxEvent } from "../../events/outbox";
import { resolveWorkItemEventRecipients } from "../../notification/work-item-recipients";
import { resolveProjectDefaultAssignee } from "../../project/default-assignee";
import {
  type ChangeGateBlock,
  changeGateBlocks,
  loadChangeTransitionFacts,
} from "../../service-management/change-repository";
import { serviceCatalogueEnabled } from "../../service-management/common";
import { evaluateStoredWorkItemSla } from "../../sla-policy/evaluation";
import { dbClockUtc } from "../../utils/db-time";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import {
  emitUnblockedAfterClosing,
  hasOpenBlockers,
  lockRelationGraph,
} from "../../work-item-relation/blockers";
import {
  type SystemTransitionOutcome,
  type SystemTransitionRequest,
  setSystemTransitionExecutor,
} from "../../workflow/system-transition";
import { type ActivityActorType, recordWorkItemActivity } from "../activity";
import {
  assertProjectStillLive,
  projectNotDeletedClause,
} from "../assert-work-item-live";
import { resolveAssigneeEligibility } from "../assignee-eligibility";
import { requireCommentPerson } from "../comment-access";
import { ensureImplicitAssigneeWatcher } from "../implicit-watcher";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import { cancelPendingScheduledTransitions } from "../scheduled-transition-cancel";
import {
  loadWorkflowTransitionContext,
  resolveActorRoleIds,
} from "../workflow-transition-context";

export type TransitionWorkItemInput = {
  toStateTemplateId: string;
  note?: string;
  /** Trusted route metadata derived from the authenticated API-key kind. */
  auditOrigin?: "mcp";
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
export type PendingApprovalBlockDetail = {
  approverName: string | null;
  requestedAt: string;
  expiresAt: string;
};

export type TransitionBlockReason =
  | (BlockReason & { pendingApprovals?: PendingApprovalBlockDetail[] })
  // CH-4 / CH-6: a change's CAB-gated approval needs a rollback plan and no active freeze.
  | ChangeGateBlock
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
 * an unsatisfied approval/CAB gate, a missing required note, or an ineligible
 * `set_assignee` target (B2). */
export class TransitionBlockedError extends Error {
  constructor(
    public readonly blockedBy: TransitionBlockReason[],
    message = "This transition is not currently available",
  ) {
    super(message);
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

/** A waiting-customer pause already exists for at least one SLA metric. */
export class SlaPauseConflictError extends Error {
  constructor() {
    super("An SLA pause is already open for this work item");
    this.name = "SlaPauseConflictError";
  }
}

// Same "walk the `cause` chain, never match on a message string" shape as
// `utils/is-unique-violation.ts`/`utils/is-raise-exception.ts` -- for the identical
// reason: Drizzle 0.45.2 does not rethrow the driver's error unchanged, it wraps it in
// its own `DrizzleQueryError` and hangs the real `pg` error off `.cause`, so the real
// SQLSTATE is one or more links down the chain, never on the wrapper's own `.code`
// (confirmed live, third-round Opus delta review of PR #457, D3: the FIRST version of
// this function checked only the top-level `.code`, which is `undefined` on the wrapper
// -- a genuine deadlock still surfaced as an unhandled 500, exactly the bug D2's own fix
// claimed to close but never actually did).
const MAX_CAUSE_DEPTH = 5;

/**
 * `40P01` is Postgres's own `deadlock_detected` SQLSTATE -- narrow, deliberate detection
 * of exactly that one condition, never a catch-all for "any database error."
 */
export function isPostgresDeadlockError(error: unknown): boolean {
  let candidate = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    const { code, cause } = candidate as { code?: unknown; cause?: unknown };

    if (code === "40P01") {
      return true;
    }
    candidate = cause;
  }

  return false;
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

async function runTransactionCatchingSlaPauseConflict<T>(
  currentStateId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await runTransactionCatchingDeadlock(currentStateId, run);
  } catch (error) {
    if (
      isUniqueViolation(error, "sla_pause_one_open_per_work_item_metric_unique")
    ) {
      throw new SlaPauseConflictError();
    }
    throw error;
  }
}

/**
 * `set_assignee`'s `'default'` (`WF-19`, `AS-11`): the project's default assignee, resolved
 * inside the transition's transaction by `resolveProjectDefaultAssignee` (which applies the
 * `AS-5` eligibility rule). When the project has no default, or the default is no longer
 * eligible, the effect changes nothing -- the current assignee is retained, never silently
 * cleared (`AS-8`); `clear_assignee` is the explicit way to unassign.
 */
function resolveSetAssigneePersonId(
  personId: string | "default",
): string | undefined {
  return personId === "default" ? undefined : personId;
}

/**
 * Deterministic most-restrictive-first order for edges sharing a template pair: an
 * approval/CAB gate first, then more guards, then the edge id (never array order).
 */
export function compareEdgeRestrictiveness(
  a: WorkflowTransition,
  b: WorkflowTransition,
): number {
  const score = (t: WorkflowTransition) =>
    (t.requiresApproval || t.requiresCab ? 1000 : 0) + t.guards.length;
  return score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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
 * APPROVAL GATES (AP-5, AP-15, AP-16): while the work item is locked, this route loads
 * the approvals for that item and evaluates only rows whose transition id matches the
 * selected immutable transition. The approval mutation routes take the same work-item
 * lock first, so a decision or withdrawal cannot race the gate between its read and the
 * state write. `requires_cab` evaluates the same policy against CAB approvals only.
 *
 * `pause_sla`/`resume_sla` implement only SLA-10/11's automatic
 * `waiting_customer` lifecycle. Manual pauses and `resolved` pause continuity remain
 * unavailable under the current owner hold; they are not inferred from state groups.
 * `set_field` is held because its field namespace and value rules have not been defined.
 * A stored edge containing it is refused individually; supported sibling edges in a
 * historical mixed version remain usable.
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
  identity: ResolvedIdentity | null,
  personId: string | null,
  actorId: string | null,
  actorType: ActivityActorType,
  input: TransitionWorkItemInput,
  /** `WF-19` / `WF-21`: set only by `executeSystemTransition`; identity/actorId are then null. */
  system?: SystemTransitionRequest,
  /**
   * `AM-3`: set ONLY by the automation `transition` action (`automation/actions-executor.ts`);
   * never reachable from an HTTP schema. The acting role is the rule's effective role instead of
   * a person's memberships, so only edges open to that role (or to any role) are legal. Every
   * other rule is unchanged: the same graph, the most-restrictive-edge ordering, guards,
   * required custom fields, assignee eligibility and concurrency checks apply, and an edge that
   * needs an approval or CAB gate is refused (an automation cannot decide one).
   */
  automationActor?: { roleId: string },
): Promise<TransitionedWorkItem> {
  const ctx = await loadWorkflowTransitionContext(workItemId);
  if (!ctx) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  // A scheduled hop is the stored concrete transition (WF-19): it needs no active version.
  if (!ctx.activeVersion && system?.kind !== "scheduled") {
    throw new NoMatchingTransitionError(
      "This work item's type has no active workflow version",
    );
  }
  const workflowVersionNumber = ctx.activeVersion?.number ?? 0;

  // A system actor bypasses role legality only (WF-21): every edge's role is acceptable.
  const actorRoleIds = system
    ? [...new Set(ctx.transitions.flatMap((t) => (t.roleId ? [t.roleId] : [])))]
    : automationActor
      ? [automationActor.roleId]
      : await resolveActorRoleIds(
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
  if (
    system?.kind === "scheduled" &&
    ctx.workItem.stateId !== system.fromStateId
  ) {
    throw new TransitionConflictError(ctx.workItem.stateId);
  }
  let targetTemplateId = asStateTemplateId(input.toStateTemplateId);
  let scheduledTargetGroup: StateGroup | null = null;
  if (system?.kind === "scheduled") {
    // The row already holds the concrete target state (WF-19: no template lookup to find the
    // hop). Its template is read only to settle automatic effects and to honour any gate the
    // current workflow version happens to place on the same template pair.
    const [target] = await db
      .select({
        stateTemplateId: stateTable.stateTemplateId,
        projectId: stateTable.projectId,
        archivedAt: stateTable.archivedAt,
        group: stateTemplateTable.group,
      })
      .from(stateTable)
      .innerJoin(
        stateTemplateTable,
        eq(stateTable.stateTemplateId, stateTemplateTable.id),
      )
      .where(eq(stateTable.id, system.toStateId))
      .limit(1);
    if (
      !target ||
      target.archivedAt !== null ||
      target.projectId !== ctx.workItem.projectId
    ) {
      throw new NoMatchingTransitionError("The scheduled target state is gone");
    }
    targetTemplateId = asStateTemplateId(target.stateTemplateId);
    scheduledTargetGroup = target.group as StateGroup;
  } else if (system?.kind === "reopen") {
    const reopen = offerable.find((t) => t.isReopen);
    if (!reopen) {
      throw new NoMatchingTransitionError(
        "The active workflow version has no reopen transition from this state",
      );
    }
    targetTemplateId = reopen.toStateTemplateId;
  }
  // `WF-19`: a version may hold several edges for one template pair (different roles, or a
  // null-from "any" edge beside a specific one). A scheduled hop is taken by a system actor
  // for whom every role is acceptable, so ALL of them match; the most restrictive wins and
  // every matching edge's guards must hold, independent of array order.
  const matchingEdges = offerable
    .filter(
      (t) =>
        t.toStateTemplateId === targetTemplateId &&
        (system?.kind !== "reopen" || t.isReopen),
    )
    .sort(compareEdgeRestrictiveness);
  const foundEdge = matchingEdges[0];
  if (!foundEdge && system?.kind !== "scheduled") {
    throw new NoMatchingTransitionError(
      "No transition matches the requested target for this actor from the work item's current state",
    );
  }
  // A scheduled hop with no edge in the current version is still executed (WF-19): it is the
  // stored concrete transition. The inert edge below carries no guards, gates or authored
  // effects; only the automatic WF-17/WF-18 effects of the state groups apply.
  const match: WorkflowTransition = foundEdge ?? {
    id: "",
    fromStateTemplateId: ctx.currentStateTemplateId,
    toStateTemplateId: targetTemplateId,
    roleId: null,
    notePolicy: "none",
    noteVisibility: "internal",
    requiresApproval: false,
    approvalPolicy: null,
    requiresCab: false,
    isReopen: false,
    guards: [],
    effects: [],
  };
  if (match.effects.some((effect) => effect.kind === "set_field")) {
    throw new TransitionBlockedError(
      [],
      "This stored transition contains the unavailable set_field effect",
    );
  }

  const resolution =
    system?.kind === "scheduled"
      ? ({ ok: true, stateId: system.toStateId } as const)
      : resolveStateTemplateForProject(
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

  if (
    (system || automationActor) &&
    (match.requiresApproval || match.requiresCab)
  ) {
    // A system actor or an automation cannot satisfy an approval or CAB gate: fail closed.
    throw new TransitionBlockedError(
      [],
      "A system transition cannot satisfy an approval gate",
    );
  }

  const hasNote =
    typeof input.note === "string" && input.note.trim().length > 0;
  const fromStateId = ctx.workItem.stateId;
  const toStateId = resolution.stateId;
  const toGroup =
    scheduledTargetGroup ??
    ctx.templateGroups.get(match.toStateTemplateId) ??
    ctx.currentGroup;

  const authoredEffects = resolveEffects(match);
  const automaticEffects = resolveAutomaticEffects(ctx.currentGroup, toGroup);

  let assigneeIdPatch: string | null | undefined;
  let assigneeUsesProjectDefault = false;
  const waitingCustomerEffects: ("pause" | "resume")[] = [];
  const scheduleEffects: { afterMinutes: number; toStateTemplateId: string }[] =
    [];
  for (const effect of authoredEffects) {
    if (effect.kind === "set_assignee") {
      assigneeUsesProjectDefault = effect.personId === "default";
      assigneeIdPatch = resolveSetAssigneePersonId(effect.personId);
    } else if (effect.kind === "clear_assignee") {
      assigneeUsesProjectDefault = false;
      assigneeIdPatch = null;
    } else if (effect.kind === "schedule_transition") {
      scheduleEffects.push({
        afterMinutes: effect.afterMinutes,
        toStateTemplateId: effect.toStateTemplateId,
      });
    } else if (effect.kind === "pause_sla") {
      waitingCustomerEffects.push("pause");
    } else if (effect.kind === "resume_sla") {
      waitingCustomerEffects.push("resume");
    }
  }

  let resolvedAtPatch: Date | null | undefined;
  for (const effect of automaticEffects) {
    if (effect.kind === "resolve_sla") {
      resolvedAtPatch = new Date();
    } else if (effect.kind === "reopen_sla") {
      resolvedAtPatch = null;
    }
  }

  const unblockedEvents: Awaited<ReturnType<typeof emitUnblockedAfterClosing>> =
    [];
  const realtimeEvents: {
    kind: string;
    event: Awaited<ReturnType<typeof recordWorkItemEvent>>;
    customerVisible: boolean;
  }[] = [];
  // CH-4 / CH-6 apply to an approving edge of a change (CAB, or a risk-guarded pre-approval)
  // while the service catalogue is on. The flag is read here, before the row locks are taken.
  const changeGatesApply =
    ctx.isChangeType &&
    isChangeApprovalEdge(match) &&
    (await serviceCatalogueEnabled(ctx.workItem.workspaceId));
  const result = await runTransactionCatchingSlaPauseConflict(fromStateId, () =>
    db.transaction(async (tx) => {
      // Workspace state-template writers take this workspace row FOR UPDATE before
      // project/state/item locks. Take the compatible lock before any item lock so a
      // transition cannot introduce a new reference after an in-use preflight.
      const [workspace] = await tx
        .select({ id: workspaceTable.id })
        .from(workspaceTable)
        .where(eq(workspaceTable.id, ctx.workItem.workspaceId))
        .for("share")
        .limit(1);
      if (!workspace)
        throw new HTTPException(404, { message: "Work item not found" });
      await lockRelationGraph(tx, ctx.workItem.workspaceId);
      // B1: lock the row FIRST, before deciding anything guard-shaped. Every fact below is
      // read from THIS locked row, never from `ctx`'s earlier, unlocked read.
      const [locked] = await tx
        .select({
          stateId: workItemTable.stateId,
          assigneeId: workItemTable.assigneeId,
          projectId: workItemTable.projectId,
          deletedAt: workItemTable.deletedAt,
          archivedAt: workItemTable.archivedAt,
        })
        .from(workItemTable)
        .where(eq(workItemTable.id, ctx.workItem.id))
        .for("update");

      // Issue #490: the same TOCTOU class #276/#486/#488 closed elsewhere.
      // `require-work-item-reach.ts` already checked `deletedAt`/`archivedAt` on this same
      // id before this transaction started, but `delete-work-item.ts`'s soft-delete does
      // not bump `version`, so a concurrent soft-delete landing in the window between that
      // check and this locked re-read would otherwise slip through the `stateId` check
      // below unnoticed and transition an item that no longer exists.
      if (
        !locked ||
        locked.stateId !== fromStateId ||
        locked.deletedAt !== null ||
        locked.archivedAt !== null
      ) {
        throw new TransitionConflictError(locked?.stateId ?? fromStateId);
      }

      await assertProjectStillLive(tx, locked.projectId);

      // WF-19: fire the scheduled row exactly once, under the item lock and after the
      // `from_state_id` re-check; losing the claim means another replica already fired it.
      if (system?.kind === "scheduled" && !(await system.claim(tx))) {
        throw new TransitionConflictError(locked.stateId);
      }

      // AS-11 / WF-19: `set_assignee: "default"` resolves against the project's default
      // assignee inside this transaction; none or ineligible leaves the assignee untouched.
      if (assigneeUsesProjectDefault) {
        assigneeIdPatch =
          (await resolveProjectDefaultAssignee(tx, {
            projectId: locked.projectId,
          })) ?? undefined;
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

      // Change detail is read under a share lock so a concurrent edit cannot slip between the
      // guard decision and the state write.
      const changeFacts = await loadChangeTransitionFacts(tx, ctx.workItem.id, {
        lock: true,
      });
      const offerContext: TransitionOfferContext = {
        allChildrenClosed,
        // `field_required`/`change_risk_at_most` fail closed
        // unconditionally -- no schema exists yet to resolve them for real. See
        // `buildGuardContext`'s own doc comment (`../workflow-transition-context.ts`),
        // which the read-only `GET /transitions` feed still uses for these same two
        // constants; kept static here too rather than pulled from a helper that would
        // also re-run its OWN unlocked, redundant children query this function already
        // did correctly, under lock, above.
        hasOpenBlockers: await hasOpenBlockers(ctx.workItem.id, tx),
        // WF-15: `field_required` guards read the real custom field values (`cf.<key>`) and, for a
        // change, the satellite key `change.rollback_plan`; `change_risk_at_most` reads its risk.
        fieldValues: {
          ...(await guardFieldValues(tx, ctx.workItem.id)),
          ...changeFacts.fieldValues,
        },
        changeRiskLevel: changeFacts.risk,
        assigneePresent: locked.assigneeId !== null,
        approvalSatisfied: false,
        cabSatisfied: false,
        hasNote,
      };
      let approvalRows: Awaited<
        ReturnType<typeof lockApprovalsForWorkItemTransition>
      > = [];
      if (match.requiresApproval || match.requiresCab) {
        // The work-item row is already locked FOR UPDATE. Approval mutations take the
        // same parent-first lock, so a concurrent decision/withdrawal cannot change the
        // gate between this read and the transition write.
        approvalRows = await lockApprovalsForWorkItemTransition(
          tx,
          identity as ResolvedIdentity,
          ctx.workItem.id,
          ctx.workItem.workspaceId,
        );
        const approvals = approvalRows.map((row) => ({
          ...row,
          kind: row.kind as "customer" | "cab",
          state: row.state as
            | "pending"
            | "approved"
            | "rejected"
            | "expired"
            | "withdrawn",
        }));
        const approvalPolicy = match.approvalPolicy ?? "any";
        offerContext.approvalSatisfied = match.requiresApproval
          ? isGateSatisfied(approvals, {
              transitionId: match.id,
              policy: approvalPolicy,
            })
          : true;
        offerContext.cabSatisfied = match.requiresCab
          ? isGateSatisfied(approvals, {
              transitionId: match.id,
              kind: "cab",
              policy: approvalPolicy,
            })
          : true;
      }
      const offer =
        system?.kind === "scheduled" && matchingEdges.length > 1
          ? (matchingEdges
              .map((edge) => offerTransition(edge, offerContext))
              .find((candidate) => !candidate.available) ??
            offerTransition(match, offerContext))
          : offerTransition(match, offerContext);
      // CH-4 / CH-6 hold on the CAB-gated approval of a change even when the workflow carries no
      // matching guard. Off unless the service catalogue is enabled for the workspace.
      const changeBlocks: ChangeGateBlock[] = changeGatesApply
        ? await changeGateBlocks(tx, ctx.workItem.workspaceId, changeFacts)
        : [];
      if (!offer.available || changeBlocks.length > 0) {
        const blockedBy: TransitionBlockReason[] = offer.blockedBy.map(
          (reason) => {
            if (reason.kind !== "approval" && reason.kind !== "cab")
              return reason;
            const pendingApprovals = approvalRows
              .filter(
                (row) =>
                  row.transitionId === match.id &&
                  row.state === "pending" &&
                  (reason.kind !== "cab" || row.kind === "cab"),
              )
              .map((row) => ({
                approverName: row.approverName,
                requestedAt: row.createdAt.toISOString(),
                expiresAt: row.expiresAt.toISOString(),
              }));
            return pendingApprovals.length > 0
              ? { ...reason, pendingApprovals }
              : reason;
          },
        );
        throw new TransitionBlockedError([...blockedBy, ...changeBlocks]);
      }

      // CF-4: a required custom field blocks entry to a started/completed state group;
      // `cancelled` is deliberately exempt so incomplete work can always be abandoned.
      if (transitionRequiresFields(toGroup)) {
        const missingFields = await missingRequiredForTransition(tx, {
          id: ctx.workItem.id,
          workspaceId: ctx.workItem.workspaceId,
          typeId: ctx.workItem.typeId,
        });
        if (missingFields.length > 0)
          throw new TransitionBlockedError(
            [{ kind: "guard", reasonCode: "guard.field_required" }],
            `Required custom fields are empty: ${missingFields.join(", ")}`,
          );
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
        if (resolvedAtPatch !== null) {
          const clock = await tx.execute<{ now: string }>(
            sql`SELECT clock_timestamp()::text AS now`,
          );
          const row = clock.rows[0];
          if (!row) throw new Error("Database clock unavailable");
          resolvedAtPatch = new Date(row.now);
        }
        updateValues.resolvedAt = resolvedAtPatch;
      }

      const [updated] = await tx
        .update(workItemTable)
        .set(updateValues)
        .where(
          and(
            eq(workItemTable.id, ctx.workItem.id),
            eq(workItemTable.stateId, fromStateId),
            // Issue #490: belt-and-suspenders with the locked check above, same shape as
            // the `stateId` re-check just above it in this same WHERE.
            isNull(workItemTable.deletedAt),
            isNull(workItemTable.archivedAt),
            // Issue #493's project-freeze gap: the row lock above serialises writers of
            // THIS row, but not a concurrent `UPDATE project SET deleted_at = ...` on the
            // SEPARATE project row -- that write is not blocked by our lock at all. A zero-
            // row result from this clause alone falls into the same `!updated` branch just
            // below as every other reason this WHERE can fail to match, which is exactly
            // this route's own established shape for the `stateId`/`deletedAt`/`archivedAt`
            // re-checks right above.
            projectNotDeletedClause,
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

      for (const effect of waitingCustomerEffects) {
        if (effect === "pause") {
          const startedAt = sql`clock_timestamp()`;
          await tx.insert(slaPauseTable).values([
            {
              workItemId: ctx.workItem.id,
              metric: "first_response",
              startedAt,
              reason: "waiting_customer",
            },
            {
              workItemId: ctx.workItem.id,
              metric: "resolution",
              startedAt,
              reason: "waiting_customer",
            },
          ]);
        } else {
          const endedAt = sql`clock_timestamp()`;
          await tx
            .update(slaPauseTable)
            .set({ endedAt })
            .where(
              and(
                eq(slaPauseTable.workItemId, ctx.workItem.id),
                eq(slaPauseTable.reason, "waiting_customer"),
                isNull(slaPauseTable.endedAt),
              ),
            );
        }
      }

      // SLA-15a: only entry into completed settles outcomes; cache and events commit
      // with the transition while the work-item lock excludes every scanner.
      if (
        ctx.currentGroup !== "completed" &&
        toGroup === "completed" &&
        updated.resolvedAt
      ) {
        const { item: slaItem, metrics } = await evaluateStoredWorkItemSla(
          tx,
          ctx.workItem.id,
          updated.resolvedAt,
        );
        for (const metric of metrics) {
          await tx
            .insert(workItemSlaCacheTable)
            .values({
              workItemId: slaItem.id,
              metric: metric.metric,
              state: metric.state,
              dueAt: metric.dueAt,
              computedAt: updated.resolvedAt,
            })
            .onConflictDoUpdate({
              target: [
                workItemSlaCacheTable.workItemId,
                workItemSlaCacheTable.metric,
              ],
              set: {
                state: metric.state,
                dueAt: metric.dueAt,
                computedAt: updated.resolvedAt,
              },
            });
          if (metric.state !== "met" && metric.state !== "missed") continue;
          const stoppedAt =
            metric.metric === "first_response"
              ? slaItem.firstResponseAt
              : slaItem.resolvedAt;
          await enqueueOutboxEvent(tx, {
            id: createId(),
            kind: metric.state === "met" ? "sla.met" : "sla.missed",
            occurredAt: updated.resolvedAt.toISOString(),
            actor: { type: actorType, id: actorId, name: "TaskDesk actor" },
            scope: {
              workspaceId: slaItem.workspaceId,
              projectId: slaItem.projectId,
            },
            payload: {
              workItemId: slaItem.id,
              key: slaItem.key,
              metric: metric.metric,
              ...(metric.state === "met"
                ? {
                    metAt: stoppedAt?.toISOString() ?? null,
                    marginMinutes: Math.max(
                      0,
                      (metric.targetMinutes ?? 0) - metric.consumedMinutes,
                    ),
                  }
                : {
                    dueAt: metric.dueAt?.toISOString() ?? null,
                    missedByMinutes: Math.max(
                      0,
                      metric.consumedMinutes - (metric.targetMinutes ?? 0),
                    ),
                  }),
            },
            causationId: null,
            depth: 0,
            originAutomationId: null,
          });
        }
      }

      // WF-19 / R4: leaving a state cancels the pending hops waiting in the previous one, in
      // this same transaction, so an A->B->A bounce can never fire a stale row early. The
      // scheduler sweep stays as a safety net.
      await cancelPendingScheduledTransitions(tx, ctx.workItem.id, {
        exceptFromStateId: toStateId,
      });

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
          // Durable record of which edge ran: approvals are single use, so an approval
          // created before this run no longer counts (owner decision 2026-10-10).
          payload: {
            transitionId: match.id === "" ? null : match.id,
            ...(system?.kind === "scheduled" ? { scheduled: true } : {}),
          },
          workflowVersionId: ctx.activeVersion?.id ?? null,
          // The database clock under the work-item lock (see approval `created_at`).
          createdAt: dbClockUtc(),
        },
      ]);
      if (match.requiresApproval || match.requiresCab) {
        // Owner decision 2026-10-10: the run closes the other still-pending approvals.
        await closePendingApprovalsOnTransition(tx, {
          identity: identity as ResolvedIdentity,
          workspaceId: ctx.workItem.workspaceId,
          projectId: ctx.workItem.projectId,
          workItemId: ctx.workItem.id,
          transitionId: match.id,
          actorId,
          actorType,
        });
      }

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
          after: {
            assigneeId: assigneeIdPatch,
            ...(input.auditOrigin ? { origin: input.auditOrigin } : {}),
          },
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
          authorId: requireCommentPerson(
            identity?.personId ? { personId: identity.personId } : null,
          ),
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
          ...(input.auditOrigin ? { origin: input.auditOrigin } : {}),
        },
      });

      const transitionRealtimeEvent = await recordWorkItemEvent(tx, {
        kind: "work_item.transitioned",
        // `WI-28`: unmuted watchers are told about a state change.
        notify: { resolveRecipients: resolveWorkItemEventRecipients },
        workItemId: ctx.workItem.id,
        key: updated.key,
        workspaceId: ctx.workItem.workspaceId,
        projectId: ctx.workItem.projectId,
        actorId,
        actorType,
        customerVisible: true,
        payload: {
          workItemId: ctx.workItem.id,
          key: updated.key,
          url: `/agent/work-items/${encodeURIComponent(updated.key)}`,
          fromStateId,
          toStateId,
          workflowVersion: workflowVersionNumber,
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      });
      realtimeEvents.push({
        kind: "work_item.transitioned",
        event: transitionRealtimeEvent,
        customerVisible: true,
      });
      if (
        assigneeEventKind === "assigned" ||
        assigneeEventKind === "unassigned"
      ) {
        const assigned = assigneeEventKind === "assigned";
        const kind = assigned ? "work_item.assigned" : "work_item.unassigned";
        if (assigned && updated.assigneeId) {
          await ensureImplicitAssigneeWatcher(
            tx,
            ctx.workItem.id,
            updated.assigneeId,
          );
        }
        const event = await recordWorkItemEvent(tx, {
          kind,
          notify: { resolveRecipients: resolveWorkItemEventRecipients },
          workItemId: ctx.workItem.id,
          key: updated.key,
          workspaceId: ctx.workItem.workspaceId,
          projectId: ctx.workItem.projectId,
          actorId,
          actorType,
          customerVisible: true,
          payload: {
            workItemId: ctx.workItem.id,
            key: updated.key,
            url: `/agent/work-items/${encodeURIComponent(updated.key)}`,
            ...(assigned ? { assigneeId: updated.assigneeId } : {}),
            previousAssigneeId: previousAssigneeId ?? null,
          },
        });
        realtimeEvents.push({ kind, event, customerVisible: true });
      }

      if (
        ctx.currentGroup !== "completed" &&
        ctx.currentGroup !== "cancelled" &&
        (toGroup === "completed" || toGroup === "cancelled")
      ) {
        unblockedEvents.push(
          ...(await emitUnblockedAfterClosing(tx, {
            blockerId: ctx.workItem.id,
            actorId,
            actorType,
          })),
        );
      }

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
    workflowVersion: workflowVersionNumber,
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

  for (const { item, event } of unblockedEvents) {
    await publishWorkItemHint(event, {
      kind: "work_item.unblocked",
      key: item.key,
      projectId: item.projectId,
      customerVisible: false,
    });
  }

  for (const realtimeEvent of realtimeEvents) {
    await publishWorkItemHint(realtimeEvent.event, {
      kind: realtimeEvent.kind as `work_item.${string}`,
      key: result.key,
      projectId: ctx.workItem.projectId,
      customerVisible: realtimeEvent.customerVisible,
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

/**
 * `WF-19` / `WF-21` system-actor entry point (the port in `workflow/system-transition.ts`).
 * Runs the very same transaction as a person's transition, as `system` with no identity.
 */
export async function executeSystemTransition(
  request: SystemTransitionRequest,
): Promise<SystemTransitionOutcome> {
  try {
    await transitionWorkItem(
      request.workItemId,
      null,
      null,
      null,
      "system",
      { toStateTemplateId: "" },
      request,
    );
    return { kind: "applied" };
  } catch (error) {
    if (error instanceof TransitionConflictError) return { kind: "left_state" };
    if (error instanceof NoMatchingTransitionError)
      return request.kind === "reopen"
        ? { kind: "none" }
        : { kind: "blocked", reason: "target_unavailable" };
    if (error instanceof TransitionBlockedError)
      return {
        kind: "blocked",
        reason: error.blockedBy[0]
          ? `${error.blockedBy[0].kind}`
          : "guard_or_gate",
      };
    if (error instanceof HTTPException) return { kind: "unavailable" };
    if (error instanceof SlaPauseConflictError)
      return { kind: "blocked", reason: "sla_pause_conflict" };
    throw error;
  }
}

setSystemTransitionExecutor(executeSystemTransition);

export default transitionWorkItem;
