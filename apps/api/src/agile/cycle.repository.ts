import { createId } from "@paralleldrive/cuid2";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notExists,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { workItemTable } from "../database/schema";
import {
  cycleScopeEventTable,
  cycleSnapshotTable,
  cycleTable,
} from "../database/schema-p5-agile";
import { openHoldOver } from "../utils/legal-hold-scope";
import { lockLegalHolds } from "../utils/workspace-legal-hold";
import type { AgileActor } from "./audit";
import { auditAgile } from "./audit";
import {
  type ActiveEstimate,
  getActiveEstimate,
  getAgileSettings,
  lockProject,
  recentEstimateChanges,
  VersionConflictError,
} from "./estimate.repository";
import {
  type ItemFact,
  itemsByKeys,
  loadItemFacts,
  lockItemsByKeys,
} from "./item-facts.repository";
import {
  type Burndown,
  buildBurndown,
  type CycleIncompletePolicy,
  type CycleRange,
  type CycleSummary,
  classifyAdd,
  computeVelocity,
  cycleStatus,
  findOverlap,
  isIncomplete,
  nextCycleAfter,
  planCompletion,
  type ScopeEvent,
  type ScopeUnit,
  scopeChanges,
  scopeUnitFor,
  summariseCycle,
  todayUtc,
  validateCycleDates,
} from "./logic";

export type CycleRow = typeof cycleTable.$inferSelect;
type ProjectRef = { workspaceId: string; projectId: string };

export class CycleOverlapError extends Error {
  constructor(
    readonly conflicting: {
      id: string;
      name: string;
      startDate: string;
      endDate: string;
    },
  ) {
    super("cycle_overlap");
  }
}

export class CycleRuleError extends HTTPException {
  constructor(status: 409 | 422 | 400, message: string) {
    super(status, { message });
  }
}

function range(row: CycleRow): CycleRange {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    completedAt: row.completedAt,
  };
}

export async function getCycle(executor: Executor, id: string) {
  const [row] = await executor
    .select()
    .from(cycleTable)
    .where(eq(cycleTable.id, id))
    .limit(1);
  return row;
}

async function projectCycles(executor: Executor, projectId: string) {
  return executor
    .select()
    .from(cycleTable)
    .where(eq(cycleTable.projectId, projectId))
    .orderBy(asc(cycleTable.startDate), asc(cycleTable.id));
}

function summaryItem(fact: ItemFact) {
  return {
    id: fact.id,
    group: fact.group,
    weight: fact.weight,
    estimated: fact.estimatePointId !== null,
  };
}

type StoredSummary = CycleSummary;
const CYCLE_SNAPSHOT_BATCH_SIZE = 100;

/** A cycle with a snapshot reads its frozen summary; otherwise it reads live items. */
async function summariesFor(
  executor: Executor,
  cycles: CycleRow[],
  unit: ScopeUnit,
): Promise<Map<string, CycleSummary>> {
  const result = new Map<string, CycleSummary>();
  const snapshots = new Map<string, StoredSummary>();
  if (cycles.length > 0) {
    const rows = await executor
      .select({
        cycleId: cycleSnapshotTable.cycleId,
        summary: cycleSnapshotTable.summary,
        date: cycleSnapshotTable.date,
        capturedAt: cycleSnapshotTable.createdAt,
      })
      .from(cycleSnapshotTable)
      .where(
        inArray(
          cycleSnapshotTable.cycleId,
          cycles.map((cycle) => cycle.id),
        ),
      )
      .orderBy(
        desc(cycleSnapshotTable.createdAt),
        desc(cycleSnapshotTable.date),
      );
    for (const row of rows) {
      if (!row.summary || snapshots.has(row.cycleId)) continue;
      const cycle = cycles.find(({ id }) => id === row.cycleId);
      if (!cycle) continue;
      const stored = row.summary as StoredSummary;
      const basis =
        cycle.completedAt && row.date === todayUtc(cycle.completedAt)
          ? "completion_action"
          : "date_catchup";
      snapshots.set(row.cycleId, {
        ...stored,
        snapshot: stored.snapshot ?? {
          capturedAt: row.capturedAt.toISOString(),
          basis,
          endDateSummary:
            basis === "completion_action" ? "known_at_action" : "unknown",
        },
      });
    }
  }
  const live = cycles.filter((cycle) => !snapshots.has(cycle.id));
  const facts = live.length
    ? await loadItemFacts(
        executor,
        inArray(
          workItemTable.cycleId,
          live.map((cycle) => cycle.id),
        ),
      )
    : [];
  const byCycle = new Map<string, ItemFact[]>();
  for (const fact of facts) {
    if (!fact.cycleId) continue;
    const list = byCycle.get(fact.cycleId) ?? [];
    list.push(fact);
    byCycle.set(fact.cycleId, list);
  }
  for (const cycle of cycles) {
    const stored = snapshots.get(cycle.id);
    result.set(
      cycle.id,
      stored ??
        summariseCycle((byCycle.get(cycle.id) ?? []).map(summaryItem), unit),
    );
  }
  return result;
}

export async function projectUnit(
  executor: Executor,
  projectId: string,
): Promise<{ unit: ScopeUnit; estimate: ActiveEstimate | null }> {
  const estimate = await getActiveEstimate(executor, projectId);
  return { unit: scopeUnitFor(estimate?.system ?? null), estimate };
}

async function insertCycleSnapshot(
  executor: Executor,
  cycleId: string,
  date: string,
  unit: ScopeUnit,
  summary: CycleSummary,
  capturedAt: Date,
  basis: "completion_action" | "date_catchup",
) {
  const storedSummary: CycleSummary = {
    ...summary,
    snapshot: {
      capturedAt: capturedAt.toISOString(),
      basis,
      endDateSummary:
        basis === "completion_action" ? "known_at_action" : "unknown",
    },
  };
  const [inserted] = await executor
    .insert(cycleSnapshotTable)
    .values({
      cycleId,
      date,
      unit,
      scopePoints: String(
        unit === "count" ? summary.total.count : summary.total.points,
      ),
      completedPoints: String(
        unit === "count" ? summary.completed.count : summary.completed.points,
      ),
      itemCount: summary.total.count,
      completedCount: summary.completed.count,
      unestimatedCount: summary.unestimated.count,
      summary: storedSummary as never,
    })
    .onConflictDoNothing({
      target: [cycleSnapshotTable.cycleId, cycleSnapshotTable.date],
    })
    .returning({ cycleId: cycleSnapshotTable.cycleId });
  return Boolean(inserted);
}

export type CycleSnapshotBatchResult = {
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
  degraded: boolean;
};

/**
 * CY-9 backstop for cycles whose inclusive end date has passed without a completion action.
 * Captures actual current values, explicitly marked as unable to reconstruct end-date facts.
 * Each cycle is serialized with project and cycle writers, and its snapshot is insert-only.
 */
export async function snapshotEndedCycles(
  now: Date,
): Promise<CycleSnapshotBatchResult> {
  const today = todayUtc(now);
  const candidates = await db
    .select({ id: cycleTable.id, projectId: cycleTable.projectId })
    .from(cycleTable)
    .where(
      and(
        isNull(cycleTable.completedAt),
        lt(cycleTable.endDate, today),
        notExists(
          db
            .select({ cycleId: cycleSnapshotTable.cycleId })
            .from(cycleSnapshotTable)
            .where(eq(cycleSnapshotTable.cycleId, cycleTable.id)),
        ),
      ),
    )
    .orderBy(asc(cycleTable.endDate), asc(cycleTable.id))
    .limit(CYCLE_SNAPSHOT_BATCH_SIZE);
  const result: CycleSnapshotBatchResult = {
    scanned: candidates.length,
    created: 0,
    skipped: 0,
    failed: 0,
    degraded: false,
  };

  for (const candidate of candidates) {
    try {
      const created = await db.transaction(async (tx) => {
        // Keep the same lock order as completion and estimate changes.
        await lockProject(tx, candidate.projectId);
        const [cycle] = await tx
          .select()
          .from(cycleTable)
          .where(eq(cycleTable.id, candidate.id))
          .for("update")
          .limit(1);
        if (!cycle || cycle.completedAt || cycle.endDate >= today) return false;

        const existing = await tx
          .select({ cycleId: cycleSnapshotTable.cycleId })
          .from(cycleSnapshotTable)
          .where(eq(cycleSnapshotTable.cycleId, cycle.id))
          .limit(1);
        if (existing.length > 0) return false;

        const { unit } = await projectUnit(tx, cycle.projectId);
        const facts = await loadItemFacts(
          tx,
          eq(workItemTable.cycleId, cycle.id),
        );
        const summary = summariseCycle(facts.map(summaryItem), unit);
        return insertCycleSnapshot(
          tx,
          cycle.id,
          today,
          unit,
          summary,
          now,
          "date_catchup",
        );
      });
      if (created) result.created += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      result.degraded = true;
      console.error("Failed to snapshot an ended cycle", {
        cycleId: candidate.id,
        error,
      });
    }
  }
  return result;
}

export async function velocityFor(
  executor: Executor,
  projectId: string,
  now: Date = new Date(),
) {
  const today = todayUtc(now);
  const rows = await executor
    .select({
      cycleId: cycleTable.id,
      completedAt: cycleTable.completedAt,
      endDate: cycleTable.endDate,
      unit: cycleSnapshotTable.unit,
      completedPoints: cycleSnapshotTable.completedPoints,
      date: cycleSnapshotTable.date,
      createdAt: cycleSnapshotTable.createdAt,
      summary: cycleSnapshotTable.summary,
    })
    .from(cycleTable)
    .innerJoin(
      cycleSnapshotTable,
      eq(cycleSnapshotTable.cycleId, cycleTable.id),
    )
    .where(
      and(
        eq(cycleTable.projectId, projectId),
        sql`(${cycleTable.completedAt} IS NOT NULL OR ${cycleTable.endDate} < ${today}::date)`,
      ),
    )
    .orderBy(desc(cycleSnapshotTable.createdAt), desc(cycleSnapshotTable.date));
  const seen = new Set<string>();
  const history = [];
  for (const row of rows) {
    if (seen.has(row.cycleId)) continue;
    seen.add(row.cycleId);
    const completionDate = row.completedAt
      ? todayUtc(row.completedAt)
      : row.endDate;
    const stored = row.summary as CycleSummary | null;
    const basis =
      stored?.snapshot?.basis ??
      (row.completedAt && row.date === todayUtc(row.completedAt)
        ? "completion_action"
        : "date_catchup");
    history.push({
      cycleId: row.cycleId,
      completedAt: new Date(`${completionDate}T00:00:00.000Z`),
      unit: row.unit as ScopeUnit,
      completedPoints: Number(row.completedPoints),
      historicalPointsKnown: basis === "completion_action",
    });
  }
  return computeVelocity(history);
}

export async function listCycles(scope: ProjectRef, now: Date) {
  const today = todayUtc(now);
  const rows = (await projectCycles(db, scope.projectId)).reverse();
  const { unit } = await projectUnit(db, scope.projectId);
  const summaries = await summariesFor(db, rows, unit);
  return {
    today,
    unit,
    velocity: await velocityFor(db, scope.projectId, now),
    incompletePolicy: (await getAgileSettings(db, scope.projectId))
      .incompletePolicy,
    cycles: rows.map((row) => ({
      row,
      status: cycleStatus(row, today),
      summary: summaries.get(row.id) as CycleSummary,
    })),
  };
}

function assertDates(startDate: string, endDate: string) {
  const problem = validateCycleDates(startDate, endDate);
  if (problem) throw new CycleRuleError(422, `cycle_${problem}`);
}

export async function createCycle(
  scope: ProjectRef,
  input: { name: string; startDate: string; endDate: string },
  actor: AgileActor,
) {
  assertDates(input.startDate, input.endDate);
  return db.transaction(async (tx) => {
    // CY-2 is checked under the project row lock so two concurrent creates cannot both pass.
    await lockProject(tx, scope.projectId);
    const others = await projectCycles(tx, scope.projectId);
    const candidate: CycleRange = {
      id: "",
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      completedAt: null,
    };
    const conflict = findOverlap(candidate, others.map(range));
    if (conflict) throw new CycleOverlapError(conflict);
    const [row] = await tx
      .insert(cycleTable)
      .values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: actor.userId,
      })
      .returning();
    if (!row) throw new Error("cycle insert returned no row");
    await auditAgile(tx, {
      action: "cycle.created",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      entityType: "cycle",
      entityId: row.id,
      actor,
      after: {
        name: row.name,
        startDate: row.startDate,
        endDate: row.endDate,
      },
    });
    return row;
  });
}

export async function updateCycle(
  id: string,
  patch: {
    name?: string;
    startDate?: string;
    endDate?: string;
    version?: number;
  },
  actor: AgileActor,
) {
  return db.transaction(async (tx) => {
    const preliminary = await getCycle(tx, id);
    if (!preliminary) return undefined;
    await lockProject(tx, preliminary.projectId);
    const [existing] = await tx
      .select()
      .from(cycleTable)
      .where(eq(cycleTable.id, id))
      .for("update")
      .limit(1);
    if (!existing) return undefined;
    if (patch.version !== undefined && patch.version !== existing.version)
      throw new VersionConflictError(existing.version);
    const datesTouched =
      patch.startDate !== undefined || patch.endDate !== undefined;
    if (datesTouched && existing.completedAt)
      throw new CycleRuleError(409, "cycle_completed");
    const startDate = patch.startDate ?? existing.startDate;
    const endDate = patch.endDate ?? existing.endDate;
    if (datesTouched) {
      assertDates(startDate, endDate);
      const others = await projectCycles(tx, existing.projectId);
      const conflict = findOverlap(
        { ...range(existing), startDate, endDate },
        others.map(range),
      );
      if (conflict) throw new CycleOverlapError(conflict);
    }
    const [row] = await tx
      .update(cycleTable)
      .set({
        name: patch.name ?? existing.name,
        startDate,
        endDate,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(cycleTable.id, id))
      .returning();
    if (!row) return undefined;
    await auditAgile(tx, {
      action: "cycle.updated",
      workspaceId: existing.workspaceId,
      projectId: existing.projectId,
      entityType: "cycle",
      entityId: id,
      actor,
      before: {
        name: existing.name,
        startDate: existing.startDate,
        endDate: existing.endDate,
      },
      after: { name: row.name, startDate: row.startDate, endDate: row.endDate },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------------------------
// Membership and the scope log
// ---------------------------------------------------------------------------------------------

async function recordEvent(
  tx: Executor,
  cycle: CycleRow,
  workItemId: string,
  kind: "added" | "removed" | "rolled_over",
  actor: Pick<AgileActor, "userId"> | null,
  today: string,
  at: Date,
) {
  const flags =
    kind === "rolled_over"
      ? { afterStart: false, retrospective: false }
      : classifyAdd(cycle, today);
  await tx.insert(cycleScopeEventTable).values({
    id: createId(),
    workspaceId: cycle.workspaceId,
    cycleId: cycle.id,
    workItemId,
    kind,
    at,
    actorId: actor?.userId ?? null,
    afterStart: flags.afterStart,
    retrospective: flags.retrospective,
  });
}

/**
 * A move to another project clears `cycle_id`; the old cycle's scope log must say so, or its
 * burndown keeps counting the item. Writes one `removed` event per item that was in a cycle,
 * in the caller's transaction (the cycle rows are locked in id order).
 */
export async function recordCycleRemovalsOnMove(
  tx: Executor,
  items: Array<{ id: string; cycleId: string | null }>,
  actorId: string | null,
  now: Date,
) {
  const inCycle = items.filter(
    (row): row is { id: string; cycleId: string } => row.cycleId !== null,
  );
  if (!inCycle.length) return;
  const cycleIds = [...new Set(inCycle.map((row) => row.cycleId))].sort();
  const cycles = await tx
    .select()
    .from(cycleTable)
    .where(inArray(cycleTable.id, cycleIds))
    .orderBy(asc(cycleTable.id))
    .for("update");
  const byId = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const today = todayUtc(now);
  for (const row of inCycle) {
    const cycle = byId.get(row.cycleId);
    if (!cycle) continue;
    await recordEvent(
      tx,
      cycle,
      row.id,
      "removed",
      actorId ? { userId: actorId } : null,
      today,
      now,
    );
  }
}

export type AddItemsResult = {
  added: string[];
  alreadyInCycle: string[];
  movedFromOtherCycle: string[];
  refused: Array<{ key: string; reason: string }>;
};

/** CY-4/CY-5: add (or move) items to one cycle; the whole batch and its log rows are one transaction. */
export async function addItemsToCycle(
  cycleId: string,
  keys: string[],
  actor: AgileActor,
  now: Date,
): Promise<AddItemsResult | undefined> {
  const today = todayUtc(now);
  return db.transaction(async (tx) => {
    // Lock order: the items (id order) BEFORE the cycles (id order), as the cross-project move
    // does. The cycle's project never changes, so it is read first without a lock.
    const [peek] = await tx
      .select({ projectId: cycleTable.projectId })
      .from(cycleTable)
      .where(eq(cycleTable.id, cycleId))
      .limit(1);
    if (!peek) return undefined;
    const unique = [...new Set(keys)];
    await lockItemsByKeys(tx, peek.projectId, unique);
    const facts = await itemsByKeys(tx, peek.projectId, unique);
    const otherCycleIds = new Set<string>();
    for (const fact of facts)
      if (fact.cycleId && fact.cycleId !== cycleId)
        otherCycleIds.add(fact.cycleId);
    const lockedCycles = await tx
      .select()
      .from(cycleTable)
      .where(inArray(cycleTable.id, [cycleId, ...otherCycleIds]))
      .orderBy(asc(cycleTable.id))
      .for("update");
    const cycle = lockedCycles.find((row) => row.id === cycleId);
    if (!cycle) return undefined;
    const byKey = new Map(facts.map((fact) => [fact.key, fact]));
    const result: AddItemsResult = {
      added: [],
      alreadyInCycle: [],
      movedFromOtherCycle: [],
      refused: [],
    };
    const others = new Map<string, CycleRow>();
    for (const row of lockedCycles)
      if (row.id !== cycleId) others.set(row.id, row);
    const toAdd: ItemFact[] = [];
    for (const key of unique) {
      const fact = byKey.get(key);
      // A key in another project is reported exactly like a missing one.
      if (!fact) {
        result.refused.push({ key, reason: "not_found" });
        continue;
      }
      if (fact.cycleId === cycle.id) {
        result.alreadyInCycle.push(key);
        continue;
      }
      toAdd.push(fact);
    }
    for (const fact of toAdd) {
      if (fact.cycleId) {
        const previous = others.get(fact.cycleId);
        if (previous)
          await recordEvent(
            tx,
            previous,
            fact.id,
            "removed",
            actor,
            today,
            now,
          );
        result.movedFromOtherCycle.push(fact.key);
      }
      await recordEvent(tx, cycle, fact.id, "added", actor, today, now);
      result.added.push(fact.key);
    }
    if (toAdd.length > 0) {
      await tx
        .update(workItemTable)
        .set({ cycleId: cycle.id, updatedAt: now })
        .where(
          inArray(
            workItemTable.id,
            toAdd.map((fact) => fact.id),
          ),
        );
      await auditAgile(tx, {
        action: "cycle.work_item_added",
        workspaceId: cycle.workspaceId,
        projectId: cycle.projectId,
        entityType: "cycle",
        entityId: cycle.id,
        actor,
        after: {
          workItems: result.added,
          movedFromOtherCycle: result.movedFromOtherCycle,
          retrospective: classifyAdd(cycle, today).retrospective,
        },
      });
    }
    return result;
  });
}

export async function removeItemFromCycle(
  cycleId: string,
  key: string,
  actor: AgileActor,
  now: Date,
): Promise<"removed" | "not_in_cycle" | undefined> {
  const today = todayUtc(now);
  return db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ projectId: cycleTable.projectId })
      .from(cycleTable)
      .where(eq(cycleTable.id, cycleId))
      .limit(1);
    if (!peek) return undefined;
    await lockItemsByKeys(tx, peek.projectId, [key]);
    const [cycle] = await tx
      .select()
      .from(cycleTable)
      .where(eq(cycleTable.id, cycleId))
      .for("update")
      .limit(1);
    if (!cycle) return undefined;
    const [fact] = await itemsByKeys(tx, cycle.projectId, [key]);
    if (!fact || fact.cycleId !== cycle.id) return "not_in_cycle";
    await recordEvent(tx, cycle, fact.id, "removed", actor, today, now);
    await tx
      .update(workItemTable)
      .set({ cycleId: null, updatedAt: now })
      .where(eq(workItemTable.id, fact.id));
    await auditAgile(tx, {
      action: "cycle.work_item_removed",
      workspaceId: cycle.workspaceId,
      projectId: cycle.projectId,
      entityType: "cycle",
      entityId: cycle.id,
      actor,
      before: { workItem: key },
    });
    return "removed";
  });
}

// ---------------------------------------------------------------------------------------------
// Completion (CY-6)
// ---------------------------------------------------------------------------------------------

export async function completionPreview(
  executor: Executor,
  cycle: CycleRow,
  now: Date,
) {
  const today = todayUtc(now);
  const settings = await getAgileSettings(executor, cycle.projectId);
  const all = await projectCycles(executor, cycle.projectId);
  const next = nextCycleAfter(range(cycle), all.map(range), today);
  const facts = await loadItemFacts(
    executor,
    eq(workItemTable.cycleId, cycle.id),
  );
  return {
    defaultPolicy: settings.incompletePolicy,
    incompleteCount: facts.filter((fact) => isIncomplete(fact.group)).length,
    nextCycle: next
      ? {
          id: next.id,
          name: next.name,
          startDate: next.startDate,
          endDate: next.endDate,
        }
      : null,
  };
}

export async function completeCycle(
  id: string,
  options: {
    policy?: CycleIncompletePolicy;
    dryRun: boolean;
    now: Date;
  },
  actor: AgileActor,
) {
  const today = todayUtc(options.now);
  return db.transaction(async (tx) => {
    const preliminary = await getCycle(tx, id);
    if (!preliminary) return undefined;
    await lockProject(tx, preliminary.projectId);
    const [cycle] = await tx
      .select()
      .from(cycleTable)
      .where(eq(cycleTable.id, id))
      .for("update")
      .limit(1);
    if (!cycle) return undefined;
    if (cycle.completedAt)
      throw new CycleRuleError(409, "cycle_already_completed");
    const settings = await getAgileSettings(tx, cycle.projectId);
    const policy = options.policy ?? settings.incompletePolicy;
    const all = await projectCycles(tx, cycle.projectId);
    const next = nextCycleAfter(range(cycle), all.map(range), today);
    const facts = await loadItemFacts(tx, eq(workItemTable.cycleId, cycle.id));
    const plan = planCompletion({
      policy,
      items: facts.map((fact) => ({ id: fact.id, group: fact.group })),
      nextCycleId: next?.id ?? null,
    });
    if (!plan.ok) throw new CycleRuleError(409, plan.reason);
    const { unit } = await projectUnit(tx, cycle.projectId);
    const summary = summariseCycle(facts.map(summaryItem), unit);
    const destination = plan.destinationCycleId
      ? (all.find((candidate) => candidate.id === plan.destinationCycleId) ??
        null)
      : null;
    const response = {
      policy,
      destination,
      movedCount: plan.moveItemIds.length,
      leftCount: plan.leaveItemIds.length,
    };
    if (options.dryRun) return { ...response, row: cycle, summary };

    const [row] = await tx
      .update(cycleTable)
      .set({
        completedAt: options.now,
        completedBy: actor.userId,
        version: cycle.version + 1,
        updatedAt: options.now,
      })
      .where(eq(cycleTable.id, id))
      .returning();
    if (!row) return undefined;
    // CY-9: the frozen snapshot velocity reads, with the full summary so a later move of
    // incomplete items never rewrites what this cycle delivered.
    const existingSnapshot = await tx
      .select({ cycleId: cycleSnapshotTable.cycleId })
      .from(cycleSnapshotTable)
      .where(eq(cycleSnapshotTable.cycleId, id))
      .limit(1);
    // A daily end-date snapshot is already the immutable record for a naturally completed
    // cycle; don't replace it with the later completion action's view of moved work.
    if (existingSnapshot.length === 0)
      await insertCycleSnapshot(
        tx,
        id,
        today,
        unit,
        summary,
        options.now,
        "completion_action",
      );
    if (plan.moveItemIds.length > 0) {
      for (const itemId of plan.moveItemIds) {
        await recordEvent(
          tx,
          cycle,
          itemId,
          "rolled_over",
          actor,
          today,
          options.now,
        );
        if (destination)
          await recordEvent(
            tx,
            destination as CycleRow,
            itemId,
            "added",
            actor,
            today,
            options.now,
          );
      }
      await tx
        .update(workItemTable)
        .set({ cycleId: destination?.id ?? null, updatedAt: options.now })
        .where(inArray(workItemTable.id, plan.moveItemIds));
    }
    await auditAgile(tx, {
      action: "cycle.completed",
      workspaceId: cycle.workspaceId,
      projectId: cycle.projectId,
      entityType: "cycle",
      entityId: id,
      actor,
      after: {
        policy,
        movedCount: plan.moveItemIds.length,
        leftCount: plan.leaveItemIds.length,
        destinationCycleId: destination?.id ?? null,
        completedPoints: summary.completed.points,
        scopePoints: summary.total.points,
        unit,
      },
    });
    return { ...response, row, summary };
  });
}

// ---------------------------------------------------------------------------------------------
// Detail, scope changes, burndown
// ---------------------------------------------------------------------------------------------

async function scopeEvents(executor: Executor, cycleId: string) {
  const rows = await executor
    .select({
      workItemId: cycleScopeEventTable.workItemId,
      kind: cycleScopeEventTable.kind,
      at: cycleScopeEventTable.at,
      afterStart: cycleScopeEventTable.afterStart,
      retrospective: cycleScopeEventTable.retrospective,
    })
    .from(cycleScopeEventTable)
    .where(eq(cycleScopeEventTable.cycleId, cycleId))
    .orderBy(asc(cycleScopeEventTable.at), asc(cycleScopeEventTable.id));
  return rows.map(
    (row): ScopeEvent => ({
      workItemId: row.workItemId,
      kind: row.kind as ScopeEvent["kind"],
      at: row.at,
      afterStart: row.afterStart,
      retrospective: row.retrospective,
    }),
  );
}

export async function cycleDetail(row: CycleRow, now: Date) {
  const today = todayUtc(now);
  const { unit } = await projectUnit(db, row.projectId);
  const summary = (await summariesFor(db, [row], unit)).get(
    row.id,
  ) as CycleSummary;
  const events = await scopeEvents(db, row.id);
  const changes = scopeChanges(events);
  const ids = [...new Set(changes.map((change) => change.workItemId))];
  const items = ids.length
    ? await loadItemFacts(db, inArray(workItemTable.id, ids), {
        includeArchived: true,
      })
    : [];
  const keyById = new Map(items.map((item) => [item.id, item]));
  return {
    row,
    status: cycleStatus(row, today),
    summary,
    scopeChanges: changes.map((change) => ({
      workItemKey: keyById.get(change.workItemId)?.key ?? "",
      title: keyById.get(change.workItemId)?.title ?? "",
      kind: change.kind,
      at: change.at,
      retrospective: change.retrospective,
    })),
    completionPreview: await completionPreview(db, row, now),
    velocity: await velocityFor(db, row.projectId, now),
    discontinuities: await discontinuitiesFor(row),
  };
}

async function discontinuitiesFor(row: CycleRow) {
  const changes = await recentEstimateChanges(db, row.projectId);
  return changes
    .filter((change) => {
      const date = change.changedAt.toISOString().slice(0, 10);
      return date >= row.startDate && date <= row.endDate;
    })
    .map((change) => ({
      date: change.changedAt.toISOString().slice(0, 10),
      kind: change.kind,
      fromSystem: change.fromSystem,
      toSystem: change.toSystem,
    }));
}

export async function cycleBurndown(
  row: CycleRow,
  now: Date,
): Promise<
  Burndown & {
    unestimated: { count: number; share: number };
    discontinuities: Awaited<ReturnType<typeof discontinuitiesFor>>;
  }
> {
  const { unit } = await projectUnit(db, row.projectId);
  const events = await scopeEvents(db, row.id);
  const ids = [...new Set(events.map((event) => event.workItemId))];
  const facts = ids.length
    ? await loadItemFacts(db, inArray(workItemTable.id, ids), {
        includeArchived: true,
      })
    : [];
  const burndown = buildBurndown({
    startDate: row.startDate,
    endDate: row.endDate,
    completedAt: row.completedAt,
    today: todayUtc(now),
    unit,
    events,
    items: facts.map((fact) => ({
      id: fact.id,
      weight: fact.weight,
      resolvedAt:
        fact.group === "completed" || fact.group === "cancelled"
          ? fact.resolvedAt
          : null,
    })),
  });
  const summary = (await summariesFor(db, [row], unit)).get(
    row.id,
  ) as CycleSummary;
  return {
    ...burndown,
    unestimated: summary.unestimated,
    discontinuities: await discontinuitiesFor(row),
  };
}

/**
 * True when an open legal hold covers a person named in the cycle's scope log (`actor_id` is a
 * user id; its `person`), or the organisation of the cycle's project or workspace: deleting the
 * cycle hard-deletes `cycle_scope_event` and `cycle_snapshot`. Takes the `legal_hold` SHARE lock
 * so a hold placed concurrently either sees the cycle or is seen here.
 */
export async function cycleUnderOpenHold(
  tx: Executor,
  cycleId: string,
): Promise<boolean> {
  await lockLegalHolds(tx);
  const result = await tx.execute<{ held: boolean }>(sql`
    SELECT ${openHoldOver(
      sql`
        SELECT pe."id" FROM "person" pe
        WHERE pe."user_id" IN (
          SELECT cse."actor_id" FROM "cycle_scope_event" cse WHERE cse."cycle_id" = ${cycleId}
        )
      `,
      sql`
        SELECT w."organisation_id" FROM "cycle" cy JOIN "workspace" w ON w."id" = cy."workspace_id" WHERE cy."id" = ${cycleId}
        UNION ALL
        SELECT p."organisation_id" FROM "cycle" cy JOIN "project" p ON p."id" = cy."project_id" WHERE cy."id" = ${cycleId}
      `,
    )} AS held
  `);
  return result.rows[0]?.held === true;
}

export async function cycleDeletionBlockers() {
  return [] as string[];
}

/** Used by the deletion target: clear the pointers first (the composite FK is NO ACTION). */
export async function deleteCycleRow(
  tx: Executor,
  cycle: CycleRow,
  actor: AgileActor,
) {
  await tx
    .update(workItemTable)
    .set({ cycleId: null, updatedAt: new Date() })
    .where(eq(workItemTable.cycleId, cycle.id));
  const deleted = await tx
    .delete(cycleTable)
    .where(eq(cycleTable.id, cycle.id))
    .returning({ id: cycleTable.id });
  if (deleted.length === 0) return false;
  await auditAgile(tx, {
    action: "cycle.deleted",
    workspaceId: cycle.workspaceId,
    projectId: cycle.projectId,
    entityType: "cycle",
    entityId: cycle.id,
    actor,
    before: {
      name: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    },
  });
  return true;
}

/** `PUT /work-items/{key}/cycle`: move one item into a cycle, or out of its cycle. */
export async function setItemCycle(
  input: { projectId: string; key: string; cycleId: string | null },
  actor: AgileActor,
  now: Date,
) {
  if (input.cycleId === null) {
    const [fact] = await itemsByKeys(db, input.projectId, [input.key]);
    if (!fact) throw new HTTPException(404, { message: "Work item not found" });
    if (!fact.cycleId) return;
    await removeItemFromCycle(fact.cycleId, input.key, actor, now);
    return;
  }
  const cycle = await getCycle(db, input.cycleId);
  if (!cycle || cycle.projectId !== input.projectId)
    throw new HTTPException(404, { message: "Cycle not found" });
  const result = await addItemsToCycle(cycle.id, [input.key], actor, now);
  if (result?.refused.length)
    throw new HTTPException(404, { message: "Work item not found" });
}

export const getCycleById = (id: string) => getCycle(db, id);
