import { createId } from "@paralleldrive/cuid2";
import {
  approvalFreezeWindow,
  type ChangeRiskLevel,
  decideFreeze,
  findChangeConflicts,
  freezesCoveringWindow,
  hasRollbackPlan,
  isChangeRiskLevel,
  isRetrospectiveWindow,
  overrideCovers,
  requiresCabApproval,
} from "@taskdesk/domain";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { StepUpSpender } from "../auth/step-up-spend";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  auditLogTable,
  projectTable,
  stateTable,
  stateTemplateTable,
  userTable,
  workItemTable,
  workItemTypeTable,
} from "../database/schema";
import {
  changeDetailTable,
  changeFreezeTable,
  changeServiceTable,
  releaseTable,
  serviceTable,
} from "../database/schema-p5-service";
import { auditIfRegistered, type GovernanceActor } from "../team/audit";
import { VersionConflictError } from "./common";
import { changeImpactCounts } from "./service-repository";

export type ChangeTarget = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  workspaceId: string;
  isChange: boolean;
  /** SVC-3: the service the work item references, whatever its type. */
  serviceId: string | null;
};

export async function resolveChangeTarget(
  key: string,
  workspaceId: string,
  executor: Executor = db,
): Promise<ChangeTarget | undefined> {
  const [row] = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      projectId: workItemTable.projectId,
      workspaceId: workItemTable.workspaceId,
      isChange: workItemTypeTable.isChange,
      serviceId: workItemTable.serviceId,
    })
    .from(workItemTable)
    .innerJoin(
      workItemTypeTable,
      eq(workItemTypeTable.id, workItemTable.typeId),
    )
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

type FreezeRow = typeof changeFreezeTable.$inferSelect;

function toFreezeLike(row: FreezeRow) {
  return {
    id: row.id,
    start: row.startsAt,
    end: row.endsAt,
    cancelledAt: row.cancelledAt,
    version: row.version,
  };
}

export async function activeFreezesOverlapping(
  executor: Executor,
  workspaceId: string,
  window: { start: Date; end: Date },
): Promise<FreezeRow[]> {
  return executor
    .select()
    .from(changeFreezeTable)
    .where(
      and(
        eq(changeFreezeTable.workspaceId, workspaceId),
        isNull(changeFreezeTable.cancelledAt),
        lt(changeFreezeTable.startsAt, window.end),
        gt(changeFreezeTable.endsAt, window.start),
      ),
    )
    .orderBy(asc(changeFreezeTable.startsAt));
}

async function readDetail(
  executor: Executor,
  workItemId: string,
  lock?: "update" | "share",
) {
  const query = executor
    .select()
    .from(changeDetailTable)
    .where(eq(changeDetailTable.workItemId, workItemId))
    .limit(1);
  const [row] = lock ? await query.for(lock) : await query;
  return row;
}

/** The workflow's pre-approval ceiling: the highest `change_risk_at_most` level on a non-CAB edge. */
async function preApprovalCeiling(
  workItemId: string,
): Promise<ChangeRiskLevel | null> {
  const { loadWorkflowTransitionContext } = await import(
    "../work-item/workflow-transition-context"
  );
  const ctx = await loadWorkflowTransitionContext(workItemId);
  if (!ctx) return null;
  const rank = { low: 0, medium: 1, high: 2 } as const;
  let ceiling: ChangeRiskLevel | null = null;
  for (const transition of ctx.transitions) {
    if (transition.requiresCab) continue;
    for (const guard of transition.guards) {
      if (guard.type !== "change_risk_at_most") continue;
      if (ceiling === null || rank[guard.level] > rank[ceiling])
        ceiling = guard.level;
    }
  }
  return ceiling;
}

export async function getChange(
  target: ChangeTarget,
  options: { reachableProjectIds: readonly string[]; now?: Date },
) {
  const now = options.now ?? new Date();
  const detail = await readDetail(db, target.id);
  const services = detail
    ? await db
        .select({ id: serviceTable.id, name: serviceTable.name })
        .from(changeServiceTable)
        .innerJoin(
          serviceTable,
          eq(serviceTable.id, changeServiceTable.serviceId),
        )
        .where(eq(changeServiceTable.workItemId, target.id))
        .orderBy(asc(serviceTable.name))
    : [];
  const window =
    detail?.windowStart && detail.windowEnd
      ? { start: detail.windowStart, end: detail.windowEnd }
      : null;
  const freezeWindow = approvalFreezeWindow(window, now);
  const covering = await activeFreezesOverlapping(
    db,
    target.workspaceId,
    freezeWindow,
  );
  const freeze = decideFreeze({
    window: freezeWindow,
    freezes: covering.map(toFreezeLike),
    overrideGranted: detail?.freezeOverride ?? false,
    overrideFreezes: detail?.freezeOverrideFreezes ?? [],
  });
  const release = detail?.releaseId
    ? (
        await db
          .select({ id: releaseTable.id, name: releaseTable.name })
          .from(releaseTable)
          .where(eq(releaseTable.id, detail.releaseId))
          .limit(1)
      )[0]
    : undefined;
  const referencedService = target.serviceId
    ? (
        await db
          .select({ id: serviceTable.id, name: serviceTable.name })
          .from(serviceTable)
          .where(
            and(
              eq(serviceTable.id, target.serviceId),
              eq(serviceTable.workspaceId, target.workspaceId),
            ),
          )
          .limit(1)
      )[0]
    : undefined;
  const overrideBy = detail?.freezeOverrideBy
    ? (
        await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, detail.freezeOverrideBy))
          .limit(1)
      )[0]?.name
    : null;
  const conflicts =
    window && services.length > 0
      ? await sameServiceConflicts(target, window, services, options)
      : [];
  return {
    workItemKey: target.key,
    workItemId: target.id,
    title: target.title,
    isChange: target.isChange,
    service: referencedService ?? null,
    impact: await changeImpactCounts(
      db,
      target.workspaceId,
      services.map((service) => service.id),
    ),
    detail: detail
      ? {
          risk: detail.risk,
          windowStart: detail.windowStart,
          windowEnd: detail.windowEnd,
          rollbackPlan: detail.rollbackPlan,
          release: release ?? null,
          version: detail.version,
          updatedAt: detail.updatedAt,
        }
      : null,
    services,
    cabRequired: requiresCabApproval(
      detail?.risk && isChangeRiskLevel(detail.risk) ? detail.risk : null,
      await preApprovalCeiling(target.id),
    ),
    rollbackPlanPresent: hasRollbackPlan(detail?.rollbackPlan),
    retrospective: window ? isRetrospectiveWindow(window, now) : false,
    freeze: {
      blocked: freeze.blocked,
      overridden: !freeze.blocked && freeze.reason === "overridden",
      freezes: covering.map((row) => ({
        id: row.id,
        name: row.name,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      })),
      override:
        detail?.freezeOverride && detail.freezeOverrideAt
          ? {
              reason: detail.freezeOverrideReason,
              by: overrideBy ?? null,
              at: detail.freezeOverrideAt,
            }
          : null,
    },
    conflicts,
  };
}

async function sameServiceConflicts(
  target: ChangeTarget,
  window: { start: Date; end: Date },
  services: { id: string }[],
  options: { reachableProjectIds: readonly string[] },
) {
  if (options.reachableProjectIds.length === 0) return [];
  const rows = await db
    .select({
      key: workItemTable.key,
      title: workItemTable.title,
      windowStart: changeDetailTable.windowStart,
      windowEnd: changeDetailTable.windowEnd,
      serviceId: changeServiceTable.serviceId,
    })
    .from(changeDetailTable)
    .innerJoin(
      workItemTable,
      eq(workItemTable.id, changeDetailTable.workItemId),
    )
    .innerJoin(
      changeServiceTable,
      eq(changeServiceTable.workItemId, changeDetailTable.workItemId),
    )
    .where(
      and(
        eq(changeDetailTable.workspaceId, target.workspaceId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        inArray(workItemTable.projectId, [...options.reachableProjectIds]),
        sql`${workItemTable.id} <> ${target.id}`,
        inArray(
          changeServiceTable.serviceId,
          services.map((service) => service.id),
        ),
        lt(changeDetailTable.windowStart, window.end),
        gt(changeDetailTable.windowEnd, window.start),
      ),
    );
  const byKey = new Map<
    string,
    { key: string; title: string; serviceIds: string[] }
  >();
  for (const row of rows) {
    const entry = byKey.get(row.key) ?? {
      key: row.key,
      title: row.title,
      serviceIds: [],
    };
    entry.serviceIds.push(row.serviceId);
    byKey.set(row.key, entry);
  }
  return [...byKey.values()];
}

export async function patchChange(
  target: ChangeTarget,
  input: {
    risk?: ChangeRiskLevel | null;
    windowStart?: Date | null;
    windowEnd?: Date | null;
    rollbackPlan?: string | null;
    serviceIds?: string[];
    releaseId?: string | null;
    version?: number;
  },
  actor: GovernanceActor,
) {
  if (!target.isChange)
    throw new HTTPException(422, { message: "not_a_change" });
  await db.transaction(async (tx) => {
    let before = await readDetail(tx, target.id, "update");
    if (!before) {
      await tx
        .insert(changeDetailTable)
        .values({ workItemId: target.id, workspaceId: target.workspaceId })
        .onConflictDoNothing();
      before = await readDetail(tx, target.id, "update");
    }
    if (!before) throw new HTTPException(404, { message: "Change not found" });
    if (input.version !== undefined && before.version !== input.version)
      throw new VersionConflictError(before.version);

    const windowStart =
      input.windowStart !== undefined ? input.windowStart : before.windowStart;
    const windowEnd =
      input.windowEnd !== undefined ? input.windowEnd : before.windowEnd;
    if ((windowStart === null) !== (windowEnd === null))
      throw new HTTPException(422, {
        message: "Set both the window start and end, or neither",
      });
    if (windowStart && windowEnd && windowEnd <= windowStart)
      throw new HTTPException(422, {
        message: "The window must end after it starts",
      });
    const windowChanged =
      windowStart?.getTime() !== before.windowStart?.getTime() ||
      windowEnd?.getTime() !== before.windowEnd?.getTime();

    // CH-4: an approved change (approved_at, read under this row lock, so it cannot race the
    // approving transition and survives moving on to In progress) may not be planned into an
    // active freeze unless a standing step-up override names exactly that freeze.
    const approved = before.approvedAt !== null;
    if (approved && windowChanged && windowStart && windowEnd) {
      const covering = await activeFreezesOverlapping(tx, target.workspaceId, {
        start: windowStart,
        end: windowEnd,
      });
      const decision = decideFreeze({
        window: { start: windowStart, end: windowEnd },
        freezes: covering.map(toFreezeLike),
        overrideGranted: before.freezeOverride,
        overrideFreezes: before.freezeOverrideFreezes,
      });
      if (decision.blocked)
        throw new HTTPException(409, { message: "change.frozen" });
    }

    if (input.releaseId) {
      const [release] = await tx
        .select({ id: releaseTable.id })
        .from(releaseTable)
        .where(
          and(
            eq(releaseTable.id, input.releaseId),
            eq(releaseTable.workspaceId, target.workspaceId),
          ),
        )
        .limit(1);
      if (!release)
        throw new HTTPException(422, { message: "release_not_found" });
    }
    if (input.serviceIds) {
      const unique = [...new Set(input.serviceIds)];
      if (unique.length > 0) {
        const found = await tx
          .select({ id: serviceTable.id })
          .from(serviceTable)
          .where(
            and(
              eq(serviceTable.workspaceId, target.workspaceId),
              inArray(serviceTable.id, unique),
            ),
          );
        if (found.length !== unique.length)
          throw new HTTPException(422, { message: "service_not_found" });
      }
      await tx
        .delete(changeServiceTable)
        .where(eq(changeServiceTable.workItemId, target.id));
      if (unique.length > 0)
        await tx.insert(changeServiceTable).values(
          unique.map((serviceId) => ({
            workspaceId: target.workspaceId,
            workItemId: target.id,
            serviceId,
          })),
        );
    }
    await tx
      .update(changeDetailTable)
      .set({
        risk: input.risk !== undefined ? input.risk : before.risk,
        windowStart,
        windowEnd,
        rollbackPlan:
          input.rollbackPlan !== undefined
            ? input.rollbackPlan
            : before.rollbackPlan,
        releaseId:
          input.releaseId !== undefined ? input.releaseId : before.releaseId,
        updatedBy: actor.userId,
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(changeDetailTable.workItemId, target.id));
    await auditIfRegistered(tx, {
      action: "change.updated",
      workspaceId: target.workspaceId,
      entityType: "work_item",
      entityId: target.id,
      actor,
      before: {
        risk: before.risk,
        windowStart: before.windowStart?.toISOString() ?? null,
        windowEnd: before.windowEnd?.toISOString() ?? null,
        rollbackPlanPresent: hasRollbackPlan(before.rollbackPlan),
        releaseId: before.releaseId,
      },
      after: {
        changedFields: Object.keys(input).filter((key) => key !== "version"),
      },
    });
  });
}

export type FreezeOverrideSpend = StepUpSpender;

/**
 * CH-4: record the freeze override on a change, in one transaction with the proof's consumption
 * and a prominent audit row. An override is freeze-scoped: it records WHICH freezes (id + version)
 * it covers, namely the active freezes covering the change's current window (or now, for an
 * unplanned change) and, when `window` is given, the freezes covering that PROPOSED window, so a
 * change can be cleared for a future freeze before it is planned into it. Any other freeze, or one
 * edited since, still blocks. Refuses when there is nothing new to override so a proof is never
 * spent on a no-op.
 */
export async function grantFreezeOverride(input: {
  target: ChangeTarget;
  reason: string;
  window?: { start: Date; end: Date } | null;
  actor: GovernanceActor;
  spend: FreezeOverrideSpend;
}) {
  const { target, actor } = input;
  if (!target.isChange)
    throw new HTTPException(422, { message: "not_a_change" });
  if (input.window && input.window.end <= input.window.start)
    throw new HTTPException(422, {
      message: "The window must end after it starts",
    });
  await db.transaction(async (tx) => {
    const detail = await readDetail(tx, target.id, "update");
    if (!detail) throw new HTTPException(404, { message: "Change not found" });
    // CH-4: a change without a window is held against the freezes covering now.
    const freezeWindow = approvalFreezeWindow(
      detail.windowStart && detail.windowEnd
        ? { start: detail.windowStart, end: detail.windowEnd }
        : null,
      new Date(),
    );
    const windows = input.window
      ? [freezeWindow, input.window]
      : [freezeWindow];
    const byId = new Map<string, FreezeRow>();
    for (const window of windows)
      for (const row of await activeFreezesOverlapping(
        tx,
        target.workspaceId,
        window,
      ))
        byId.set(row.id, row);
    const covering = [...byId.values()].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    if (covering.length === 0)
      throw new HTTPException(409, { message: "no_freeze_to_override" });
    const priorEntries = detail.freezeOverride
      ? detail.freezeOverrideFreezes
      : [];
    if (
      covering.every((row) =>
        overrideCovers(detail.freezeOverride, priorEntries, toFreezeLike(row)),
      )
    )
      throw new HTTPException(409, { message: "already_overridden" });
    await input.spend(tx);
    // Keep the prior entries that still hold (their freeze exists, is active and is unedited);
    // the freezes covered now replace or join them.
    const priorIds = priorEntries.map((entry) => entry.id);
    const priorRows =
      priorIds.length === 0
        ? []
        : await tx
            .select()
            .from(changeFreezeTable)
            .where(
              and(
                eq(changeFreezeTable.workspaceId, target.workspaceId),
                isNull(changeFreezeTable.cancelledAt),
                inArray(changeFreezeTable.id, priorIds),
              ),
            );
    const kept = priorEntries.filter((entry) =>
      priorRows.some(
        (row) => row.id === entry.id && row.version === entry.version,
      ),
    );
    const entries = new Map(kept.map((entry) => [entry.id, entry]));
    // The freezes this grant newly covers (the audit lists these; `coveredFreezeIds` is the lot).
    const newlyCovered = covering.filter(
      (row) =>
        !overrideCovers(detail.freezeOverride, priorEntries, toFreezeLike(row)),
    );
    for (const row of covering)
      entries.set(row.id, { id: row.id, version: row.version });
    const at = new Date();
    await tx
      .update(changeDetailTable)
      .set({
        freezeOverride: true,
        freezeOverrideReason: input.reason,
        freezeOverrideBy: actor.userId,
        freezeOverrideAt: at,
        freezeOverrideFreezes: [...entries.values()],
        updatedBy: actor.userId,
        version: detail.version + 1,
        updatedAt: at,
      })
      .where(eq(changeDetailTable.workItemId, target.id));
    await auditIfRegistered(tx, {
      action: "change.freeze_overridden",
      workspaceId: target.workspaceId,
      entityType: "work_item",
      entityId: target.id,
      actor,
      before: {
        freezeOverride: detail.freezeOverride,
        freezeIds: priorEntries.map((entry) => entry.id),
        freezeVersions: priorEntries,
      },
      after: {
        freezeOverride: true,
        workItemKey: target.key,
        reason: input.reason,
        freezeIds: newlyCovered.map((row) => row.id),
        freezeNames: newlyCovered.map((row) => row.name),
        freezeVersions: newlyCovered.map((row) => ({
          id: row.id,
          version: row.version,
        })),
        coveredFreezeIds: [...entries.keys()],
        windowStart: detail.windowStart?.toISOString() ?? null,
        windowEnd: detail.windowEnd?.toISOString() ?? null,
        proposedWindowStart: input.window?.start.toISOString() ?? null,
        proposedWindowEnd: input.window?.end.toISOString() ?? null,
      },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Freezes

export async function listFreezes(
  workspaceId: string,
  includeCancelled: boolean,
) {
  return db
    .select()
    .from(changeFreezeTable)
    .where(
      and(
        eq(changeFreezeTable.workspaceId, workspaceId),
        includeCancelled ? undefined : isNull(changeFreezeTable.cancelledAt),
      ),
    )
    .orderBy(asc(changeFreezeTable.startsAt), asc(changeFreezeTable.id));
}

/**
 * Changes whose window overlaps the range. A freeze declared or edited now post-dates every
 * existing override, so it blocks overridden changes too.
 */
async function countAffectedChanges(
  executor: Executor,
  workspaceId: string,
  range: { start: Date; end: Date },
) {
  const rows = await executor
    .select({ id: changeDetailTable.workItemId })
    .from(changeDetailTable)
    .innerJoin(
      workItemTable,
      eq(workItemTable.id, changeDetailTable.workItemId),
    )
    .where(
      and(
        eq(changeDetailTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
        lt(changeDetailTable.windowStart, range.end),
        gt(changeDetailTable.windowEnd, range.start),
      ),
    );
  return rows.length;
}

export async function createFreeze(input: {
  workspaceId: string;
  name: string;
  reason?: string | null;
  startsAt: Date;
  endsAt: Date;
  actor: GovernanceActor;
}) {
  return db.transaction(async (tx) => {
    const id = createId();
    await tx.insert(changeFreezeTable).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      reason: input.reason ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdBy: input.actor.userId,
    });
    const affected = await countAffectedChanges(tx, input.workspaceId, {
      start: input.startsAt,
      end: input.endsAt,
    });
    await auditIfRegistered(tx, {
      action: "change_freeze.created",
      workspaceId: input.workspaceId,
      entityType: "change_freeze",
      entityId: id,
      actor: input.actor,
      after: {
        name: input.name,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        affectedChanges: affected,
      },
    });
    const [row] = await tx
      .select()
      .from(changeFreezeTable)
      .where(eq(changeFreezeTable.id, id));
    return { freeze: row as FreezeRow, affectedChanges: affected };
  });
}

export async function getFreezeWorkspace(id: string) {
  const [row] = await db
    .select({ workspaceId: changeFreezeTable.workspaceId })
    .from(changeFreezeTable)
    .where(eq(changeFreezeTable.id, id))
    .limit(1);
  return row;
}

export async function updateFreeze(
  id: string,
  workspaceId: string,
  input: {
    name?: string;
    reason?: string | null;
    startsAt?: Date;
    endsAt?: Date;
    cancel?: true;
    version?: number;
  },
  actor: GovernanceActor,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(changeFreezeTable)
      .where(
        and(
          eq(changeFreezeTable.id, id),
          eq(changeFreezeTable.workspaceId, workspaceId),
        ),
      )
      .for("update")
      .limit(1);
    if (!before) return undefined;
    if (input.version !== undefined && before.version !== input.version)
      throw new VersionConflictError(before.version);
    if (before.cancelledAt)
      throw new HTTPException(409, { message: "freeze_cancelled" });
    const startsAt = input.startsAt ?? before.startsAt;
    const endsAt = input.endsAt ?? before.endsAt;
    if (endsAt <= startsAt)
      throw new HTTPException(422, {
        message: "The freeze must end after it starts",
      });
    const now = new Date();
    await tx
      .update(changeFreezeTable)
      .set({
        name: input.name ?? before.name,
        reason: input.reason !== undefined ? input.reason : before.reason,
        startsAt,
        endsAt,
        ...(input.cancel
          ? { cancelledAt: now, cancelledBy: actor.userId }
          : {}),
        version: before.version + 1,
        updatedAt: now,
      })
      .where(eq(changeFreezeTable.id, id));
    const affected = input.cancel
      ? 0
      : await countAffectedChanges(tx, workspaceId, {
          start: startsAt,
          end: endsAt,
        });
    await auditIfRegistered(tx, {
      action: input.cancel
        ? "change_freeze.cancelled"
        : "change_freeze.updated",
      workspaceId,
      entityType: "change_freeze",
      entityId: id,
      actor,
      before: {
        name: before.name,
        startsAt: before.startsAt.toISOString(),
        endsAt: before.endsAt.toISOString(),
      },
      after: {
        name: input.name ?? before.name,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        affectedChanges: affected,
      },
    });
    const [row] = await tx
      .select()
      .from(changeFreezeTable)
      .where(eq(changeFreezeTable.id, id));
    return { freeze: row as FreezeRow, affectedChanges: affected };
  });
}

/** The prominent audit report of freeze overrides (edge case: appears in a prominent audit report). */
export async function listFreezeOverrides(
  workspaceId: string,
  reachableProjectIds: readonly string[],
  limit = 100,
) {
  if (reachableProjectIds.length === 0) return [];
  const rows = await db
    .select({
      id: auditLogTable.id,
      createdAt: auditLogTable.createdAt,
      actorId: auditLogTable.actorId,
      actorName: userTable.name,
      after: auditLogTable.after,
    })
    .from(auditLogTable)
    .leftJoin(userTable, eq(userTable.id, auditLogTable.actorId))
    // Only overrides of changes in projects the caller reaches (the audit row's entity is the
    // work item).
    .innerJoin(workItemTable, eq(workItemTable.id, auditLogTable.entityId))
    .where(
      and(
        eq(auditLogTable.workspaceId, workspaceId),
        eq(auditLogTable.action, "change.freeze_overridden"),
        inArray(workItemTable.projectId, [...reachableProjectIds]),
      ),
    )
    .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
    .limit(limit);
  return rows.map((row) => {
    const after = (row.after ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      at: row.createdAt,
      actorName: row.actorName ?? null,
      workItemKey:
        typeof after.workItemKey === "string" ? after.workItemKey : null,
      reason: typeof after.reason === "string" ? after.reason : null,
      freezeNames: Array.isArray(after.freezeNames)
        ? (after.freezeNames as unknown[]).filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Calendar

export async function changeCalendar(input: {
  workspaceId: string;
  from: Date;
  to: Date;
  reachableProjectIds: readonly string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const freezes = await db
    .select()
    .from(changeFreezeTable)
    .where(
      and(
        eq(changeFreezeTable.workspaceId, input.workspaceId),
        isNull(changeFreezeTable.cancelledAt),
        lt(changeFreezeTable.startsAt, input.to),
        gt(changeFreezeTable.endsAt, input.from),
      ),
    )
    .orderBy(asc(changeFreezeTable.startsAt));
  const rows =
    input.reachableProjectIds.length === 0
      ? []
      : await db
          .select({
            id: workItemTable.id,
            key: workItemTable.key,
            title: workItemTable.title,
            projectId: workItemTable.projectId,
            projectName: projectTable.name,
            windowStart: changeDetailTable.windowStart,
            windowEnd: changeDetailTable.windowEnd,
            risk: changeDetailTable.risk,
            freezeOverride: changeDetailTable.freezeOverride,
            freezeOverrideFreezes: changeDetailTable.freezeOverrideFreezes,
            stateName: stateTemplateTable.name,
            stateGroup: stateTemplateTable.group,
          })
          .from(changeDetailTable)
          .innerJoin(
            workItemTable,
            eq(workItemTable.id, changeDetailTable.workItemId),
          )
          .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
          .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
          .innerJoin(
            stateTemplateTable,
            eq(stateTemplateTable.id, stateTable.stateTemplateId),
          )
          .where(
            and(
              eq(changeDetailTable.workspaceId, input.workspaceId),
              isNull(workItemTable.deletedAt),
              isNull(workItemTable.archivedAt),
              inArray(workItemTable.projectId, [...input.reachableProjectIds]),
              lt(changeDetailTable.windowStart, input.to),
              gt(changeDetailTable.windowEnd, input.from),
            ),
          )
          .orderBy(asc(changeDetailTable.windowStart), asc(workItemTable.key));
  const ids = rows.map((row) => row.id);
  const serviceRows =
    ids.length === 0
      ? []
      : await db
          .select({
            workItemId: changeServiceTable.workItemId,
            serviceId: serviceTable.id,
            serviceName: serviceTable.name,
          })
          .from(changeServiceTable)
          .innerJoin(
            serviceTable,
            eq(serviceTable.id, changeServiceTable.serviceId),
          )
          .where(inArray(changeServiceTable.workItemId, ids));
  const servicesByChange = new Map<string, { id: string; name: string }[]>();
  for (const row of serviceRows) {
    const list = servicesByChange.get(row.workItemId) ?? [];
    list.push({ id: row.serviceId, name: row.serviceName });
    servicesByChange.set(row.workItemId, list);
  }
  const planned = rows.flatMap((row) =>
    row.windowStart && row.windowEnd
      ? [
          {
            id: row.id,
            window: { start: row.windowStart, end: row.windowEnd },
            serviceIds: (servicesByChange.get(row.id) ?? []).map((s) => s.id),
          },
        ]
      : [],
  );
  const conflicts = findChangeConflicts(planned);
  const conflicted = new Set(
    conflicts.flatMap((conflict) => conflict.changeIds),
  );
  const freezeLike = freezes.map(toFreezeLike);
  const keyOf = new Map(rows.map((row) => [row.id, row.key]));
  return {
    from: input.from,
    to: input.to,
    freezes: freezes.map((row) => ({
      id: row.id,
      name: row.name,
      reason: row.reason,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
    changes: rows.flatMap((row) => {
      if (!row.windowStart || !row.windowEnd) return [];
      const window = { start: row.windowStart, end: row.windowEnd };
      const covering = freezesCoveringWindow(window, freezeLike);
      const decision = decideFreeze({
        window,
        freezes: freezeLike,
        overrideGranted: row.freezeOverride,
        overrideFreezes: row.freezeOverrideFreezes,
      });
      return [
        {
          key: row.key,
          title: row.title,
          projectId: row.projectId,
          projectName: row.projectName,
          windowStart: row.windowStart,
          windowEnd: row.windowEnd,
          risk: row.risk,
          stateName: row.stateName,
          stateGroup: row.stateGroup,
          services: servicesByChange.get(row.id) ?? [],
          retrospective: isRetrospectiveWindow(window, now),
          frozen: decision.blocked,
          overridden: covering.length > 0 && !decision.blocked,
          conflict: conflicted.has(row.id),
        },
      ];
    }),
    conflicts: conflicts.map((conflict) => ({
      changeKeys: conflict.changeIds.map((id) => keyOf.get(id) ?? id),
      serviceIds: conflict.serviceIds,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Workflow transition integration

export type ChangeTransitionFacts = {
  /** The change's risk, or null when unset or when there is no change detail. */
  risk: ChangeRiskLevel | null;
  /** Satellite keys for `field_required` guards (`change.rollback_plan`), only when present. */
  fieldValues: Record<string, string>;
  window: { start: Date; end: Date } | null;
  overrideGranted: boolean;
  overrideFreezes: { id: string; version: number }[];
  rollbackPlanPresent: boolean;
  /** The change's work item id, so an approving transition can persist the approval. */
  workItemId: string;
  /**
   * True when the facts were read under the transition's row lock (the write path). Only then
   * does a passing approval gate persist `approved_at`; the read-only listing stays pure.
   */
  locked: boolean;
};

export async function loadChangeTransitionFacts(
  executor: Executor,
  workItemId: string,
  options: { lock?: boolean } = {},
): Promise<ChangeTransitionFacts> {
  const detail = await readDetail(
    executor,
    workItemId,
    options.lock ? "share" : undefined,
  );
  const rollbackPlanPresent = hasRollbackPlan(detail?.rollbackPlan);
  return {
    risk: detail?.risk && isChangeRiskLevel(detail.risk) ? detail.risk : null,
    fieldValues: rollbackPlanPresent
      ? { "change.rollback_plan": (detail?.rollbackPlan ?? "").trim() }
      : {},
    window:
      detail?.windowStart && detail.windowEnd
        ? { start: detail.windowStart, end: detail.windowEnd }
        : null,
    overrideGranted: detail?.freezeOverride ?? false,
    overrideFreezes: detail?.freezeOverrideFreezes ?? [],
    rollbackPlanPresent,
    workItemId,
    locked: options.lock === true,
  };
}

export type ChangeGateBlock = {
  kind: "change";
  reasonCode: "change.rollback_plan_missing" | "change.frozen";
};

/**
 * CH-4 and CH-6, unconditionally on the CAB-gated approval transition of a change: a rollback
 * plan must exist and the window must not overlap an active freeze unless overridden. Whether
 * the guard also appears in a workflow's `guards` list is irrelevant to this check.
 */
export async function changeGateBlocks(
  executor: Executor,
  workspaceId: string,
  facts: ChangeTransitionFacts,
  now: Date = new Date(),
): Promise<ChangeGateBlock[]> {
  const blocks: ChangeGateBlock[] = [];
  if (!facts.rollbackPlanPresent)
    blocks.push({ kind: "change", reasonCode: "change.rollback_plan_missing" });
  // CH-4 has no exemption for a change without a window: it is held against the freezes
  // covering now, and the same step-up override clears it.
  const window = approvalFreezeWindow(facts.window, now);
  const overlapping = await activeFreezesOverlapping(
    executor,
    workspaceId,
    window,
  );
  const decision = decideFreeze({
    window,
    freezes: overlapping.map(toFreezeLike),
    overrideGranted: facts.overrideGranted,
    overrideFreezes: facts.overrideFreezes,
  });
  if (decision.blocked)
    blocks.push({ kind: "change", reasonCode: "change.frozen" });
  // CH-4: persist the approval once the gates pass on the locked write path (same transaction as
  // the state write, so a failed transition rolls it back). Approval is `approved_at`, not the
  // current state: it holds while the change moves on, and any later approving edge is gated
  // again. It is deliberately never cleared on a move back to an earlier state: a change that was
  // approved stays under the stricter freeze check on its window.
  if (blocks.length === 0 && facts.locked)
    await executor
      .update(changeDetailTable)
      .set({ approvedAt: now })
      .where(
        and(
          eq(changeDetailTable.workItemId, facts.workItemId),
          isNull(changeDetailTable.approvedAt),
        ),
      );
  return blocks;
}

/**
 * CH-4: a cross-project move can map a change straight into the destination state of an approving
 * edge (its workflow's CAB or risk-guarded pre-approval edge) without ever taking that edge, which
 * would leave `approved_at` null and the PATCH freeze gate skipped. Call it inside the move
 * transaction AFTER the state write, only while the service catalogue is on (with the catalogue
 * off `approved_at` is not maintained anywhere, so the move leaves it alone too). Items whose new
 * state is not an approving-edge target, non-change items and already approved changes are untouched.
 */
export async function markApprovedOnMove(
  executor: Executor,
  workItemIds: readonly string[],
  now: Date,
): Promise<void> {
  if (workItemIds.length === 0) return;
  // Upsert: a change that never had its detail edited has no row yet (a transition cannot reach
  // an approving edge without one, because the rollback plan lives there; a move can).
  await executor.execute(sql`
    INSERT INTO change_detail (work_item_id, workspace_id, approved_at)
    SELECT w.id, w.workspace_id, ${now.toISOString()}::timestamptz
    FROM work_item w
    JOIN work_item_type t ON t.id = w.type_id
    JOIN workflow wf ON wf.id = t.workflow_id
    JOIN state s ON s.id = w.state_id
    WHERE w.id = ANY(${sql.param([...workItemIds])}::text[])
      AND t.is_change = true
      AND EXISTS (
        SELECT 1 FROM workflow_transition tr
        WHERE tr.version_id = wf.active_version_id
          AND tr.to_state_template_id = s.state_template_id
          AND (tr.requires_cab OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(tr.guards) g
            WHERE g->>'type' = 'change_risk_at_most'))
      )
    ON CONFLICT (work_item_id) DO UPDATE
      SET approved_at = COALESCE(change_detail.approved_at, EXCLUDED.approved_at)
  `);
}
