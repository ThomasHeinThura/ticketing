import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import {
  automationRunTable,
  automationTable,
  outboxTable,
} from "../database/schema";
import { guardAutomationTrigger } from "../events/automation-context";
import { parseParentEnvelope } from "../events/outbox-consumer";
import { fenceLegalHolds } from "../scheduler/soft-delete-purge.repository";
import { scopedRowUnderOpenHold } from "../utils/legal-hold-scope";
import type { InternalEnvelope } from "../webhook/envelope";
import {
  type AutomationAction,
  BUILTIN_ACTION_TYPES,
  parseAction,
} from "./actions";
import {
  ACTION_ERRORS,
  type ActionResult,
  executeAction,
} from "./actions-executor";
import { type AutomationCondition, evaluateConditions } from "./conditions";
import {
  AUTOMATION_RUN_LEASE_MS,
  AUTOMATION_RUN_RETENTION_DAYS,
} from "./constants";
import { emitRunFailed } from "./consumer";
import {
  type EffectiveRole,
  loadRole,
  roleIsUsableForWorkspace,
} from "./effective-role";
import { eventFacts, loadWorkItemsByKey } from "./facts";
import { automationsEnabled } from "./feature";
import type { AutomationRow } from "./repository";

/**
 * The automation run executor (`AM-2`..`AM-8`). One call claims **one event's** pending runs
 * (every rule that matched that event) and executes them in `automation.position` order
 * (`AM-6`), stopping the group when a matched rule is marked `stop_processing`.
 *
 * Claiming is a short transaction that moves the runs to `running` with a lease, under a
 * transaction-scoped advisory lock on the event id so two replicas never split a group and
 * break the ordering. Actions then commit on their own connections (they are the same domain
 * code a person's request runs), which is why a `running` run whose lease expires is marked
 * `abandoned` and is **never re-run**: its actions may already have committed, and executing
 * them twice would be the "silently starts changing hundreds of items" failure the contract
 * names as the worst outcome.
 */

type ClaimedRun = typeof automationRunTable.$inferSelect;

export async function claimNextAutomationEvent(): Promise<ClaimedRun[]> {
  return db.transaction(async (tx) => {
    const candidates = await tx.execute<{
      event_id: string | null;
      id: string;
    }>(sql`
      SELECT "event_id", "id" FROM "automation_run"
      WHERE "state" = 'pending'
      ORDER BY "triggered_at" ASC, "id" ASC
      LIMIT 25
    `);
    const seen = new Set<string>();
    for (const candidate of candidates.rows) {
      const group = candidate.event_id ?? `run:${candidate.id}`;
      if (seen.has(group)) continue;
      seen.add(group);
      const lock = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${`automation-run:${group}`})) AS locked`,
      );
      if (!lock.rows[0]?.locked) continue;
      const claimed = await tx
        .update(automationRunTable)
        .set({
          state: "running",
          leaseExpiresAt: sql`now() + make_interval(secs => ${AUTOMATION_RUN_LEASE_MS / 1000}::float8)`,
        })
        .where(
          and(
            candidate.event_id
              ? eq(automationRunTable.eventId, candidate.event_id)
              : eq(automationRunTable.id, candidate.id),
            eq(automationRunTable.state, "pending"),
          ),
        )
        .returning();
      if (claimed.length > 0)
        return claimed.sort(
          (a, b) => a.position - b.position || a.id.localeCompare(b.id),
        );
    }
    return [];
  });
}

/** A `running` run past its lease is abandoned, never re-run (see the file comment). */
export async function abandonStaleRuns(): Promise<number> {
  const abandoned = await db
    .update(automationRunTable)
    .set({
      state: "abandoned",
      error: "interrupted: the worker stopped before this run finished",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(automationRunTable.state, "running"),
        sql`${automationRunTable.leaseExpiresAt} < now()`,
      ),
    )
    .returning({ id: automationRunTable.id });
  return abandoned.length;
}

function instanceUrl(): string {
  return (process.env.TASKDESK_AGENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

async function loadEnvelope(eventId: string) {
  const [row] = await db
    .select({
      eventId: outboxTable.eventId,
      kind: outboxTable.kind,
      payload: outboxTable.payload,
    })
    .from(outboxTable)
    .where(eq(outboxTable.eventId, eventId))
    .limit(1);
  if (!row) return undefined;
  try {
    return parseParentEnvelope(row) as unknown as InternalEnvelope & {
      depth: number;
      originAutomationId: string | null;
    };
  } catch {
    return undefined;
  }
}

async function finishRun(
  run: ClaimedRun,
  patch: Partial<typeof automationRunTable.$inferInsert>,
) {
  await db
    .update(automationRunTable)
    .set({ ...patch, leaseExpiresAt: null, finishedAt: new Date() })
    .where(
      and(
        eq(automationRunTable.id, run.id),
        eq(automationRunTable.state, "running"),
      ),
    );
}

const AVAILABLE: ReadonlySet<string> = new Set(BUILTIN_ACTION_TYPES);

export type RunOutcome = {
  state: "done" | "failed" | "skipped";
  matched: boolean | null;
  stopGroup: boolean;
};

/** Executes one claimed run. Never throws: every outcome is recorded on the run. */
export async function executeRun(run: ClaimedRun): Promise<RunOutcome> {
  const [rule] = await db
    .select()
    .from(automationTable)
    .where(eq(automationTable.id, run.automationId))
    .limit(1);
  if (!rule || !rule.enabled) {
    await finishRun(run, { state: "skipped", error: "rule_disabled" });
    return { state: "skipped", matched: null, stopGroup: false };
  }
  if (!(await automationsEnabled(rule.workspaceId, rule.projectId))) {
    await finishRun(run, { state: "skipped", error: "feature_disabled" });
    return { state: "skipped", matched: null, stopGroup: false };
  }
  if (!run.eventId) {
    await finishRun(run, { state: "skipped", error: "no_event" });
    return { state: "skipped", matched: null, stopGroup: false };
  }
  const envelope = await loadEnvelope(run.eventId);
  if (!envelope) {
    await finishRun(run, { state: "failed", error: "event_unavailable" });
    return { state: "failed", matched: null, stopGroup: false };
  }

  // The consumer already guarded the trigger; re-check at execution, which is cheap and covers a
  // rule re-enabled between the two.
  const guard = guardAutomationTrigger({
    automationId: rule.id,
    eventDepth: envelope.depth,
    eventOriginAutomationId: envelope.originAutomationId,
  });
  if (guard !== "ok") {
    await finishRun(run, {
      state: guard === "self_origin" ? "skipped" : "failed",
      error: guard === "self_origin" ? "self_origin" : "loop_depth_limit",
    });
    return {
      state: guard === "self_origin" ? "skipped" : "failed",
      matched: null,
      stopGroup: false,
    };
  }

  const role = await loadRole(rule.effectiveRoleId);
  if (!role || !roleIsUsableForWorkspace(role, rule.workspaceId)) {
    await flagRule(rule.id, "effective_role_unavailable", true);
    await finishRun(run, {
      state: "failed",
      error: "effective_role_unavailable",
    });
    return { state: "failed", matched: null, stopGroup: false };
  }

  const key =
    typeof envelope.payload.key === "string" ? envelope.payload.key : null;
  const loadItem = async () =>
    key
      ? ((await loadWorkItemsByKey(rule.workspaceId, [key])).get(key) ?? null)
      : null;
  const item = await loadItem();

  const conditions = (
    Array.isArray(rule.conditions) ? rule.conditions : []
  ) as AutomationCondition[];
  const evaluation = evaluateConditions(conditions, {
    now: new Date(),
    ...(item ? { workItem: item.facts } : {}),
    ...eventFacts(envelope.kind, envelope.payload),
  });
  if (!evaluation.matched) {
    await finishRun(run, {
      state: "done",
      matched: false,
      results: evaluation.results,
    });
    return { state: "done", matched: false, stopGroup: false };
  }

  const actions: AutomationAction[] = [];
  for (const [index, raw] of (Array.isArray(rule.actions)
    ? rule.actions
    : []
  ).entries()) {
    const parsed = parseAction(raw, index, AVAILABLE);
    if (parsed.ok) actions.push(parsed.action);
  }

  const results: ActionResult[] = [];
  for (const [index, action] of actions.entries()) {
    results.push(
      await executeAction(action, index, {
        automation: {
          id: rule.id,
          name: rule.name,
          workspaceId: rule.workspaceId,
          projectId: rule.projectId,
        },
        role: role as EffectiveRole,
        envelope,
        loadItem,
        instance: instanceUrl(),
      }),
    );
  }

  const failures = results.filter((entry) => !entry.ok);
  await recordRuleOutcome(rule, results);
  await finishRun(run, {
    state: failures.length > 0 ? "failed" : "done",
    matched: true,
    results,
    error:
      failures.length > 0
        ? failures
            .map((entry) => `${entry.type}: ${entry.error ?? "failed"}`)
            .join("; ")
            .slice(0, 500)
        : null,
  });
  if (failures.length > 0) {
    await db.transaction((tx) =>
      emitRunFailed(tx, {
        automationId: rule.id,
        workspaceId: rule.workspaceId,
        projectId: rule.projectId,
        runId: run.id,
        error: failures
          .map((entry) => `${entry.type}: ${entry.error ?? "failed"}`)
          .join("; ")
          .slice(0, 500),
      }),
    );
  }
  return {
    state: failures.length > 0 ? "failed" : "done",
    matched: true,
    stopGroup: rule.stopProcessing,
  };
}

async function flagRule(ruleId: string, reason: string, disable: boolean) {
  await db
    .update(automationTable)
    .set({
      flaggedReason: reason,
      ...(disable ? { enabled: false } : {}),
      updatedAt: new Date(),
    })
    .where(eq(automationTable.id, ruleId));
}

/** Fire count, last run, and the contract's auto-flag rules for a matched run. */
async function recordRuleOutcome(
  rule: AutomationRow,
  results: readonly ActionResult[],
) {
  const lost = results.some(
    (entry) => entry.error === ACTION_ERRORS.roleLacksCapability,
  );
  // "Rule references a deleted label or state: the rule is auto-disabled and flagged."
  const dangling = results.some((entry) => entry.error === "Label unavailable");
  await db
    .update(automationTable)
    .set({
      fireCount: sql`${automationTable.fireCount} + 1`,
      lastRunAt: new Date(),
      ...(dangling
        ? { enabled: false, flaggedReason: "references_deleted_label" }
        : lost
          ? { flaggedReason: "effective_role_lost_capability" }
          : {}),
    })
    .where(eq(automationTable.id, rule.id));
}

export type AutomationDrainResult =
  | { kind: "idle" }
  | { kind: "ran"; runs: number };

/** Claims and executes one event's group of runs. */
export async function processNextAutomationEvent(): Promise<AutomationDrainResult> {
  const group = await claimNextAutomationEvent();
  if (group.length === 0) return { kind: "idle" };
  let stopped = false;
  for (const run of group) {
    if (stopped) {
      await finishRun(run, {
        state: "skipped",
        error: "stopped_by_earlier_rule",
      });
      continue;
    }
    const outcome = await executeRun(run);
    if (outcome.matched === true && outcome.stopGroup) stopped = true;
  }
  return { kind: "ran", runs: group.length };
}

export const AUTOMATION_DRAIN_LIMIT = 25;
export const AUTOMATION_DRAIN_BUDGET_MS = 5_000;

/** The `outbox-drain` automation step, bounded by count and wall-clock. */
export async function drainAutomationRuns() {
  let events = 0;
  let runs = 0;
  let degraded = false;
  const started = Date.now();
  try {
    await abandonStaleRuns();
  } catch {
    degraded = true;
  }
  while (
    events < AUTOMATION_DRAIN_LIMIT &&
    Date.now() - started < AUTOMATION_DRAIN_BUDGET_MS
  ) {
    try {
      const result = await processNextAutomationEvent();
      if (result.kind === "idle") break;
      events++;
      runs += result.runs;
    } catch {
      degraded = true;
      break;
    }
  }
  try {
    await purgeExpiredAutomationRunsOpportunistically();
  } catch {
    degraded = true;
  }
  return { events, runs, degraded };
}

let lastPurgeAt = 0;

export async function purgeExpiredAutomationRunsOpportunistically(
  nowMs = Date.now(),
): Promise<number> {
  if (nowMs - lastPurgeAt < 3_600_000) return 0;
  lastPurgeAt = nowMs;
  return purgeExpiredAutomationRuns(new Date(nowMs));
}

/** `AM-8`: `automation_run` rows are retained 30 days. */
export async function purgeExpiredAutomationRuns(now: Date): Promise<number> {
  const cutoff = new Date(
    now.getTime() - AUTOMATION_RUN_RETENTION_DAYS * 86_400_000,
  );
  // Retention obeys legal holds (see purgeExpiredWebhookDeliveries).
  const deleted = await db.transaction(async (tx) => {
    await fenceLegalHolds(tx);
    return tx
      .delete(automationRunTable)
      .where(
        and(
          sql`${automationRunTable.triggeredAt} < ${cutoff}`,
          sql`${automationRunTable.state} <> 'pending'`,
          sql`${automationRunTable.state} <> 'running'`,
          sql`NOT ${scopedRowUnderOpenHold({
            workspaceId: sql`${automationRunTable.workspaceId}`,
            projectId: sql`${automationRunTable.projectId}`,
            workItemId: sql`${automationRunTable.workItemId}`,
          })}`,
        ),
      )
      .returning({ id: automationRunTable.id });
  });
  return deleted.length;
}
