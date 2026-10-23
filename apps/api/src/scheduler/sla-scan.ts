import { createId } from "@paralleldrive/cuid2";
import { type SlaState, scanDecision } from "@taskdesk/domain";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  workItemSlaCacheTable,
  workItemTable,
} from "../database/schema";
import { logTaskDesk } from "../instance/observability/runtime";
import { evaluateStoredWorkItemSla } from "../sla-policy/evaluation";
import { withJobLease } from "./leader-lock";
import { enqueueSlaEvent } from "./sla-escalation";

const BATCH_SIZE = 100;
export type SlaScanOutcome = {
  scanned: number;
  emitted: number;
  degraded: boolean;
};

/** Item UPDATE → project SHARE follows every item writer's lock order. Re-read after waits. */
export async function scanWorkItemSla(itemId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(workItemTable)
      .where(eq(workItemTable.id, itemId))
      .for("update");
    if (
      !item ||
      item.resolvedAt ||
      item.archivedAt ||
      item.deletedAt ||
      !item.slaPolicyVersionId
    )
      return 0;
    const [project] = await tx
      .select()
      .from(projectTable)
      .where(eq(projectTable.id, item.projectId))
      .for("share");
    if (!project || project.deletedAt || project.archivedAt) return 0;
    const clock = await tx.execute<{ now: string }>(
      sql`SELECT clock_timestamp()::text AS now`,
    );
    const row = clock.rows[0];
    if (!row) throw new Error("Database clock unavailable");
    const now = new Date(row.now);
    const { metrics } = await evaluateStoredWorkItemSla(tx, item.id, now);
    const cached = await tx
      .select()
      .from(workItemSlaCacheTable)
      .where(eq(workItemSlaCacheTable.workItemId, item.id));
    let emitted = 0;
    for (const metric of metrics) {
      const previous = cached.find((row) => row.metric === metric.metric);
      const decision = scanDecision(
        (previous?.state ?? "none") as SlaState,
        metric.state,
      );
      await tx
        .insert(workItemSlaCacheTable)
        .values({
          workItemId: item.id,
          metric: metric.metric,
          state: metric.state,
          dueAt: metric.dueAt,
          computedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            workItemSlaCacheTable.workItemId,
            workItemSlaCacheTable.metric,
          ],
          set: { state: metric.state, dueAt: metric.dueAt, computedAt: now },
        });
      for (const kind of decision.emit) {
        // SLA-16 / EV-1: the outbox row and the assignee/lead (and, on a breach, first
        // escalation stakeholder) fan-out commit with the cache write. A breach also starts the
        // SLA-17 escalation walk.
        await enqueueSlaEvent(
          tx,
          {
            id: createId(),
            kind,
            occurredAt: now.toISOString(),
            actor: { type: "system", id: null, name: "SLA scanner" },
            scope: {
              workspaceId: item.workspaceId,
              projectId: item.projectId,
              ...(project.organisationId
                ? { organisationId: project.organisationId }
                : {}),
            },
            payload: {
              workItemId: item.id,
              key: item.key,
              url: `/agent/work-items/${encodeURIComponent(item.key)}`,
              metric: metric.metric,
              dueAt: metric.dueAt?.toISOString() ?? null,
              ...(kind === "sla.at_risk"
                ? { consumedPct: metric.consumedPct }
                : {
                    breachedByMinutes: Math.max(
                      0,
                      metric.consumedMinutes - (metric.targetMinutes ?? 0),
                    ),
                  }),
            },
            causationId: null,
            depth: 0,
            originAutomationId: null,
          },
          {
            workItem: {
              id: item.id,
              stateId: item.stateId,
              assigneeId: item.assigneeId,
            },
            workspaceId: item.workspaceId,
            projectId: item.projectId,
            metric: metric.metric,
            now,
          },
        );
        emitted++;
      }
    }
    return emitted;
  });
}

/** Bounded transactions and keyset pages; lease expiry never bypasses item-level serialization. */
export async function scanSla(): Promise<SlaScanOutcome> {
  return withJobLease(
    "sla-scan",
    async () => {
      const outcome: SlaScanOutcome = {
        scanned: 0,
        emitted: 0,
        degraded: false,
      };
      let cursor: string | undefined;
      while (true) {
        const candidates = await db
          .select({ id: workItemTable.id })
          .from(workItemTable)
          .where(
            and(
              isNull(workItemTable.resolvedAt),
              isNull(workItemTable.archivedAt),
              isNull(workItemTable.deletedAt),
              isNotNull(workItemTable.slaPolicyVersionId),
              cursor ? gt(workItemTable.id, cursor) : undefined,
            ),
          )
          .orderBy(asc(workItemTable.id))
          .limit(BATCH_SIZE);
        if (!candidates.length) break;
        for (const candidate of candidates) {
          cursor = candidate.id;
          outcome.scanned++;
          try {
            outcome.emitted += await scanWorkItemSla(candidate.id);
          } catch {
            outcome.degraded = true;
            logTaskDesk({
              module: "jobs",
              message: "jobs.failure",
              level: "error",
              result: "degraded",
            });
          }
        }
        if (candidates.length < BATCH_SIZE) break;
      }
      console.log(
        JSON.stringify({
          job: "sla-scan",
          itemsProcessed: outcome.scanned,
          eventsEmitted: outcome.emitted,
          outcome: outcome.degraded ? "degraded" : "ok",
        }),
      );
      return outcome;
    },
    () => ({ scanned: 0, emitted: 0, degraded: false }),
    5 * 60_000,
  );
}
