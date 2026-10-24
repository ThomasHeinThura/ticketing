import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  personTable,
  projectTable,
  userTable,
  workItemTable,
  workspaceUserTable,
} from "../database/schema";
import {
  availableHoursTable,
  costEntryTable,
  costTypeTable,
} from "../database/schema-p5-time";
import { openHoldOver } from "../utils/legal-hold-scope";
import { lockLegalHolds } from "../utils/workspace-legal-hold";
import { auditTime, type TimeActor } from "./audit";
import { evaluateBudgetThresholds } from "./budget-notify";
import { costEntryAmountMinor, resolveCostRate } from "./cost-logic";
import {
  assertTrackingEnabledForProject,
  COST_TRACKING_FEATURE_KEY,
  TIME_TRACKING_FEATURE_KEY,
} from "./feature";
import { checkEntryDate } from "./logic";
import {
  backdateLimitDays,
  callerClock,
  isUniqueViolation,
  itemVisible,
  loadReachableProject,
  loadTimePerson,
  loadWorkItemTarget,
  one,
  projectReach,
} from "./repository";

// ---------------------------------------------------------------------------------------------
// Cost types (TC-12)
// ---------------------------------------------------------------------------------------------

export type CostTypeRow = {
  id: string;
  workspaceId: string;
  name: string;
  unit: string;
  defaultRateMinor: number | null;
  currency: string;
  billable: boolean;
  archived: boolean;
};

function costTypeRow(row: typeof costTypeTable.$inferSelect): CostTypeRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    unit: row.unit,
    defaultRateMinor: row.defaultRateMinor,
    currency: row.currency,
    billable: row.billable,
    archived: row.archivedAt !== null,
  };
}

export async function listCostTypes(
  workspaceId: string,
  includeArchived: boolean,
  executor: Executor = db,
): Promise<CostTypeRow[]> {
  const rows = await executor
    .select()
    .from(costTypeTable)
    .where(
      and(
        eq(costTypeTable.workspaceId, workspaceId),
        includeArchived ? undefined : isNull(costTypeTable.archivedAt),
      ),
    )
    .orderBy(asc(costTypeTable.name));
  return rows.map(costTypeRow);
}

export async function createCostType(input: {
  workspaceId: string;
  name: string;
  unit: string;
  defaultRateMinor: number | null;
  currency: string;
  billable: boolean;
  actor: TimeActor;
}): Promise<CostTypeRow> {
  try {
    return await db.transaction(async (tx) => {
      const row = one(
        (
          await tx
            .insert(costTypeTable)
            .values({
              workspaceId: input.workspaceId,
              name: input.name,
              unit: input.unit,
              defaultRateMinor: input.defaultRateMinor,
              currency: input.currency,
              billable: input.billable,
            })
            .returning()
        )[0],
      );
      // The default rate is a price: the audit row records that one was set, never its amount.
      await auditTime(tx, {
        action: "cost_type.created",
        workspaceId: input.workspaceId,
        entityType: "cost_type",
        entityId: row.id,
        actor: input.actor,
        after: {
          name: row.name,
          unit: row.unit,
          currency: row.currency,
          billable: row.billable,
          hasDefaultRate: row.defaultRateMinor !== null,
        },
      });
      return costTypeRow(row);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new HTTPException(409, {
        message: "A cost type with this name already exists",
      });
    throw error;
  }
}

export async function updateCostType(
  id: string,
  workspaceId: string,
  changes: {
    name?: string;
    unit?: string;
    defaultRateMinor?: number | null;
    currency?: string;
    billable?: boolean;
    archived?: boolean;
  },
  actor: TimeActor,
): Promise<CostTypeRow | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(costTypeTable)
        .where(
          and(
            eq(costTypeTable.id, id),
            eq(costTypeTable.workspaceId, workspaceId),
          ),
        )
        .for("update");
      if (!before) return undefined;
      const row = one(
        (
          await tx
            .update(costTypeTable)
            .set({
              name: changes.name ?? before.name,
              unit: changes.unit ?? before.unit,
              defaultRateMinor:
                changes.defaultRateMinor === undefined
                  ? before.defaultRateMinor
                  : changes.defaultRateMinor,
              currency: changes.currency ?? before.currency,
              billable: changes.billable ?? before.billable,
              archivedAt:
                changes.archived === undefined
                  ? before.archivedAt
                  : changes.archived
                    ? (before.archivedAt ?? new Date())
                    : null,
            })
            .where(eq(costTypeTable.id, id))
            .returning()
        )[0],
      );
      await auditTime(tx, {
        action: "cost_type.updated",
        workspaceId,
        entityType: "cost_type",
        entityId: id,
        actor,
        before: {
          name: before.name,
          unit: before.unit,
          currency: before.currency,
          billable: before.billable,
          archived: before.archivedAt !== null,
        },
        after: {
          name: row.name,
          unit: row.unit,
          currency: row.currency,
          billable: row.billable,
          archived: row.archivedAt !== null,
          defaultRateChanged:
            changes.defaultRateMinor !== undefined &&
            changes.defaultRateMinor !== before.defaultRateMinor,
        },
      });
      return costTypeRow(row);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new HTTPException(409, {
        message: "A cost type with this name already exists",
      });
    throw error;
  }
}

async function requireActiveCostType(
  executor: Executor,
  workspaceId: string,
  id: string,
) {
  const [row] = await executor
    .select()
    .from(costTypeTable)
    .where(
      and(eq(costTypeTable.id, id), eq(costTypeTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!row || row.archivedAt !== null)
    throw new HTTPException(422, { message: "cost_type_unavailable" });
  return row;
}

// ---------------------------------------------------------------------------------------------
// Cost entries (TC-13, TC-14)
// ---------------------------------------------------------------------------------------------

const entryColumns = (identity: ResolvedIdentity, executor: Executor) => ({
  id: costEntryTable.id,
  workspaceId: costEntryTable.workspaceId,
  projectId: costEntryTable.projectId,
  workItemId: costEntryTable.workItemId,
  workItemKey: sql<
    string | null
  >`CASE WHEN ${itemVisible(identity, executor)} THEN ${workItemTable.key} END`,
  workItemTitle: sql<
    string | null
  >`CASE WHEN ${itemVisible(identity, executor)} THEN ${workItemTable.title} END`,
  costTypeId: costEntryTable.costTypeId,
  costTypeName: costTypeTable.name,
  unit: costTypeTable.unit,
  personId: costEntryTable.personId,
  personName: sql<
    string | null
  >`coalesce(${personTable.displayName}, ${userTable.name})`,
  date: costEntryTable.date,
  units: costEntryTable.units,
  rateMinor: costEntryTable.rateMinor,
  amountMinor: costEntryTable.amountMinor,
  currency: costEntryTable.currency,
  billable: costEntryTable.billable,
  note: costEntryTable.note,
  createdAt: costEntryTable.createdAt,
  updatedAt: costEntryTable.updatedAt,
});

function selectCostEntries(identity: ResolvedIdentity, executor: Executor) {
  return executor
    .select(entryColumns(identity, executor))
    .from(costEntryTable)
    .innerJoin(projectTable, eq(projectTable.id, costEntryTable.projectId))
    .innerJoin(personTable, eq(personTable.id, costEntryTable.personId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .innerJoin(costTypeTable, eq(costTypeTable.id, costEntryTable.costTypeId))
    .leftJoin(workItemTable, eq(workItemTable.id, costEntryTable.workItemId));
}

export type CostEntryRow = Awaited<
  ReturnType<typeof selectCostEntries>
>[number];

export async function listCostEntries(
  identity: ResolvedIdentity,
  filter: {
    workspaceId: string;
    projectId: string;
    workItemId?: string;
    from?: string;
    to?: string;
  },
  executor: Executor = db,
): Promise<CostEntryRow[]> {
  return selectCostEntries(identity, executor)
    .where(
      and(
        eq(costEntryTable.workspaceId, filter.workspaceId),
        eq(costEntryTable.projectId, filter.projectId),
        projectReach(identity, executor),
        // TC-7: a work item's cost rolls up from its sub-items.
        filter.workItemId
          ? sql`${costEntryTable.workItemId} IN ${descendantIds(filter.workspaceId, filter.workItemId)}`
          : undefined,
        filter.from ? gte(costEntryTable.date, filter.from) : undefined,
        filter.to ? lte(costEntryTable.date, filter.to) : undefined,
      ),
    )
    .orderBy(
      desc(costEntryTable.date),
      desc(costEntryTable.createdAt),
      desc(costEntryTable.id),
    )
    .limit(2000);
}

export async function getCostEntry(
  identity: ResolvedIdentity,
  id: string,
  executor: Executor = db,
): Promise<CostEntryRow | undefined> {
  const [row] = await selectCostEntries(identity, executor).where(
    and(eq(costEntryTable.id, id), projectReach(identity, executor)),
  );
  return row;
}

/** Facts the route middleware needs before reach and capability: workspace and project of the row. */
export async function getCostEntryScope(id: string, executor: Executor = db) {
  const [row] = await executor
    .select({
      id: costEntryTable.id,
      workspaceId: costEntryTable.workspaceId,
      projectId: costEntryTable.projectId,
      personId: costEntryTable.personId,
    })
    .from(costEntryTable)
    .where(eq(costEntryTable.id, id))
    .limit(1);
  return row;
}

async function assertBackdateWindow(
  tx: Executor,
  workspaceId: string,
  personId: string,
  date: string,
  canLogBackdated: boolean,
) {
  const clock = await callerClock(tx, personId);
  const failure = checkEntryDate({
    date,
    today: clock.today,
    limitDays: await backdateLimitDays(tx, workspaceId),
    canLogBackdated,
  });
  if (failure)
    throw new HTTPException(422, {
      message: failure === "future" ? "date_in_future" : "date_too_old",
    });
}

export async function createCostEntry(input: {
  identity: ResolvedIdentity;
  actor: TimeActor;
  workspaceId: string;
  projectId: string;
  workItemId?: string;
  costTypeId: string;
  personId: string;
  date: string;
  units: number;
  rateMinor?: number;
  currency?: string;
  billable?: boolean;
  note?: string;
  canLogBackdated: boolean;
}): Promise<string> {
  return db.transaction(async (tx) => {
    const project = await loadReachableProject(
      tx,
      input.identity,
      input.projectId,
    );
    if (
      !project ||
      project.workspaceId !== input.workspaceId ||
      project.archivedAt !== null
    )
      throw new HTTPException(404, { message: "Project not found" });
    await assertTrackingEnabledForProject(
      input.workspaceId,
      input.projectId,
      TIME_TRACKING_FEATURE_KEY,
      COST_TRACKING_FEATURE_KEY,
    );
    let workItemKey: string | null = null;
    if (input.workItemId) {
      const target = await loadWorkItemTarget(
        tx,
        input.identity,
        input.workspaceId,
        input.workItemId,
        true,
      );
      if (!target || target.projectId !== input.projectId)
        throw new HTTPException(404, { message: "Work item not found" });
      workItemKey = target.key;
    }
    const person = await loadTimePerson(tx, input.workspaceId, input.personId);
    if (!person)
      throw new HTTPException(422, { message: "person_not_loggable" });
    const type = await requireActiveCostType(
      tx,
      input.workspaceId,
      input.costTypeId,
    );
    await assertBackdateWindow(
      tx,
      input.workspaceId,
      input.personId,
      input.date,
      input.canLogBackdated,
    );
    const rate = resolveCostRate(input.rateMinor, type.defaultRateMinor);
    if (!rate) throw new HTTPException(422, { message: "rate_required" });
    const currency = input.currency ?? type.currency;
    const row = one(
      (
        await tx
          .insert(costEntryTable)
          .values({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            workItemId: input.workItemId ?? null,
            costTypeId: type.id,
            personId: input.personId,
            date: input.date,
            units: input.units,
            rateMinor: rate.rateMinor,
            amountMinor: costEntryAmountMinor(input.units, rate.rateMinor),
            currency,
            billable: input.billable ?? type.billable,
            note: input.note ?? null,
            createdBy: input.actor.userId,
          })
          .returning({ id: costEntryTable.id })
      )[0],
    );
    // Audited without rate or amount: an audit reader must not learn a price from a cost row (TC-11).
    await auditTime(tx, {
      action: "cost_entry.created",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      entityType: "cost_entry",
      entityId: row.id,
      actor: input.actor,
      after: {
        costType: type.name,
        personId: input.personId,
        date: input.date,
        units: input.units,
        currency,
        ...(workItemKey ? { workItemKey } : {}),
      },
    });
    await evaluateBudgetThresholds(tx, input.workspaceId, input.projectId);
    return row.id;
  });
}

export async function updateCostEntry(input: {
  identity: ResolvedIdentity;
  actor: TimeActor;
  id: string;
  workspaceId: string;
  changes: {
    date?: string;
    units?: number;
    rateMinor?: number;
    currency?: string;
    billable?: boolean;
    note?: string | null;
    costTypeId?: string;
    workItemId?: string | null;
  };
  canLogBackdated: boolean;
}): Promise<string | undefined> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(costEntryTable)
      .innerJoin(projectTable, eq(projectTable.id, costEntryTable.projectId))
      .where(
        and(
          eq(costEntryTable.id, input.id),
          eq(costEntryTable.workspaceId, input.workspaceId),
          projectReach(input.identity, tx),
        ),
      )
      .for("update", { of: costEntryTable });
    if (!current) return undefined;
    const before = current.cost_entry;
    await assertTrackingEnabledForProject(
      input.workspaceId,
      before.projectId,
      TIME_TRACKING_FEATURE_KEY,
      COST_TRACKING_FEATURE_KEY,
    );

    // Same window as time entries: closed history stays closed for anyone without `log_backdated`.
    const clock = await callerClock(tx, before.personId);
    const limit = await backdateLimitDays(tx, input.workspaceId);
    const oldFailure = checkEntryDate({
      date: before.date,
      today: clock.today,
      limitDays: limit,
      canLogBackdated: input.canLogBackdated,
    });
    if (oldFailure === "too_old")
      throw new HTTPException(422, { message: "date_too_old" });
    const date = input.changes.date ?? before.date;
    if (date !== before.date)
      await assertBackdateWindow(
        tx,
        input.workspaceId,
        before.personId,
        date,
        input.canLogBackdated,
      );

    let costTypeId = before.costTypeId;
    if (input.changes.costTypeId && input.changes.costTypeId !== costTypeId) {
      const type = await requireActiveCostType(
        tx,
        input.workspaceId,
        input.changes.costTypeId,
      );
      costTypeId = type.id;
    }
    let workItemId = before.workItemId;
    if (input.changes.workItemId !== undefined) {
      if (input.changes.workItemId === null) workItemId = null;
      else {
        const target = await loadWorkItemTarget(
          tx,
          input.identity,
          input.workspaceId,
          input.changes.workItemId,
          true,
        );
        if (!target || target.projectId !== before.projectId)
          throw new HTTPException(404, { message: "Work item not found" });
        workItemId = target.id;
      }
    }
    // The captured rate stays with the entry (TC-13) unless the editor gives a new one.
    const units = input.changes.units ?? before.units;
    const rateMinor = input.changes.rateMinor ?? before.rateMinor;
    const row = one(
      (
        await tx
          .update(costEntryTable)
          .set({
            workItemId,
            costTypeId,
            date,
            units,
            rateMinor,
            amountMinor: costEntryAmountMinor(units, rateMinor),
            currency: input.changes.currency ?? before.currency,
            billable: input.changes.billable ?? before.billable,
            note:
              input.changes.note === undefined
                ? before.note
                : input.changes.note,
          })
          .where(eq(costEntryTable.id, input.id))
          .returning({ id: costEntryTable.id })
      )[0],
    );
    await auditTime(tx, {
      action: "cost_entry.updated",
      workspaceId: input.workspaceId,
      projectId: before.projectId,
      entityType: "cost_entry",
      entityId: input.id,
      actor: input.actor,
      before: {
        date: before.date,
        units: before.units,
        costTypeId: before.costTypeId,
        currency: before.currency,
        billable: before.billable,
        workItemId: before.workItemId,
      },
      after: {
        date,
        units,
        costTypeId,
        currency: input.changes.currency ?? before.currency,
        billable: input.changes.billable ?? before.billable,
        workItemId,
        rateChanged:
          input.changes.rateMinor !== undefined &&
          input.changes.rateMinor !== before.rateMinor,
      },
    });
    await evaluateBudgetThresholds(tx, input.workspaceId, before.projectId);
    return row.id;
  });
}

/** Lock one cost entry for a registered deletion (the approval re-reads it under this lock). */
export async function lockCostEntryForDeletion(tx: Executor, id: string) {
  const [entry] = await tx
    .select()
    .from(costEntryTable)
    .where(eq(costEntryTable.id, id))
    .for("update")
    .limit(1);
  return entry;
}

export async function costEntryExistsInWorkspace(
  tx: Executor,
  id: string,
  workspaceId: string,
) {
  const [entry] = await tx
    .select({ id: costEntryTable.id })
    .from(costEntryTable)
    .where(
      and(
        eq(costEntryTable.id, id),
        eq(costEntryTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return entry !== undefined;
}

/**
 * PA-12: a hard delete of held history is refused. An open hold on the person the cost is for, on
 * the user who recorded it, or on the organisation of either, the workspace or the project fences
 * the entry (shared predicate in `utils/legal-hold-scope.ts`). The SHARE lock makes the check
 * race-free against a concurrent hold placement.
 */
export async function costEntryUnderOpenHold(
  tx: Executor,
  id: string,
): Promise<boolean> {
  await lockLegalHolds(tx);
  const result = await tx.execute<{ held: boolean }>(sql`
    SELECT ${openHoldOver(
      sql`
        SELECT ce."person_id" FROM "cost_entry" ce WHERE ce."id" = ${id}
        UNION ALL
        SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
          SELECT ce."created_by" FROM "cost_entry" ce WHERE ce."id" = ${id}
        )
      `,
      sql`
        SELECT w."organisation_id" FROM "cost_entry" ce JOIN "workspace" w ON w."id" = ce."workspace_id" WHERE ce."id" = ${id}
        UNION ALL
        SELECT p."organisation_id" FROM "cost_entry" ce JOIN "project" p ON p."id" = ce."project_id" WHERE ce."id" = ${id}
      `,
    )} AS held
  `);
  return result.rows[0]?.held === true;
}

export async function deleteCostEntryRow(
  tx: Executor,
  id: string,
  workspaceId: string,
  actor: TimeActor,
) {
  const [row] = await tx
    .delete(costEntryTable)
    .where(
      and(
        eq(costEntryTable.id, id),
        eq(costEntryTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!row) return false;
  await auditTime(tx, {
    action: "cost_entry.deleted",
    workspaceId,
    projectId: row.projectId,
    entityType: "cost_entry",
    entityId: id,
    actor,
    before: {
      personId: row.personId,
      date: row.date,
      units: row.units,
      currency: row.currency,
      workItemId: row.workItemId,
    },
  });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Cost-entry totals (TC-16): per currency, never converted (TC-19)
// ---------------------------------------------------------------------------------------------

export type CostEntriesByCurrency = Array<{
  currency: string;
  amountMinor: number;
  entryCount: number;
}>;

/** Work items whose cost rolls up into `rootId`: the item and every descendant (TC-7). */
function descendantIds(workspaceId: string, rootId: string): SQL {
  return sql`(WITH RECURSIVE tree(id) AS (
      SELECT wi.id FROM work_item wi WHERE wi.id = ${rootId} AND wi.workspace_id = ${workspaceId}
      UNION
      SELECT c.id FROM work_item c JOIN tree t ON c.parent_id = t.id
      WHERE c.workspace_id = ${workspaceId} AND c.deleted_at IS NULL
    ) SELECT id FROM tree)`;
}

/**
 * Cost entries per currency for a scope. With an `identity` the caller's project reach applies;
 * without one (the system budget-threshold check) the project is the only fence.
 */
export async function costEntriesByCurrency(
  scope: {
    workspaceId: string;
    workItemId?: string;
    projectId?: string;
    cycleId?: string;
    moduleId?: string;
    from?: string;
    to?: string;
  },
  identity: ResolvedIdentity | null,
  executor: Executor = db,
): Promise<CostEntriesByCurrency> {
  const where = and(
    eq(costEntryTable.workspaceId, scope.workspaceId),
    identity ? projectReach(identity, executor) : undefined,
    scope.workItemId
      ? sql`${costEntryTable.workItemId} IN ${descendantIds(scope.workspaceId, scope.workItemId)}`
      : undefined,
    scope.projectId ? eq(costEntryTable.projectId, scope.projectId) : undefined,
    scope.cycleId
      ? sql`${costEntryTable.workItemId} IN (SELECT wi.id FROM work_item wi WHERE wi.workspace_id = ${scope.workspaceId} AND wi.cycle_id = ${scope.cycleId})`
      : undefined,
    scope.moduleId
      ? sql`${costEntryTable.workItemId} IN (SELECT wi.id FROM work_item wi WHERE wi.workspace_id = ${scope.workspaceId} AND wi.module_id = ${scope.moduleId})`
      : undefined,
    scope.from ? gte(costEntryTable.date, scope.from) : undefined,
    scope.to ? lte(costEntryTable.date, scope.to) : undefined,
  );
  const rows = await executor
    .select({
      currency: costEntryTable.currency,
      amountMinor: sql<string>`coalesce(sum(${costEntryTable.amountMinor}), 0)::text`,
      entryCount: sql<number>`count(*)::int`,
    })
    .from(costEntryTable)
    .innerJoin(projectTable, eq(projectTable.id, costEntryTable.projectId))
    .where(where)
    .groupBy(costEntryTable.currency)
    .orderBy(asc(costEntryTable.currency));
  return rows.map((row) => ({
    currency: row.currency,
    amountMinor: Number(row.amountMinor),
    entryCount: row.entryCount,
  }));
}

// ---------------------------------------------------------------------------------------------
// Available hours (TC-20)
// ---------------------------------------------------------------------------------------------

export type AvailableHoursView = {
  id: string;
  personId: string;
  personName: string | null;
  minutesPerWeek: number;
  effectiveFrom: string;
  createdAt: Date;
};

export async function listAvailableHours(
  workspaceId: string,
  personIds: string[] | null,
  executor: Executor = db,
): Promise<AvailableHoursView[]> {
  if (personIds && personIds.length === 0) return [];
  return executor
    .select({
      id: availableHoursTable.id,
      personId: availableHoursTable.personId,
      personName: sql<
        string | null
      >`coalesce(${personTable.displayName}, ${userTable.name})`,
      minutesPerWeek: availableHoursTable.minutesPerWeek,
      effectiveFrom: availableHoursTable.effectiveFrom,
      createdAt: availableHoursTable.createdAt,
    })
    .from(availableHoursTable)
    .innerJoin(personTable, eq(personTable.id, availableHoursTable.personId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(
      and(
        eq(availableHoursTable.workspaceId, workspaceId),
        personIds
          ? inArray(availableHoursTable.personId, personIds)
          : undefined,
      ),
    )
    .orderBy(
      asc(personTable.displayName),
      asc(availableHoursTable.personId),
      desc(availableHoursTable.effectiveFrom),
    )
    .limit(2000);
}

/** Staff who are workspace members: the picker for a new available-hours row. */
export async function listCapacityPeople(
  workspaceId: string,
  executor: Executor = db,
) {
  return executor
    .select({
      personId: personTable.id,
      name: sql<string>`coalesce(${personTable.displayName}, ${userTable.name}, ${personTable.id})`,
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .where(and(eq(personTable.active, true), eq(personTable.side, "staff")))
    .orderBy(asc(sql`coalesce(${personTable.displayName}, ${userTable.name})`))
    .limit(500);
}

export async function createAvailableHours(input: {
  workspaceId: string;
  personId: string;
  minutesPerWeek: number;
  effectiveFrom: string;
  actor: TimeActor;
}): Promise<AvailableHoursView> {
  try {
    const id = await db.transaction(async (tx) => {
      const person = await loadTimePerson(
        tx,
        input.workspaceId,
        input.personId,
      );
      if (!person)
        throw new HTTPException(404, { message: "Person not found" });
      const row = one(
        (
          await tx
            .insert(availableHoursTable)
            .values({
              workspaceId: input.workspaceId,
              personId: input.personId,
              minutesPerWeek: input.minutesPerWeek,
              effectiveFrom: input.effectiveFrom,
              createdBy: input.actor.userId,
            })
            .returning({ id: availableHoursTable.id })
        )[0],
      );
      await auditTime(tx, {
        action: "available_hours.created",
        workspaceId: input.workspaceId,
        entityType: "available_hours",
        entityId: row.id,
        actor: input.actor,
        after: {
          personId: input.personId,
          minutesPerWeek: input.minutesPerWeek,
          effectiveFrom: input.effectiveFrom,
        },
      });
      return row.id;
    });
    const [view] = (
      await listAvailableHours(input.workspaceId, [input.personId])
    ).filter((entry) => entry.id === id);
    return one(view);
  } catch (error) {
    if (isUniqueViolation(error))
      throw new HTTPException(409, {
        message: "Available hours already start on that date",
      });
    throw error;
  }
}
