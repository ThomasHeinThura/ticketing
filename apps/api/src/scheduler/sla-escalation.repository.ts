import { and, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import {
  commentTable,
  personTable,
  slaEscalationTable,
  workItemSlaCacheTable,
  workItemTable,
} from "../database/schema";

/**
 * Query ownership for the SLA-17 / NO-22 escalation walk (`sla_escalation`). Every function
 * takes the caller's transaction handle first; none opens or commits one.
 */

export type EscalationWalkRow = typeof slaEscalationTable.$inferSelect;

/** Creates the walk for a breach; idempotent on `(work_item, metric, trigger_event)`. */
export async function insertEscalationWalk(
  executor: Executor,
  row: {
    workspaceId: string;
    projectId: string;
    workItemId: string;
    metric: string;
    triggerEventId: string;
    stateIdAtStart: string;
    assigneeIdAtStart: string | null;
    lastOrder: number;
    nextDueAt: Date | null;
    startedAt: Date;
  },
): Promise<void> {
  await executor
    .insert(slaEscalationTable)
    .values({
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      metric: row.metric,
      triggerEventId: row.triggerEventId,
      stateIdAtStart: row.stateIdAtStart,
      assigneeIdAtStart: row.assigneeIdAtStart,
      lastOrder: row.lastOrder,
      nextDueAt: row.nextDueAt,
      state: row.nextDueAt ? "active" : "completed",
      startedAt: row.startedAt,
      updatedAt: row.startedAt,
    })
    .onConflictDoNothing({
      target: [
        slaEscalationTable.workItemId,
        slaEscalationTable.metric,
        slaEscalationTable.triggerEventId,
      ],
    });
}

/**
 * A metric that flaps breached -> at_risk -> breached emits a second `sla.breached` (a new
 * trigger event id) while the first walk is still active. Only one walk per (item, metric) may be
 * active, so the older one is stopped as `superseded` before the new breach starts its own.
 */
export async function supersedeActiveEscalationWalks(
  executor: Executor,
  workItemId: string,
  metric: string,
  /** The new breach's event id: a redelivery of the SAME event never stops its own walk. */
  triggerEventId: string,
): Promise<void> {
  await executor
    .update(slaEscalationTable)
    .set({
      state: "stopped",
      stopReason: "superseded",
      nextDueAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(slaEscalationTable.workItemId, workItemId),
        eq(slaEscalationTable.metric, metric),
        eq(slaEscalationTable.state, "active"),
        ne(slaEscalationTable.triggerEventId, triggerEventId),
      ),
    );
}

/**
 * Claims the oldest active walk whose next step is due, `FOR UPDATE SKIP LOCKED`, so every
 * replica can advance different walks concurrently and none twice. `next_due_at` is
 * `timestamptz`, so the bare `now()` is the correct comparison.
 */
export async function claimDueEscalationWalk(
  executor: Executor,
  skipWalkIds: readonly string[] = [],
): Promise<EscalationWalkRow | undefined> {
  const [row] = await executor
    .select()
    .from(slaEscalationTable)
    .where(
      and(
        eq(slaEscalationTable.state, "active"),
        sql`${slaEscalationTable.nextDueAt} <= now()`,
        skipWalkIds.length > 0
          ? notInArray(slaEscalationTable.id, [...skipWalkIds])
          : undefined,
      ),
    )
    .orderBy(slaEscalationTable.nextDueAt)
    .limit(1)
    .for("update", { skipLocked: true });
  return row;
}

export type EscalationItemFacts = {
  stateId: string;
  assigneeId: string | null;
  resolvedAt: Date | null;
  available: boolean;
  metricState: string | null;
  staffCommentedSinceStart: boolean;
};

/** The facts NO-22's stop conditions read, taken inside the claiming transaction. */
export async function loadEscalationItemFacts(
  executor: Executor,
  walk: EscalationWalkRow,
): Promise<EscalationItemFacts | undefined> {
  const [item] = await executor
    .select({
      stateId: workItemTable.stateId,
      assigneeId: workItemTable.assigneeId,
      resolvedAt: workItemTable.resolvedAt,
      archivedAt: workItemTable.archivedAt,
      deletedAt: workItemTable.deletedAt,
    })
    .from(workItemTable)
    .where(eq(workItemTable.id, walk.workItemId))
    .limit(1);
  if (!item) return undefined;
  const [cache] = await executor
    .select({ state: workItemSlaCacheTable.state })
    .from(workItemSlaCacheTable)
    .where(
      and(
        eq(workItemSlaCacheTable.workItemId, walk.workItemId),
        eq(workItemSlaCacheTable.metric, walk.metric),
      ),
    )
    .limit(1);
  // A comment by a staff person (internal or public) after the walk began is the intervention
  // NO-22 names; a customer's or a system comment is not.
  const [staffComment] = await executor
    .select({ id: commentTable.id })
    .from(commentTable)
    .innerJoin(personTable, eq(personTable.id, commentTable.authorId))
    .where(
      and(
        eq(commentTable.workItemId, walk.workItemId),
        eq(commentTable.actorType, "person"),
        isNull(commentTable.deletedAt),
        eq(personTable.side, "staff"),
        // `comment.created_at` is `timestamp` (UTC wall clock, utils/db-time.ts); the walk's
        // `started_at` is `timestamptz`, so compare in the column's own convention.
        sql`${commentTable.createdAt} > (${walk.startedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
      ),
    )
    .limit(1);
  return {
    stateId: item.stateId,
    assigneeId: item.assigneeId,
    resolvedAt: item.resolvedAt,
    available: item.archivedAt === null && item.deletedAt === null,
    metricState: cache?.state ?? null,
    staffCommentedSinceStart: Boolean(staffComment),
  };
}

export async function stopEscalationWalk(
  executor: Executor,
  walkId: string,
  reason: string,
): Promise<void> {
  await executor
    .update(slaEscalationTable)
    .set({
      state: "stopped",
      stopReason: reason,
      nextDueAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(slaEscalationTable.id, walkId),
        eq(slaEscalationTable.state, "active"),
      ),
    );
}

export async function advanceEscalationWalk(
  executor: Executor,
  walkId: string,
  next: { lastOrder: number | null; nextDueAt: Date | null },
): Promise<void> {
  await executor
    .update(slaEscalationTable)
    .set({
      ...(next.lastOrder === null ? {} : { lastOrder: next.lastOrder }),
      nextDueAt: next.nextDueAt,
      state: next.nextDueAt ? "active" : "completed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(slaEscalationTable.id, walkId),
        eq(slaEscalationTable.state, "active"),
      ),
    );
}

/** The breach envelope the walk is anchored on; `undefined` once retention purged it. */
export async function loadTriggerEnvelope(
  executor: Executor,
  walk: Pick<EscalationWalkRow, "triggerEventId" | "workspaceId">,
): Promise<unknown | undefined> {
  const result = await executor.execute<{ payload: unknown }>(
    sql`SELECT "payload" FROM "outbox"
        WHERE "event_id" = ${walk.triggerEventId} AND "workspace_id" = ${walk.workspaceId}
        LIMIT 1`,
  );
  return result.rows[0]?.payload;
}
