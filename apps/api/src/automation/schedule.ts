import { Cron } from "croner";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import db from "../database";
import {
  automationRunTable,
  automationTable,
  projectTable,
  workItemTable,
} from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { automationsEnabled } from "./feature";

export const AUTOMATION_SCHEDULE_JOB = "automation-schedule";
export const SCHEDULE_BATCH = 50;

/** UTC minute windows only. Missed windows are skipped rather than replayed. */
export function scheduleDue(pattern: string, now: Date): boolean {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const cron = new Cron(pattern, { paused: true, timezone: "UTC" });
  const next = cron.nextRun(new Date(minute - 1));
  cron.stop();
  return next !== null && next.getTime() === minute;
}

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
              eq(automationRunTable.automationId, rule.id),
              eq(automationRunTable.origin, "schedule"),
              isNull(automationRunTable.workItemId),
            ),
          )
          .orderBy(
            desc(automationRunTable.triggeredAt),
            desc(automationRunTable.id),
          )
          .limit(1);
        let cursor = "";
        const progress = (
          Array.isArray(sweep?.results) ? sweep.results[0] : undefined
        ) as
          | { cursor?: string; complete?: boolean; version?: number }
          | undefined;
        if (
          sweep &&
          progress?.complete === false &&
          progress.version === rule.version
        )
          cursor = progress.cursor ?? "";
        else {
          if (!scheduleDue(rule.scheduleCron, now)) return 0;
          const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
          const [created] = await tx
            .insert(automationRunTable)
            .values({
              automationId: rule.id,
              workspaceId: rule.workspaceId,
              projectId: rule.projectId,
              origin: "schedule",
              state: "done",
              eventId: `schedule:${rule.id}:${rule.version}:${window.toISOString()}`,
              triggeredAt: window,
              finishedAt: now,
              results: [{ cursor: "", complete: false, version: rule.version }],
            })
            .onConflictDoNothing()
            .returning();
          if (!created) return 0;
          sweep = created;
        }
        const filter = rule.projectId
          ? [rule.projectId]
          : Array.isArray(rule.projectFilter)
            ? (rule.projectFilter as string[])
            : null;
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
          .where(
            and(
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
          .limit(SCHEDULE_BATCH);
        for (const item of items) {
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
              eventId: `schedule:${rule.id}:${rule.version}:${sweep.id}:${item.id}`,
              position: rule.position,
            })
            .onConflictDoNothing();
        }
        await tx
          .update(automationRunTable)
          .set({
            results: [
              {
                cursor: items.at(-1)?.id ?? cursor,
                complete: items.length < SCHEDULE_BATCH,
                version: rule.version,
              },
            ],
          })
          .where(eq(automationRunTable.id, sweep.id));
        return items.length;
      }),
    () => 0,
    60_000,
  );
}

let afterRule = "";
export async function runAutomationSchedule() {
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
      candidates += await scanRule(rule.id, new Date());
    } catch {
      degraded = true;
    }
  }
  afterRule = rules.length === 100 ? (rules.at(-1)?.id ?? "") : "";
  return { candidates, degraded };
}
