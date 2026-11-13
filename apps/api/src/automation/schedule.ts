import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import db from "../database";
import {
  automationRunTable,
  automationTable,
  projectTable,
  stateTable,
  stateTemplateTable,
  workItemTable,
} from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { type AutomationCondition, evaluateConditions } from "./conditions";
import { loadWorkItemsByKey, resolvedEntrySql } from "./facts";
import { automationsEnabled } from "./feature";
import { scheduleOccurrence } from "./schedule-occurrence";

export { scheduleOccurrence } from "./schedule-occurrence";

export const AUTOMATION_SCHEDULE_JOB = "automation-schedule";
export const SCHEDULE_BATCH = 50;

export function scheduleDue(pattern: string, now: Date, last?: Date): boolean {
  const occurrence = scheduleOccurrence(pattern, now);
  return occurrence !== null && (!last || occurrence > last);
}
export const SCHEDULE_PENDING_CAP = 50;
export const SCHEDULE_RETRY_MS = 24 * 60 * 60 * 1000;

/** Persist a sweep cursor in a schedule run with no item; candidates use ordinary run rows.
 * The per-rule transaction lock fences cursor advances even if the outer job lease expires.
 * Candidate insert and cursor advance commit together; the existing run claim fences actions.
 */
async function scanRule(ruleId: string, now: Date): Promise<number> {
  return withJobLease(
    `automation:${ruleId}`,
    () =>
      db.transaction(async (tx) => {
        const lock = await tx.execute<{ locked: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtext(${`automation-schedule:${ruleId}`})) AS locked`,
        );
        if (!lock.rows[0]?.locked) return 0;
        const [rule] = await tx
          .select()
          .from(automationTable)
          .where(
            and(
              eq(automationTable.id, ruleId),
              eq(automationTable.enabled, true),
              eq(automationTable.trigger, "schedule"),
            ),
          )
          .for("update")
          .limit(1);
        if (
          !rule?.scheduleCron ||
          !(await automationsEnabled(rule.workspaceId, rule.projectId))
        )
          return 0;
        let [sweep] = await tx
          .select()
          .from(automationRunTable)
          .where(
            and(
              eq(automationRunTable.id, `schedule-progress:${rule.id}`),
              eq(automationRunTable.workspaceId, rule.workspaceId),
            ),
          )
          .limit(1);
        if (!scheduleOccurrence(rule.scheduleCron, now)) {
          await tx
            .insert(automationRunTable)
            .values({
              id: `schedule-progress:${rule.id}`,
              automationId: rule.id,
              workspaceId: rule.workspaceId,
              projectId: rule.projectId,
              origin: "schedule",
              state: "skipped",
              finishedAt: now,
              error: "schedule_occurrence_unavailable",
              results: [],
            })
            .onConflictDoUpdate({
              target: automationRunTable.id,
              set: {
                state: "skipped",
                finishedAt: now,
                error: "schedule_occurrence_unavailable",
                results: [],
              },
            });
          return 0;
        }
        let cursor = "";
        const progress = (
          Array.isArray(sweep?.results) ? sweep.results[0] : undefined
        ) as
          | {
              cursor?: string;
              complete?: boolean;
              version?: number;
              occurrence?: string;
              candidates?: number;
            }
          | undefined;
        if (
          sweep &&
          progress?.complete === false &&
          progress.version === rule.version
        )
          cursor = progress.cursor ?? "";
        else {
          if (
            !scheduleDue(
              rule.scheduleCron,
              now,
              progress?.version === rule.version && progress.occurrence
                ? new Date(progress.occurrence)
                : undefined,
            )
          )
            return 0;
          const window = scheduleOccurrence(rule.scheduleCron, now);
          if (!window) return 0;
          const [created] = await tx
            .insert(automationRunTable)
            .values({
              id: `schedule-progress:${rule.id}`,
              automationId: rule.id,
              workspaceId: rule.workspaceId,
              projectId: rule.projectId,
              origin: "schedule",
              state: "done",
              eventId: `schedule:${rule.id}:${rule.version}:${window.toISOString()}`,
              triggeredAt: window,
              finishedAt: now,
              results: [
                {
                  cursor: "",
                  complete: false,
                  version: rule.version,
                  occurrence: window.toISOString(),
                  candidates: 0,
                },
              ],
            })
            .onConflictDoUpdate({
              target: automationRunTable.id,
              set: {
                triggeredAt: window,
                finishedAt: now,
                results: [
                  {
                    cursor: "",
                    complete: false,
                    version: rule.version,
                    occurrence: window.toISOString(),
                    candidates: 0,
                  },
                ],
              },
            })
            .returning();
          if (!created) return 0;
          sweep = created;
        }
        const filter = rule.projectId
          ? [rule.projectId]
          : Array.isArray(rule.projectFilter)
            ? (rule.projectFilter as string[])
            : null;
        await tx
          .update(automationRunTable)
          .set({
            state: "abandoned",
            finishedAt: now,
            leaseExpiresAt: null,
            error:
              "interrupted: expired lease; scheduled candidate retries after 24h on a later due sweep",
          })
          .where(
            and(
              eq(automationRunTable.workspaceId, rule.workspaceId),
              eq(automationRunTable.automationId, rule.id),
              eq(automationRunTable.origin, "schedule"),
              eq(automationRunTable.state, "running"),
              sql`${automationRunTable.leaseExpiresAt} < ${now.toISOString()}::timestamptz`,
            ),
          );
        const pending = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(automationRunTable)
          .where(
            and(
              eq(automationRunTable.workspaceId, rule.workspaceId),
              eq(automationRunTable.automationId, rule.id),
              eq(automationRunTable.origin, "schedule"),
              inArray(automationRunTable.state, ["pending", "running"]),
            ),
          );
        const capacity = SCHEDULE_PENDING_CAP - (pending[0]?.count ?? 0);
        if (capacity <= 0) return 0;
        const conditions = (
          Array.isArray(rule.conditions) ? rule.conditions : []
        ) as AutomationCondition[];
        const predicates = conditions.flatMap((c) => {
          const column =
            c.field === "state.group"
              ? stateTemplateTable.group
              : c.field === "state"
                ? stateTemplateTable.key
                : c.field === "project"
                  ? projectTable.slug
                  : null;
          if (column) {
            if (c.op === "eq") return [sql`${column} = ${c.value}`];
            if (c.op === "ne")
              return [sql`${column} IS DISTINCT FROM ${c.value}`];
            if (c.op === "in" || c.op === "not_in")
              return [
                sql`${column} ${sql.raw(c.op === "in" ? "IN" : "NOT IN")} (${sql.join(
                  (c.value as string[]).map((v) => sql`${v}`),
                  sql`, `,
                )})`,
              ];
          }
          if (c.field === "age") {
            const basis =
              c.basis === "resolved_at"
                ? sql`CASE WHEN ${stateTemplateTable.group} = 'completed' THEN ${resolvedEntrySql} END`
                : c.basis === "updated_at"
                  ? workItemTable.updatedAt
                  : workItemTable.createdAt;
            const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[c.op as "gt"];
            return op
              ? [
                  sql`floor(extract(epoch from (${now.toISOString()}::timestamp - ${basis})) / 60) ${sql.raw(op)} ${c.value}`,
                ]
              : [];
          }
          return [];
        });
        const targets = (
          Array.isArray(rule.actions) ? rule.actions : []
        ).flatMap((a: { type: string; toStateTemplateId?: string }) =>
          a.type === "transition" && a.toStateTemplateId
            ? [a.toStateTemplateId]
            : [],
        );
        const items = await tx
          .select({
            id: workItemTable.id,
            key: workItemTable.key,
            projectId: workItemTable.projectId,
          })
          .from(workItemTable)
          .innerJoin(
            projectTable,
            and(
              eq(projectTable.id, workItemTable.projectId),
              eq(projectTable.workspaceId, rule.workspaceId),
            ),
          )
          .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
          .innerJoin(
            stateTemplateTable,
            eq(stateTemplateTable.id, stateTable.stateTemplateId),
          )
          .where(
            and(
              ...predicates,
              // Existing automation_run_automation_triggered_idx indexes the rule history;
              // Unfinished runs block across stays. Finished runs reuse the resolved-age
              // entry instant; missing history means no stay boundary, not no suppression.
              sql`NOT EXISTS (SELECT 1 FROM automation_run prior
                WHERE prior.automation_id = ${rule.id}
                  AND prior.workspace_id = ${rule.workspaceId}
                  AND prior.work_item_id = ${workItemTable.id}
                  AND prior.origin = 'schedule'
                  AND starts_with(prior.event_id, ${`schedule:${rule.id}:${rule.version}:`})
                  AND (prior.state IN ('pending', 'running')
                    OR ((${stateTemplateTable.group} IS DISTINCT FROM 'completed'
                      OR prior.triggered_at >= COALESCE((${resolvedEntrySql} AT TIME ZONE 'UTC'), '-infinity'::timestamptz))
                      AND (prior.state = 'done'
                        OR prior.triggered_at > ${new Date(now.getTime() - SCHEDULE_RETRY_MS).toISOString()}::timestamptz))))`,
              targets.length
                ? sql`${stateTable.stateTemplateId} NOT IN (${sql.join(
                    targets.map((t) => sql`${t}`),
                    sql`, `,
                  )})`
                : undefined,
              eq(workItemTable.workspaceId, rule.workspaceId),
              filter ? inArray(workItemTable.projectId, filter) : undefined,
              gt(workItemTable.id, cursor),
              isNull(workItemTable.deletedAt),
              isNull(workItemTable.archivedAt),
              isNull(projectTable.deletedAt),
              isNull(projectTable.archivedAt),
            ),
          )
          .orderBy(workItemTable.id)
          .limit(Math.min(SCHEDULE_BATCH, capacity));
        const facts = await loadWorkItemsByKey(
          rule.workspaceId,
          items.map((i) => i.key),
          tx,
          true,
        );
        let enqueued = 0;
        for (const item of items) {
          const loaded = facts.get(item.key);
          if (
            !loaded ||
            !evaluateConditions(conditions, { now, workItem: loaded.facts })
              .matched
          )
            continue;
          if (!(await automationsEnabled(rule.workspaceId, item.projectId)))
            continue;
          await tx
            .insert(automationRunTable)
            .values({
              automationId: rule.id,
              workspaceId: rule.workspaceId,
              projectId: item.projectId,
              workItemId: item.id,
              workItemKey: item.key,
              origin: "schedule",
              eventId: `schedule:${rule.id}:${rule.version}:${item.id}:${randomUUID()}`,
              triggeredAt: now,
              results: [
                {
                  retryPolicy:
                    "retry after 24h on a later due sweep unless successful; expired leases are abandoned",
                },
              ],
              position: rule.position,
            })
            .onConflictDoNothing();
          enqueued++;
        }
        await tx
          .update(automationRunTable)
          .set({
            results: [
              {
                cursor: items.at(-1)?.id ?? cursor,
                complete: items.length < Math.min(SCHEDULE_BATCH, capacity),
                occurrence: (sweep.results as { occurrence: string }[])[0]
                  ?.occurrence,
                candidates:
                  ((sweep.results as { candidates?: number }[])[0]
                    ?.candidates ?? 0) + enqueued,
                version: rule.version,
              },
            ],
          })
          .where(eq(automationRunTable.id, sweep.id));
        if (items.length < Math.min(SCHEDULE_BATCH, capacity)) {
          const occurrence = (sweep.results as { occurrence: string }[])[0]
            ?.occurrence;
          await tx
            .insert(automationRunTable)
            .values({
              automationId: rule.id,
              workspaceId: rule.workspaceId,
              projectId: rule.projectId,
              origin: "schedule",
              state: "done",
              finishedAt: now,
              eventId: `schedule-summary:${rule.id}:${rule.version}:${occurrence}`,
              results: [
                {
                  complete: true,
                  candidates:
                    ((sweep.results as { candidates?: number }[])[0]
                      ?.candidates ?? 0) + enqueued,
                  occurrence,
                },
              ],
            })
            .onConflictDoNothing();
        }
        return items.length;
      }),
    () => 0,
    60_000,
  );
}

let afterRule = "";
export async function runAutomationSchedule(now = new Date()) {
  const rules = await db
    .select({ id: automationTable.id })
    .from(automationTable)
    .where(
      and(
        eq(automationTable.enabled, true),
        eq(automationTable.trigger, "schedule"),
        gt(automationTable.id, afterRule),
      ),
    )
    .orderBy(automationTable.id)
    .limit(100);
  let candidates = 0;
  let degraded = false;
  for (const rule of rules) {
    try {
      candidates += await scanRule(rule.id, now);
    } catch {
      degraded = true;
    }
  }
  afterRule = rules.length === 100 ? (rules.at(-1)?.id ?? "") : "";
  return { candidates, degraded };
}
