import {
  advanceEscalation,
  escalationStopReason,
  startEscalation,
} from "@taskdesk/domain";
import db from "../database";
import type { Transaction } from "../database/executor";
import type { DomainEventEnvelope } from "../events/outbox";
import { logTaskDesk } from "../instance/observability/runtime";
import {
  enqueueNotificationEvent,
  materializeNotificationFanout,
} from "../notification/fanout";
import { listProjectStakeholders } from "../notification/repository";
import { slaEventRecipientResolver } from "../notification/sla-recipients";
import {
  advanceEscalationWalk,
  claimDueEscalationWalk,
  type EscalationWalkRow,
  insertEscalationWalk,
  loadEscalationItemFacts,
  loadTriggerEnvelope,
  stopEscalationWalk,
} from "./sla-escalation.repository";

/**
 * SLA-16 / SLA-17 / NO-22.
 *
 * `enqueueSlaEvent` is the producer seam `sla-scan` uses for `sla.at_risk` / `sla.breached`:
 * the outbox row and the inbox/delivery fan-out are written in the scan's own transaction
 * (`EV-1`), never by a parent consumer that would have to re-materialise them. A breach also
 * starts the escalation walk: the first stakeholder on the project's path is notified in that
 * same fan-out ("notify the first immediately") and the walk row records when the next one is
 * due. `advanceDueEscalations` is the `reminder-scan` step that notifies each next stakeholder
 * after the previous one's `escalation_wait_minutes`, while the item is still in the
 * triggering condition. A project without active stakeholders gets no walk and notifies no one
 * beyond the assignee and leads (SLA-17: a no-op, not an error).
 */

export type SlaEventContext = {
  workItem: { id: string; stateId: string; assigneeId: string | null };
  workspaceId: string;
  projectId: string;
  metric: string;
  now: Date;
};

export async function enqueueSlaEvent(
  tx: Transaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
  context: SlaEventContext,
): Promise<void> {
  if (event.kind !== "sla.breached") {
    await enqueueNotificationEvent(tx, event, {
      resolveRecipients: slaEventRecipientResolver({}),
    });
    return;
  }
  const step = startEscalation(
    await listProjectStakeholders(tx, context.projectId),
    context.now,
  );
  await enqueueNotificationEvent(tx, event, {
    resolveRecipients: slaEventRecipientResolver({
      escalationPersonIds: step ? step.notify.map((s) => s.personId) : [],
    }),
  });
  if (!step) return;
  await insertEscalationWalk(tx, {
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    workItemId: context.workItem.id,
    metric: context.metric,
    triggerEventId: event.id,
    stateIdAtStart: context.workItem.stateId,
    assigneeIdAtStart: context.workItem.assigneeId,
    lastOrder: step.order,
    nextDueAt: step.nextDueAt,
    startedAt: context.now,
  });
}

export type EscalationOutcome = {
  advanced: number;
  stopped: number;
  completed: number;
  degraded: boolean;
};

const MAX_WALKS_PER_RUN = 500;

function asEnvelope(
  value: unknown,
  eventId: string,
): DomainEventEnvelope<Record<string, unknown>> | null {
  const envelope = value as Partial<
    DomainEventEnvelope<Record<string, unknown>>
  >;
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.id !== eventId ||
    envelope.kind !== "sla.breached" ||
    !envelope.scope ||
    typeof envelope.payload !== "object"
  )
    return null;
  return envelope as DomainEventEnvelope<Record<string, unknown>>;
}

type StepResult = "advanced" | "stopped" | "completed" | "idle";

class WalkFailure extends Error {
  constructor(
    readonly walkId: string,
    cause: unknown,
  ) {
    super("SLA escalation step failed", { cause });
    this.name = "WalkFailure";
  }
}

/**
 * Advances one due walk in its own transaction, so a failure never blocks the others: the
 * failed walk id is returned to the caller, which skips it for the rest of the run and leaves
 * the row untouched (it is retried on the next run).
 */
async function advanceOneWalk(skip: readonly string[]): Promise<StepResult> {
  return db.transaction(async (tx): Promise<StepResult> => {
    const walk = await claimDueEscalationWalk(tx, skip);
    if (!walk) return "idle";
    try {
      return await advanceClaimedWalk(tx, walk);
    } catch (cause) {
      throw new WalkFailure(walk.id, cause);
    }
  });
}

async function advanceClaimedWalk(
  tx: Transaction,
  walk: EscalationWalkRow,
): Promise<StepResult> {
  const now = new Date();
  const facts = await loadEscalationItemFacts(tx, walk);
  if (!facts?.available) {
    await stopEscalationWalk(tx, walk.id, "work_item_unavailable");
    return "stopped";
  }
  const stop = escalationStopReason({
    stillBreached: facts.metricState === "breached",
    resolved: facts.resolvedAt !== null,
    stateIdAtStart: walk.stateIdAtStart,
    currentStateId: facts.stateId,
    assigneeIdAtStart: walk.assigneeIdAtStart,
    currentAssigneeId: facts.assigneeId,
    staffCommentedSinceStart: facts.staffCommentedSinceStart,
  });
  if (stop) {
    await stopEscalationWalk(tx, walk.id, stop);
    return "stopped";
  }
  const step = advanceEscalation(
    await listProjectStakeholders(tx, walk.projectId),
    walk.lastOrder,
    now,
  );
  if (!step) {
    await advanceEscalationWalk(tx, walk.id, {
      lastOrder: null,
      nextDueAt: null,
    });
    return "completed";
  }
  const envelope = asEnvelope(
    await loadTriggerEnvelope(tx, walk),
    walk.triggerEventId,
  );
  if (!envelope) {
    // Retention purged the breach event (or it is corrupt): the walk cannot be anchored.
    await stopEscalationWalk(tx, walk.id, "trigger_event_unavailable");
    return "stopped";
  }
  // Keyed on the breach event id: `(event_id, person_id)` makes the stakeholder's row
  // idempotent, and a stakeholder already notified as assignee/lead is not told twice.
  await materializeNotificationFanout(tx, envelope, {
    resolveRecipients: slaEventRecipientResolver({
      escalationPersonIds: step.notify.map((s) => s.personId),
      onlyEscalation: true,
    }),
  });
  await advanceEscalationWalk(tx, walk.id, {
    lastOrder: step.order,
    nextDueAt: step.nextDueAt,
  });
  return step.nextDueAt ? "advanced" : "completed";
}

/** `reminder-scan`'s NO-22 step. Bounded; a failing walk marks the run degraded and is retried. */
export async function advanceDueEscalations(): Promise<EscalationOutcome> {
  const outcome: EscalationOutcome = {
    advanced: 0,
    stopped: 0,
    completed: 0,
    degraded: false,
  };
  const failed: string[] = [];
  for (let i = 0; i < MAX_WALKS_PER_RUN; i++) {
    let result: StepResult;
    try {
      result = await advanceOneWalk(failed);
    } catch (error) {
      outcome.degraded = true;
      if (error instanceof WalkFailure) failed.push(error.walkId);
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "error",
        result: "degraded",
      });
      if (!(error instanceof WalkFailure)) break;
      continue;
    }
    if (result === "idle") break;
    if (result === "advanced") outcome.advanced++;
    else if (result === "stopped") outcome.stopped++;
    else outcome.completed++;
  }
  return outcome;
}
