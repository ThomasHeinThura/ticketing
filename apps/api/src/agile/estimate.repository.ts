import { createId } from "@paralleldrive/cuid2";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { projectTable, workItemTable } from "../database/schema";
import {
  cycleTable,
  estimateChangeTable,
  estimatePointTable,
  estimateTable,
  projectAgileSettingTable,
} from "../database/schema-p5-agile";
import type { AgileActor } from "./audit";
import { auditAgile } from "./audit";
import {
  type CycleIncompletePolicy,
  cycleStatus,
  DEFAULT_CYCLE_INCOMPLETE_POLICY,
  DEFAULT_SCALES,
  type EstimateChangePlan,
  type EstimateSystem,
  normaliseScale,
  planEstimateChange,
  pointKeyFor,
  rollUpEstimate,
  todayUtc,
} from "./logic";

export type EstimatePointRow = {
  id: string;
  key: string;
  value: string;
  weight: number | null;
  position: number;
};
export type ActiveEstimate = {
  id: string;
  system: EstimateSystem;
  points: EstimatePointRow[];
};

type ProjectRef = { workspaceId: string; projectId: string };

function toPoint(row: {
  id: string;
  key: string;
  value: string;
  weight: string | null;
  position: number;
}): EstimatePointRow {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    weight: row.weight === null ? null : Number(row.weight),
    position: row.position,
  };
}

export async function getActiveEstimate(
  executor: Executor,
  projectId: string,
): Promise<ActiveEstimate | null> {
  const [estimate] = await executor
    .select()
    .from(estimateTable)
    .where(
      and(
        eq(estimateTable.projectId, projectId),
        eq(estimateTable.active, true),
      ),
    )
    .limit(1);
  if (!estimate) return null;
  const points = await executor
    .select()
    .from(estimatePointTable)
    .where(
      and(
        eq(estimatePointTable.estimateId, estimate.id),
        isNull(estimatePointTable.archivedAt),
      ),
    )
    .orderBy(asc(estimatePointTable.position), asc(estimatePointTable.id));
  return {
    id: estimate.id,
    system: estimate.system as EstimateSystem,
    points: points.map(toPoint),
  };
}

export async function getAgileSettings(
  executor: Executor,
  projectId: string,
): Promise<{ incompletePolicy: CycleIncompletePolicy; version: number }> {
  const [row] = await executor
    .select()
    .from(projectAgileSettingTable)
    .where(eq(projectAgileSettingTable.projectId, projectId))
    .limit(1);
  return {
    incompletePolicy: (row?.cycleIncompletePolicy ??
      DEFAULT_CYCLE_INCOMPLETE_POLICY) as CycleIncompletePolicy,
    version: row?.version ?? 1,
  };
}

export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("version_conflict");
  }
}

export async function setAgileSettings(
  scope: ProjectRef,
  input: { incompletePolicy: CycleIncompletePolicy; version?: number },
  actor: AgileActor,
) {
  return db.transaction(async (tx) => {
    await lockProject(tx, scope.projectId);
    const [existing] = await tx
      .select()
      .from(projectAgileSettingTable)
      .where(eq(projectAgileSettingTable.projectId, scope.projectId))
      .for("update")
      .limit(1);
    if (
      existing &&
      input.version !== undefined &&
      existing.version !== input.version
    )
      throw new VersionConflictError(existing.version);
    const before = existing?.cycleIncompletePolicy ?? null;
    if (existing) {
      await tx
        .update(projectAgileSettingTable)
        .set({
          cycleIncompletePolicy: input.incompletePolicy,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(projectAgileSettingTable.projectId, scope.projectId));
    } else {
      await tx.insert(projectAgileSettingTable).values({
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        cycleIncompletePolicy: input.incompletePolicy,
      });
    }
    await auditAgile(tx, {
      action: "agile.settings_updated",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      entityType: "project",
      entityId: scope.projectId,
      actor,
      before: { cycleIncompletePolicy: before },
      after: { cycleIncompletePolicy: input.incompletePolicy },
    });
    return getAgileSettings(tx, scope.projectId);
  });
}

/** Serialises concurrent estimate and cycle writes for one project. */
export async function lockProject(tx: Executor, projectId: string) {
  const [row] = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .for("update")
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Project not found" });
}

/**
 * `FOR SHARE` on the project row: conflicts with `lockProject` (`FOR UPDATE`), so a single-item
 * estimate write waits for a running estimate change and sees its committed result. Always taken
 * before any item row lock (project -> item, the order `applyEstimateChange` uses).
 */
async function lockProjectShared(tx: Executor, projectId: string) {
  const [row] = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .for("share")
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Project not found" });
}

export type EstimateChangeInput = {
  system?: EstimateSystem;
  points?: Array<{ key?: string; value: string }>;
};

export type EstimateChangePreview = {
  fromSystem: EstimateSystem | null;
  toSystem: EstimateSystem;
  plan: EstimateChangePlan;
  activeCycles: Array<{ id: string; name: string }>;
};

type PlannedChange = {
  preview: EstimateChangePreview;
  current: ActiveEstimate | null;
  /** The new scale with a stable key on every point. */
  nextPoints: Array<{ key: string; value: string; weight: number | null }>;
  sameSystem: boolean;
  noop: boolean;
};

export class EstimateInputError extends HTTPException {
  constructor(message: string) {
    super(422, { message });
  }
}

async function usageByPoint(executor: Executor, pointIds: string[]) {
  const usage = new Map<string, number>();
  if (pointIds.length === 0) return usage;
  const rows = await executor
    .select({
      pointId: workItemTable.estimatePointId,
      value: count(),
    })
    .from(workItemTable)
    .where(inArray(workItemTable.estimatePointId, pointIds))
    .groupBy(workItemTable.estimatePointId);
  for (const row of rows)
    if (row.pointId) usage.set(row.pointId, Number(row.value));
  return usage;
}

/**
 * Plans an estimate change. Used verbatim by the dry-run and by the applied change, so the
 * preview the user confirmed is exactly what the change then does (ES-3).
 */
export async function planChange(
  executor: Executor,
  scope: ProjectRef,
  input: EstimateChangeInput,
  now: Date,
): Promise<PlannedChange> {
  const current = await getActiveEstimate(executor, scope.projectId);
  const fromSystem = current?.system ?? null;
  const toSystem = input.system ?? fromSystem;
  if (!toSystem) throw new EstimateInputError("estimate_system_required");
  const sameSystem = fromSystem === toSystem;
  const requested =
    input.points ??
    (sameSystem && current
      ? current.points.map((point) => ({ key: point.key, value: point.value }))
      : DEFAULT_SCALES[toSystem].map((point) => ({ value: point.value })));
  const scale = normaliseScale(toSystem, requested);
  if (!scale.ok)
    throw new EstimateInputError(`estimate_scale_${scale.problem}`);

  const currentKeys = new Set(current?.points.map((point) => point.key));
  const used = new Set<string>();
  const nextPoints: PlannedChange["nextPoints"] = [];
  let counter = 0;
  const freshKey = () => {
    let key = pointKeyFor(counter);
    while (used.has(key) || (sameSystem && currentKeys.has(key))) {
      counter += 1;
      key = pointKeyFor(counter);
    }
    counter += 1;
    return key;
  };
  for (const point of scale.points) {
    // Only an existing point of the SAME system keeps its identity; a stranger key is refused.
    if (sameSystem && point.key !== undefined) {
      if (!currentKeys.has(point.key))
        throw new EstimateInputError("estimate_point_unknown");
      if (used.has(point.key))
        throw new EstimateInputError("estimate_point_duplicate");
      used.add(point.key);
      nextPoints.push({
        key: point.key,
        value: point.value,
        weight: point.weight,
      });
    } else {
      nextPoints.push({
        key: "",
        value: point.value,
        weight: point.weight,
      });
    }
  }
  for (const point of nextPoints) if (point.key === "") point.key = freshKey();

  const usage = await usageByPoint(
    executor,
    current?.points.map((point) => point.id) ?? [],
  );
  const plan = planEstimateChange({
    fromSystem,
    toSystem,
    current: current?.points ?? [],
    usage,
    next: nextPoints,
  });
  const cycles = await executor
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
      completedAt: cycleTable.completedAt,
    })
    .from(cycleTable)
    .where(eq(cycleTable.projectId, scope.projectId));
  const today = todayUtc(now);
  const activeCycles = cycles
    .filter((cycle) => cycleStatus(cycle, today) === "active")
    .map((cycle) => ({ id: cycle.id, name: cycle.name }));
  const unchanged =
    sameSystem &&
    current !== null &&
    current.points.length === nextPoints.length &&
    current.points.every((point, index) => {
      const next = nextPoints[index];
      return (
        next !== undefined &&
        next.key === point.key &&
        next.value === point.value &&
        next.weight === point.weight
      );
    });
  return {
    preview: { fromSystem, toSystem, plan, activeCycles },
    current,
    nextPoints,
    sameSystem,
    noop: unchanged,
  };
}

export async function previewEstimateChange(
  scope: ProjectRef,
  input: EstimateChangeInput,
  now: Date,
) {
  return (await planChange(db, scope, input, now)).preview;
}

export async function applyEstimateChange(
  scope: ProjectRef,
  input: EstimateChangeInput,
  options: { confirmClear: boolean; now: Date },
  actor: AgileActor,
): Promise<{ applied: boolean; preview: EstimateChangePreview }> {
  return db.transaction(async (tx) => {
    await lockProject(tx, scope.projectId);
    const planned = await planChange(tx, scope, input, options.now);
    const { preview } = planned;
    if (planned.noop) return { applied: false, preview };
    if (preview.plan.clearedItems > 0 && !options.confirmClear)
      throw new EstimateConfirmationError(preview);

    const mappedTo = new Map<string, string | null>();
    let estimateId: string;
    const pointIdByKey = new Map<string, string>();
    if (planned.sameSystem && planned.current) {
      estimateId = planned.current.id;
      const existingByKey = new Map(
        planned.current.points.map((point) => [point.key, point]),
      );
      const kept = new Set<string>();
      for (const [index, next] of planned.nextPoints.entries()) {
        const existing = existingByKey.get(next.key);
        if (existing) {
          kept.add(existing.key);
          pointIdByKey.set(next.key, existing.id);
          await tx
            .update(estimatePointTable)
            .set({
              value: next.value,
              weight: next.weight === null ? null : String(next.weight),
              position: index,
            })
            .where(eq(estimatePointTable.id, existing.id));
        } else {
          const id = createId();
          pointIdByKey.set(next.key, id);
          await tx.insert(estimatePointTable).values({
            id,
            estimateId,
            key: next.key,
            value: next.value,
            weight: next.weight === null ? null : String(next.weight),
            position: index,
          });
        }
      }
      for (const point of planned.current.points) {
        if (kept.has(point.key)) continue;
        // Removed point: archived (history keeps the row), and the items on it are cleared.
        await tx
          .update(estimatePointTable)
          .set({ archivedAt: options.now })
          .where(eq(estimatePointTable.id, point.id));
        mappedTo.set(point.id, null);
      }
    } else {
      estimateId = createId();
      if (planned.current)
        await tx
          .update(estimateTable)
          .set({ active: false, deactivatedAt: options.now })
          .where(eq(estimateTable.id, planned.current.id));
      await tx.insert(estimateTable).values({
        id: estimateId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        system: preview.toSystem,
        active: true,
        createdBy: actor.userId,
      });
      for (const [index, next] of planned.nextPoints.entries()) {
        const id = createId();
        pointIdByKey.set(next.key, id);
        await tx.insert(estimatePointTable).values({
          id,
          estimateId,
          key: next.key,
          value: next.value,
          weight: next.weight === null ? null : String(next.weight),
          position: index,
        });
      }
      for (const entry of preview.plan.mapping)
        mappedTo.set(
          entry.fromPointId,
          entry.toKey ? (pointIdByKey.get(entry.toKey) ?? null) : null,
        );
    }
    for (const entry of preview.plan.mapping) {
      if (planned.sameSystem && entry.toKey !== null) continue;
      const target = mappedTo.get(entry.fromPointId) ?? null;
      await tx
        .update(workItemTable)
        .set({ estimatePointId: target, updatedAt: options.now })
        .where(eq(workItemTable.estimatePointId, entry.fromPointId));
    }
    if (planned.current) {
      await tx.insert(estimateChangeTable).values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        kind: planned.sameSystem ? "scale" : "system",
        fromSystem: preview.fromSystem,
        toSystem: preview.toSystem,
        mappedCount: preview.plan.mappedItems,
        clearedCount: preview.plan.clearedItems,
        actorId: actor.userId,
        changedAt: options.now,
      });
    }
    await auditAgile(tx, {
      action: planned.sameSystem
        ? "estimate.configured"
        : "estimate.system_changed",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      entityType: "estimate",
      entityId: estimateId,
      actor,
      before: {
        system: preview.fromSystem,
        points: planned.current?.points.map((point) => point.value) ?? [],
      },
      after: {
        system: preview.toSystem,
        points: planned.nextPoints.map((point) => point.value),
        mappedItems: preview.plan.mappedItems,
        clearedItems: preview.plan.clearedItems,
      },
    });
    return { applied: true, preview };
  });
}

export class EstimateConfirmationError extends Error {
  constructor(readonly preview: EstimateChangePreview) {
    super("estimate_change_requires_confirmation");
  }
}

export async function recentEstimateChanges(
  executor: Executor,
  projectId: string,
) {
  const rows = await executor
    .select({
      kind: estimateChangeTable.kind,
      fromSystem: estimateChangeTable.fromSystem,
      toSystem: estimateChangeTable.toSystem,
      changedAt: estimateChangeTable.changedAt,
    })
    .from(estimateChangeTable)
    .where(eq(estimateChangeTable.projectId, projectId))
    .orderBy(asc(estimateChangeTable.changedAt));
  return rows.map((row) => ({
    kind: row.kind as "system" | "scale",
    fromSystem: row.fromSystem as EstimateSystem | null,
    toSystem: row.toSystem as EstimateSystem | null,
    changedAt: row.changedAt,
  }));
}

// ---------------------------------------------------------------------------------------------
// The estimate on one work item (ES-2, ES-4)
// ---------------------------------------------------------------------------------------------

export async function setWorkItemEstimate(
  input: {
    workItemId: string;
    projectId: string;
    workspaceId: string;
    estimatePointId: string | null;
  },
  actor: AgileActor,
) {
  return db.transaction(async (tx) => {
    await lockProjectShared(tx, input.projectId);
    const [item] = await tx
      .select({
        id: workItemTable.id,
        key: workItemTable.key,
        estimatePointId: workItemTable.estimatePointId,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.id, input.workItemId),
          eq(workItemTable.projectId, input.projectId),
          isNull(workItemTable.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!item) throw new HTTPException(404, { message: "Work item not found" });
    if (input.estimatePointId !== null) {
      const active = await getActiveEstimate(tx, input.projectId);
      if (!active?.points.some((point) => point.id === input.estimatePointId))
        throw new EstimateInputError("estimate_point_invalid");
    }
    if (item.estimatePointId === input.estimatePointId) return;
    await tx
      .update(workItemTable)
      .set({ estimatePointId: input.estimatePointId, updatedAt: new Date() })
      .where(eq(workItemTable.id, item.id));
    await auditAgile(tx, {
      action: "estimate.work_item_set",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      entityType: "work_item",
      entityId: item.id,
      actor,
      before: { estimatePointId: item.estimatePointId },
      after: { estimatePointId: input.estimatePointId },
    });
  });
}

/** ES-4: the item's own estimate with the roll-up of everything beneath it beside it. */
export async function getWorkItemEstimate(
  executor: Executor,
  input: { workItemId: string; projectId: string },
) {
  const [item] = await executor
    .select({ estimatePointId: workItemTable.estimatePointId })
    .from(workItemTable)
    .where(eq(workItemTable.id, input.workItemId))
    .limit(1);
  const active = await getActiveEstimate(executor, input.projectId);
  const pointsById = new Map(active?.points.map((point) => [point.id, point]));
  const ownPoint = item?.estimatePointId
    ? (pointsById.get(item.estimatePointId) ?? null)
    : null;
  const result = await executor.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT w."id", w."parent_id", w."estimate_point_id", 1 AS depth
      FROM "work_item" w
      WHERE w."parent_id" = ${input.workItemId}
        AND w."deleted_at" IS NULL AND w."archived_at" IS NULL
      UNION ALL
      SELECT w."id", w."parent_id", w."estimate_point_id", t.depth + 1
      FROM "work_item" w JOIN tree t ON w."parent_id" = t."id"
      WHERE w."deleted_at" IS NULL AND w."archived_at" IS NULL AND t.depth < 6
    )
    SELECT "id", "parent_id", "estimate_point_id" FROM tree
  `);
  const nodes = (
    (result as unknown as { rows?: unknown[] }).rows ??
    (result as unknown as unknown[])
  ).map((row) => {
    const r = row as {
      id: string;
      parent_id: string;
      estimate_point_id: string | null;
    };
    return {
      id: r.id,
      parentId: r.parent_id,
      pointId: r.estimate_point_id,
    };
  });
  const childrenOf = new Map<string, typeof nodes>();
  for (const node of nodes) {
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }
  const effectiveOf = (id: string, own: number | null): number | null =>
    rollUpEstimate(
      own,
      (childrenOf.get(id) ?? []).map((child) =>
        effectiveOf(
          child.id,
          child.pointId
            ? (pointsById.get(child.pointId)?.weight ?? null)
            : null,
        ),
      ),
    ).effective;
  const ownWeight = ownPoint?.weight ?? null;
  const rollup = rollUpEstimate(
    ownWeight,
    (childrenOf.get(input.workItemId) ?? []).map((child) =>
      effectiveOf(
        child.id,
        child.pointId ? (pointsById.get(child.pointId)?.weight ?? null) : null,
      ),
    ),
  );
  return {
    estimatePointId: item?.estimatePointId ?? null,
    point: ownPoint,
    rollup,
  };
}

export const getEstimateAndSettings = async (projectId: string) => ({
  estimate: await getActiveEstimate(db, projectId),
  settings: await getAgileSettings(db, projectId),
});
export const getProjectAgileSettings = (projectId: string) =>
  getAgileSettings(db, projectId);
export const getWorkItemEstimateFor = (input: {
  workItemId: string;
  projectId: string;
}) => getWorkItemEstimate(db, input);
