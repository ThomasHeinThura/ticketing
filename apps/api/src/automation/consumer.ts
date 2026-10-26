import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Executor, Transaction } from "../database/executor";
import {
  automationRunTable,
  automationTable,
  projectTable,
} from "../database/schema";
import {
  AUTOMATION_MAX_DEPTH,
  guardAutomationTrigger,
} from "../events/automation-context";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import type {
  ParentEventConsumer,
  ParentEventEnvelope,
} from "../events/outbox-consumer";
import { isAutomationEventTrigger, triggerCarriesWorkItem } from "./constants";
import { automationsEnabled } from "./feature";

/**
 * The automation parent-event consumer (`AM-2`: rules run **after** the triggering change is
 * committed, from the event bus, and never block the request).
 *
 * Like the webhook consumer it runs inside the outbox claim transaction and so performs no
 * action itself: it records one `pending` `automation_run` per matching enabled rule, in
 * `automation.position` order, and `processNextAutomationRun` (`./executor.ts`) executes them.
 * `automation_run_event_unique` (`automation_id`, `event_id`) makes a re-drained parent a no-op
 * (`EV-2`).
 *
 * Loop protection (`EV-3`, `AM-5`) is decided here, before a run exists:
 * - an event whose `originAutomationId` is this rule is the rule's own doing and is skipped
 *   silently;
 * - an event at `depth >= 5` abandons the chain: no action runs, a `failed` run records the
 *   error on the rule, and the rule is flagged.
 */

export function eventProjectId(envelope: ParentEventEnvelope): string | null {
  const scope = envelope.scope as { projectId?: string };
  return typeof scope.projectId === "string" ? scope.projectId : null;
}

async function automationUrl(
  executor: Executor,
  rule: { projectId: string | null },
): Promise<string> {
  if (!rule.projectId) return "/agent/settings/automations";
  const [project] = await executor
    .select({ slug: projectTable.slug })
    .from(projectTable)
    .where(eq(projectTable.id, rule.projectId))
    .limit(1);
  return project
    ? `/agent/projects/${encodeURIComponent(project.slug)}/settings/automations`
    : "/agent/settings/automations";
}

/** `automation.run_failed` (events.md): an action threw, or the loop guard abandoned a chain. */
export async function emitRunFailed(
  tx: Executor,
  input: {
    automationId: string;
    workspaceId: string;
    projectId: string | null;
    organisationId?: string | null;
    runId: string;
    error: string;
  },
): Promise<void> {
  await enqueueOutboxEvent(tx as unknown as Transaction, {
    id: `evt_${createId()}`,
    kind: "automation.run_failed",
    occurredAt: new Date().toISOString(),
    actor: { type: "system", id: null, name: "TaskDesk" },
    scope: eventScope({
      workspaceId: input.workspaceId,
      organisationId: input.organisationId ?? null,
      projectId: input.projectId,
    }),
    payload: {
      key: input.automationId,
      url: await automationUrl(tx, input),
      automationId: input.automationId,
      runId: input.runId,
      error: input.error,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
}

/**
 * "Recursive rule pair: depth cap at 5, chain abandoned, error surfaced on **both** rules." The
 * rule that would have fired is flagged by the caller; the rule whose action produced this event
 * is the other half of the pair and gets the same flag and a failed run of its own, so the loop
 * shows in both histories.
 */
async function surfaceLoopOnOrigin(
  tx: Transaction,
  envelope: ParentEventEnvelope,
  workspaceId: string,
  projectId: string | null,
  firedRuleId: string,
) {
  const originId = envelope.originAutomationId;
  if (!originId || originId === firedRuleId) return;
  const [origin] = await tx
    .select({
      id: automationTable.id,
      position: automationTable.position,
    })
    .from(automationTable)
    .where(
      and(
        eq(automationTable.id, originId),
        eq(automationTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!origin) return;
  await tx
    .update(automationTable)
    .set({ flaggedReason: "loop_depth_limit" })
    .where(eq(automationTable.id, origin.id));
  await tx
    .insert(automationRunTable)
    .values({
      automationId: origin.id,
      workspaceId,
      projectId,
      eventId: envelope.id,
      origin: "event",
      position: origin.position,
      depth: envelope.depth,
      state: "failed",
      matched: null,
      error: `loop_depth_limit: this rule's action started a chain that was abandoned at depth ${AUTOMATION_MAX_DEPTH}`,
      finishedAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function enqueueAutomationRuns(
  tx: Transaction,
  envelope: ParentEventEnvelope,
): Promise<number> {
  // Configuration corruption must not promote compatibility keys into triggers.
  if (!isAutomationEventTrigger(envelope.kind)) return 0;
  const scope = envelope.scope as {
    workspaceId?: string;
    organisationId?: string;
  };
  if (!scope.workspaceId) return 0;
  const workspaceId = scope.workspaceId;
  const projectId = eventProjectId(envelope);

  const projectScope = projectId
    ? or(
        eq(automationTable.projectId, projectId),
        and(
          isNull(automationTable.projectId),
          or(
            isNull(automationTable.projectFilter),
            sql`${automationTable.projectFilter} @> to_jsonb(${projectId}::text)`,
          ),
        ),
      )
    : and(
        isNull(automationTable.projectId),
        isNull(automationTable.projectFilter),
      );

  const rules = await tx
    .select({
      id: automationTable.id,
      projectId: automationTable.projectId,
      position: automationTable.position,
    })
    .from(automationTable)
    .where(
      and(
        eq(automationTable.workspaceId, workspaceId),
        eq(automationTable.enabled, true),
        eq(automationTable.trigger, envelope.kind),
        projectScope,
      ),
    )
    .orderBy(asc(automationTable.position), asc(automationTable.id));
  if (rules.length === 0) return 0;

  const payload = envelope.payload as Record<string, unknown>;
  const key =
    triggerCarriesWorkItem(envelope.kind) && typeof payload.key === "string"
      ? payload.key
      : null;
  const workItemId =
    typeof payload.workItemId === "string" ? payload.workItemId : null;

  const flagCache = new Map<string, boolean>();
  let created = 0;
  for (const rule of rules) {
    const flagKey = rule.projectId ?? "";
    let enabled = flagCache.get(flagKey);
    if (enabled === undefined) {
      enabled = await automationsEnabled(workspaceId, rule.projectId);
      flagCache.set(flagKey, enabled);
    }
    if (!enabled) continue;

    const guard = guardAutomationTrigger({
      automationId: rule.id,
      eventDepth: envelope.depth,
      eventOriginAutomationId: envelope.originAutomationId,
    });
    if (guard === "self_origin") continue;

    const runId = createId();
    if (guard === "depth_exceeded") {
      const [run] = await tx
        .insert(automationRunTable)
        .values({
          id: runId,
          automationId: rule.id,
          workspaceId,
          workItemId,
          workItemKey: key,
          projectId,
          eventId: envelope.id,
          origin: "event",
          position: rule.position,
          depth: envelope.depth,
          state: "failed",
          matched: null,
          error: `loop_depth_limit: chain abandoned at depth ${AUTOMATION_MAX_DEPTH}`,
          finishedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: automationRunTable.id });
      if (run) {
        await tx
          .update(automationTable)
          .set({ flaggedReason: "loop_depth_limit" })
          .where(eq(automationTable.id, rule.id));
        await emitRunFailed(tx, {
          automationId: rule.id,
          workspaceId,
          projectId: rule.projectId,
          organisationId: scope.organisationId ?? null,
          runId,
          error: "loop_depth_limit",
        });
        await surfaceLoopOnOrigin(
          tx,
          envelope,
          workspaceId,
          projectId,
          rule.id,
        );
        created++;
      }
      continue;
    }

    const [run] = await tx
      .insert(automationRunTable)
      .values({
        id: runId,
        automationId: rule.id,
        workspaceId,
        workItemId,
        workItemKey: key,
        projectId,
        eventId: envelope.id,
        origin: "event",
        position: rule.position,
        depth: envelope.depth,
        state: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: automationRunTable.id });
    if (run) created++;
  }
  return created;
}

export const automationParentConsumer: ParentEventConsumer = {
  name: "automation",
  handles: (kind) => isAutomationEventTrigger(kind),
  async handle(tx, envelope) {
    await enqueueAutomationRuns(tx, envelope);
  },
};
