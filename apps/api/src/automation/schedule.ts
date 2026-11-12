import { createHash } from "node:crypto";
import { Cron } from "croner";
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

export const AUTOMATION_SCHEDULE_JOB = "automation-schedule";
export const SCHEDULE_BATCH = 50;

/** One catch-up occurrence, never a replay of every missed window. */
export function scheduleOccurrence(pattern: string, now: Date): Date | null {
  const cron = new Cron(pattern, { paused: true, timezone: "UTC" });
  const occurrence =
    cron.previousRuns(
      1,
      new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 1000),
    )[0] ?? null;
  cron.stop();
  return occurrence;
}
export function scheduleDue(pattern: string, now: Date, last?: Date): boolean {
  const occurrence = scheduleOccurrence(pattern, now);
  return occurrence !== null && (!last || occurrence > last);
}
export const SCHEDULE_PENDING_CAP = 50;

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
              evaluated?: Record<string, string>;
            }
          | undefined;
        const evaluated =
          progress?.version === rule.version ? (progress.evaluated ?? {}) : {};
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
                  evaluated,
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
                    evaluated,
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
          const fingerprint = createHash("sha256")
            .update(
              JSON.stringify({
                stateId: loaded.stateId,
                projectId: loaded.projectId,
                actions: (Array.isArray(rule.actions) ? rule.actions : []).map(
                  (a: { type: string }) => [
                    a.type,
                    a.type === "assign"
                      ? loaded.facts.assigneeId
                      : a.type === "set_priority"
                        ? loaded.facts.priority
                        : a.type === "add_label" || a.type === "remove_label"
                          ? [...loaded.facts.labels].sort()
                          : null,
                  ],
                ),
                conditions: conditions.map((c) => {
                  const f = loaded.facts;
                  const value =
                    c.field === "age"
                      ? c.basis === "resolved_at"
                        ? f.resolvedAt
                        : c.basis === "updated_at"
                          ? f.updatedAt
                          : f.createdAt
                      : (
                          {
                            type: f.typeKey,
                            state: f.stateKey,
                            "state.group": f.stateGroup,
                            priority: f.priority,
                            assignee: f.assigneeId,
                            requester: f.requesterId,
                            label: [...f.labels].sort(),
                            organisation: f.organisationId,
                            project: f.projectKey,
                            sla_state: f.slaState,
                          } as Record<string, unknown>
                        )[c.field];
                  return [c.field, value];
                }),
              }),
            )
            .digest("hex");
          if (!(await automationsEnabled(rule.workspaceId, item.projectId)))
            continue;
          if (evaluated[item.id] === fingerprint) continue;
          evaluated[item.id] = fingerprint;
          await tx
            .insert(automationRunTable)
            .values({
              automationId: rule.id,
              workspaceId: rule.workspaceId,
              projectId: item.projectId,
              workItemId: item.id,
              workItemKey: item.key,
              origin: "schedule",
              eventId: `schedule:${rule.id}:${rule.version}:${item.id}:${fingerprint}`,
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
                evaluated,
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
