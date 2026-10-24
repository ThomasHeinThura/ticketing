import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  exists,
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
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  instanceSettingTable,
  personTable,
  projectTable,
  userTable,
  workItemTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import {
  budgetTable,
  hourlyRateTable,
  runningTimerTable,
  timeActivityTable,
  timeEntryTable,
} from "../database/schema-p5-time";
import { openHoldOver } from "../utils/legal-hold-scope";
import { lockLegalHolds } from "../utils/workspace-legal-hold";
import { runWithParentWriteDeadlockRetry } from "../work-item/parent-write-deadlock-retry";
import { auditTime, type TimeActor } from "./audit";
import {
  assertTrackingEnabledForProject,
  TIME_TRACKING_FEATURE_KEY,
} from "./feature";
import {
  budgetThreshold,
  checkEntryDate,
  DEFAULT_BACKDATE_LIMIT_DAYS,
  type RateRow,
  resolveTimeZone,
  selectEffectiveRate,
  splitAtMidnight,
  stopTimer,
  TIMER_CAP_MINUTES,
  timerExpired,
  zonedDate,
} from "./logic";

/** A statement that must return a row (INSERT .. RETURNING): its absence is a programming error. */
function one<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("expected a returned row");
  return row;
}

const DEFAULT_ACTIVITIES = ["Development", "Support", "Meeting", "Travel"];

export function isUniqueViolation(error: unknown, constraint?: string) {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  } | null;
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && (constraint === undefined || name === constraint);
}

function projectReach(identity: ResolvedIdentity, executor: Executor) {
  return and(
    isNull(projectTable.deletedAt),
    currentProjectReachPredicate(
      identity,
      projectTable.id,
      projectTable.workspaceId,
      projectTable.organisationId,
      executor,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Activities (TC-2)
// ---------------------------------------------------------------------------------------------

/** Insert-only: a workspace created after the migration still gets the four default activities. */
export async function ensureDefaultActivities(
  executor: Executor,
  workspaceId: string,
) {
  const [existing] = await executor
    .select({ id: timeActivityTable.id })
    .from(timeActivityTable)
    .where(eq(timeActivityTable.workspaceId, workspaceId))
    .limit(1);
  if (existing) return;
  await executor
    .insert(timeActivityTable)
    .values(
      DEFAULT_ACTIVITIES.map((name, position) => ({
        workspaceId,
        name,
        position,
      })),
    )
    .onConflictDoNothing();
}

export type ActivityRow = {
  id: string;
  workspaceId: string;
  name: string;
  position: number;
  archived: boolean;
};

export async function listActivities(
  workspaceId: string,
  includeArchived: boolean,
  executor: Executor = db,
): Promise<ActivityRow[]> {
  await ensureDefaultActivities(executor, workspaceId);
  const rows = await executor
    .select()
    .from(timeActivityTable)
    .where(
      and(
        eq(timeActivityTable.workspaceId, workspaceId),
        includeArchived ? undefined : isNull(timeActivityTable.archivedAt),
      ),
    )
    .orderBy(asc(timeActivityTable.position), asc(timeActivityTable.name));
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    position: row.position,
    archived: row.archivedAt !== null,
  }));
}

export async function createActivity(input: {
  workspaceId: string;
  name: string;
  position?: number;
  actor: TimeActor;
}): Promise<ActivityRow> {
  try {
    return await db.transaction(async (tx) => {
      await ensureDefaultActivities(tx, input.workspaceId);
      const row = one(
        (
          await tx
            .insert(timeActivityTable)
            .values({
              workspaceId: input.workspaceId,
              name: input.name,
              position: input.position ?? 100,
            })
            .returning()
        )[0],
      );
      await auditTime(tx, {
        action: "time_activity.created",
        workspaceId: input.workspaceId,
        entityType: "time_activity",
        entityId: row.id,
        actor: input.actor,
        after: { name: row.name },
      });
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        position: row.position,
        archived: false,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new HTTPException(409, {
        message: "An activity with this name already exists",
      });
    throw error;
  }
}

export async function updateActivity(
  id: string,
  workspaceId: string,
  changes: { name?: string; position?: number; archived?: boolean },
  actor: TimeActor,
): Promise<ActivityRow | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(timeActivityTable)
        .where(
          and(
            eq(timeActivityTable.id, id),
            eq(timeActivityTable.workspaceId, workspaceId),
          ),
        )
        .for("update");
      if (!before) return undefined;
      const row = one(
        (
          await tx
            .update(timeActivityTable)
            .set({
              ...(changes.name === undefined ? {} : { name: changes.name }),
              ...(changes.position === undefined
                ? {}
                : { position: changes.position }),
              ...(changes.archived === undefined
                ? {}
                : { archivedAt: changes.archived ? new Date() : null }),
            })
            .where(eq(timeActivityTable.id, id))
            .returning()
        )[0],
      );
      await auditTime(tx, {
        action: "time_activity.updated",
        workspaceId,
        entityType: "time_activity",
        entityId: id,
        actor,
        before: { name: before.name, archived: before.archivedAt !== null },
        after: { name: row.name, archived: row.archivedAt !== null },
      });
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        position: row.position,
        archived: row.archivedAt !== null,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new HTTPException(409, {
        message: "An activity with this name already exists",
      });
    throw error;
  }
}

async function requireActiveActivity(
  executor: Executor,
  workspaceId: string,
  activityId: string,
) {
  await ensureDefaultActivities(executor, workspaceId);
  const [activity] = await executor
    .select({ id: timeActivityTable.id, name: timeActivityTable.name })
    .from(timeActivityTable)
    .where(
      and(
        eq(timeActivityTable.id, activityId),
        eq(timeActivityTable.workspaceId, workspaceId),
        isNull(timeActivityTable.archivedAt),
      ),
    )
    .limit(1);
  if (!activity)
    throw new HTTPException(422, { message: "activity_unavailable" });
  return activity;
}

async function defaultActivityId(executor: Executor, workspaceId: string) {
  await ensureDefaultActivities(executor, workspaceId);
  const [activity] = await executor
    .select({ id: timeActivityTable.id })
    .from(timeActivityTable)
    .where(
      and(
        eq(timeActivityTable.workspaceId, workspaceId),
        isNull(timeActivityTable.archivedAt),
      ),
    )
    .orderBy(asc(timeActivityTable.position), asc(timeActivityTable.name))
    .limit(1);
  if (!activity)
    throw new HTTPException(422, { message: "activity_unavailable" });
  return activity.id;
}

// ---------------------------------------------------------------------------------------------
// People, clocks and rates
// ---------------------------------------------------------------------------------------------

export type TimePerson = {
  personId: string;
  timeZone: string;
};

/**
 * The person's timezone chain (owner decision D4): profile (`person.quiet_hours_timezone`, the
 * only per-person zone), then the instance zone (there is no workspace-level zone column), then
 * UTC.
 */
async function loadInstanceTimeZone(executor: Executor) {
  const [setting] = await executor
    .select({ timezone: instanceSettingTable.timezone })
    .from(instanceSettingTable)
    .limit(1);
  return setting?.timezone ?? null;
}

/** An active staff person who is a member of the workspace; anything else is not loggable-for. */
export async function loadTimePerson(
  executor: Executor,
  workspaceId: string,
  personId: string,
): Promise<TimePerson | undefined> {
  const [row] = await executor
    .select({
      personId: personTable.id,
      zone: personTable.quietHoursTimezone,
    })
    .from(personTable)
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(personTable.id, personId),
        eq(personTable.active, true),
        eq(personTable.side, "staff"),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  return {
    personId: row.personId,
    timeZone: resolveTimeZone(row.zone, await loadInstanceTimeZone(executor)),
  };
}

export async function callerClock(
  executor: Executor,
  personId: string,
  now: Date = new Date(),
) {
  const [row] = await executor
    .select({ zone: personTable.quietHoursTimezone })
    .from(personTable)
    .where(eq(personTable.id, personId))
    .limit(1);
  const timeZone = resolveTimeZone(
    row?.zone,
    await loadInstanceTimeZone(executor),
  );
  return { timeZone, today: zonedDate(now.getTime(), timeZone) };
}

export async function backdateLimitDays(
  executor: Executor,
  workspaceId: string,
) {
  const [row] = await executor
    .select({ days: workspaceTable.timeEntryBackdateLimitDays })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return row?.days ?? DEFAULT_BACKDATE_LIMIT_DAYS;
}

async function loadRates(
  executor: Executor,
  workspaceId: string,
  personId: string,
): Promise<RateRow[]> {
  return executor
    .select({
      projectId: hourlyRateTable.projectId,
      effectiveFrom: hourlyRateTable.effectiveFrom,
      rateMinor: hourlyRateTable.rateMinor,
      currency: hourlyRateTable.currency,
    })
    .from(hourlyRateTable)
    .where(
      and(
        eq(hourlyRateTable.workspaceId, workspaceId),
        eq(hourlyRateTable.personId, personId),
      ),
    );
}

/** Owner decision D4: the rate is captured when the entry is created or the timer stops. */
async function snapshotRate(
  executor: Executor,
  workspaceId: string,
  personId: string,
  projectId: string,
  date: string,
) {
  const rate = selectEffectiveRate(
    await loadRates(executor, workspaceId, personId),
    projectId,
    date,
  );
  return rate
    ? { rateMinor: rate.rateMinor, currency: rate.currency }
    : { rateMinor: null, currency: null };
}

// ---------------------------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------------------------

export type WorkItemTarget = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  workspaceId: string;
  defaultBillable: boolean;
};

/** A live work item in a live project the caller can reach, in this workspace. */
export async function loadWorkItemTarget(
  executor: Executor,
  identity: ResolvedIdentity,
  workspaceId: string,
  workItemId: string,
  lock = false,
): Promise<WorkItemTarget | undefined> {
  const query = executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      projectId: workItemTable.projectId,
      workspaceId: workItemTable.workspaceId,
      defaultBillable: projectTable.defaultBillable,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .where(
      and(
        eq(workItemTable.id, workItemId),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.archivedAt),
        projectReach(identity, executor),
      ),
    );
  const [row] = lock
    ? await query.for("share", { of: [workItemTable, projectTable] })
    : await query;
  return row;
}

// ---------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------

/** The project the work item lives in NOW (a move changes it; the entry's own project follows). */
const itemProject = aliasedTable(projectTable, "item_project");

/**
 * A work item's key and title are shown only while its CURRENT project is in the caller's reach
 * (defence in depth next to the entry's own project reach: a move re-homes the entry, but a row
 * must never name an item the caller cannot see; same rule as the timer view's `canSeeItem`).
 */
function itemVisible(identity: ResolvedIdentity, executor: Executor) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(itemProject)
      .where(
        and(
          eq(itemProject.id, workItemTable.projectId),
          isNull(itemProject.deletedAt),
          currentProjectReachPredicate(
            identity,
            itemProject.id,
            itemProject.workspaceId,
            itemProject.organisationId,
            executor,
          ),
        ),
      ),
  );
}

const entryColumns = (identity: ResolvedIdentity, executor: Executor) => ({
  id: timeEntryTable.id,
  workspaceId: timeEntryTable.workspaceId,
  projectId: timeEntryTable.projectId,
  workItemId: timeEntryTable.workItemId,
  workItemKey: sql<
    string | null
  >`CASE WHEN ${itemVisible(identity, executor)} THEN ${workItemTable.key} END`,
  workItemTitle: sql<
    string | null
  >`CASE WHEN ${itemVisible(identity, executor)} THEN ${workItemTable.title} END`,
  personId: timeEntryTable.personId,
  personName: sql<
    string | null
  >`coalesce(${personTable.displayName}, ${userTable.name})`,
  date: timeEntryTable.date,
  minutes: timeEntryTable.minutes,
  activityId: timeEntryTable.activityId,
  activityName: timeActivityTable.name,
  description: timeEntryTable.description,
  billable: timeEntryTable.billable,
  source: timeEntryTable.source,
  needsReview: timeEntryTable.needsReview,
  rateMinor: timeEntryTable.rateMinor,
  currency: timeEntryTable.currency,
  createdAt: timeEntryTable.createdAt,
  updatedAt: timeEntryTable.updatedAt,
});

function selectEntries(identity: ResolvedIdentity, executor: Executor) {
  return executor
    .select(entryColumns(identity, executor))
    .from(timeEntryTable)
    .innerJoin(projectTable, eq(projectTable.id, timeEntryTable.projectId))
    .innerJoin(personTable, eq(personTable.id, timeEntryTable.personId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .innerJoin(
      timeActivityTable,
      eq(timeActivityTable.id, timeEntryTable.activityId),
    )
    .leftJoin(workItemTable, eq(workItemTable.id, timeEntryTable.workItemId));
}

export type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number];

export async function listEntries(
  identity: ResolvedIdentity,
  filter: {
    workspaceId: string;
    personId?: string;
    from?: string;
    to?: string;
    workItemId?: string;
    projectId?: string;
    needsReview?: boolean;
  },
  executor: Executor = db,
): Promise<EntryRow[]> {
  return selectEntries(identity, executor)
    .where(
      and(
        eq(timeEntryTable.workspaceId, filter.workspaceId),
        projectReach(identity, executor),
        filter.personId
          ? eq(timeEntryTable.personId, filter.personId)
          : undefined,
        filter.from ? gte(timeEntryTable.date, filter.from) : undefined,
        filter.to ? lte(timeEntryTable.date, filter.to) : undefined,
        filter.workItemId
          ? eq(timeEntryTable.workItemId, filter.workItemId)
          : undefined,
        filter.projectId
          ? eq(timeEntryTable.projectId, filter.projectId)
          : undefined,
        filter.needsReview ? eq(timeEntryTable.needsReview, true) : undefined,
      ),
    )
    .orderBy(
      desc(timeEntryTable.date),
      desc(timeEntryTable.createdAt),
      desc(timeEntryTable.id),
    )
    .limit(2000);
}

export async function getEntry(
  identity: ResolvedIdentity,
  id: string,
  executor: Executor = db,
): Promise<EntryRow | undefined> {
  const [row] = await selectEntries(identity, executor).where(
    and(eq(timeEntryTable.id, id), projectReach(identity, executor)),
  );
  return row;
}

/** Facts the route middleware needs before reach and capability: workspace and owner of the row. */
export async function getEntryScope(id: string, executor: Executor = db) {
  const [row] = await executor
    .select({
      id: timeEntryTable.id,
      workspaceId: timeEntryTable.workspaceId,
      projectId: timeEntryTable.projectId,
      personId: timeEntryTable.personId,
    })
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, id))
    .limit(1);
  return row;
}

type CreateEntryInput = {
  identity: ResolvedIdentity;
  actor: TimeActor;
  workspaceId: string;
  workItemId: string;
  date: string;
  minutes: number;
  activityId: string;
  description?: string;
  billable?: boolean;
  /** Target person; the caller unless they hold `time_entry:update_any`. */
  personId: string;
  canLogBackdated: boolean;
};

export async function createEntry(input: CreateEntryInput): Promise<string> {
  return db.transaction(async (tx) => {
    const target = await loadWorkItemTarget(
      tx,
      input.identity,
      input.workspaceId,
      input.workItemId,
      true,
    );
    if (!target)
      throw new HTTPException(404, { message: "Work item not found" });
    await assertTrackingEnabledForProject(
      input.workspaceId,
      target.projectId,
      TIME_TRACKING_FEATURE_KEY,
    );
    const person = await loadTimePerson(tx, input.workspaceId, input.personId);
    if (!person)
      throw new HTTPException(422, { message: "person_not_loggable" });
    await requireActiveActivity(tx, input.workspaceId, input.activityId);

    const clock = await callerClock(tx, input.personId);
    const failure = checkEntryDate({
      date: input.date,
      today: clock.today,
      limitDays: await backdateLimitDays(tx, input.workspaceId),
      canLogBackdated: input.canLogBackdated,
    });
    if (failure)
      throw new HTTPException(422, {
        message: failure === "future" ? "date_in_future" : "date_too_old",
      });

    const snapshot = await snapshotRate(
      tx,
      input.workspaceId,
      input.personId,
      target.projectId,
      input.date,
    );
    const row = one(
      (
        await tx
          .insert(timeEntryTable)
          .values({
            workspaceId: input.workspaceId,
            projectId: target.projectId,
            workItemId: target.id,
            personId: input.personId,
            date: input.date,
            minutes: input.minutes,
            activityId: input.activityId,
            description: input.description ?? null,
            billable: input.billable ?? target.defaultBillable,
            ...snapshot,
            source: "manual",
          })
          .returning({
            id: timeEntryTable.id,
            billable: timeEntryTable.billable,
          })
      )[0],
    );
    await auditTime(tx, {
      action: "time_entry.created",
      workspaceId: input.workspaceId,
      projectId: target.projectId,
      entityType: "time_entry",
      entityId: row.id,
      actor: input.actor,
      after: {
        workItemKey: target.key,
        personId: input.personId,
        date: input.date,
        minutes: input.minutes,
        billable: row.billable,
      },
    });
    return row.id;
  });
}

type UpdateEntryInput = {
  identity: ResolvedIdentity;
  actor: TimeActor;
  id: string;
  workspaceId: string;
  changes: {
    date?: string;
    minutes?: number;
    activityId?: string;
    description?: string | null;
    billable?: boolean;
    workItemId?: string;
  };
  canLogBackdated: boolean;
};

export async function updateEntry(
  input: UpdateEntryInput,
): Promise<string | undefined> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(timeEntryTable)
      .innerJoin(projectTable, eq(projectTable.id, timeEntryTable.projectId))
      .where(
        and(
          eq(timeEntryTable.id, input.id),
          eq(timeEntryTable.workspaceId, input.workspaceId),
          projectReach(input.identity, tx),
        ),
      )
      .for("update", { of: timeEntryTable });
    if (!current) return undefined;
    const before = current.time_entry;

    // TC-4: time older than the backdating window is closed to people without
    // `time_entry:log_backdated`, for any change, not only a change of date.
    const editorClock = await callerClock(tx, before.personId);
    const oldFailure = checkEntryDate({
      date: before.date,
      today: editorClock.today,
      limitDays: await backdateLimitDays(tx, input.workspaceId),
      canLogBackdated: input.canLogBackdated,
    });
    if (oldFailure === "too_old")
      throw new HTTPException(422, { message: "date_too_old" });

    let projectId = before.projectId;
    let workItemId = before.workItemId;
    let workItemKey: string | null = null;
    if (input.changes.workItemId && input.changes.workItemId !== workItemId) {
      const target = await loadWorkItemTarget(
        tx,
        input.identity,
        input.workspaceId,
        input.changes.workItemId,
        true,
      );
      if (!target)
        throw new HTTPException(404, { message: "Work item not found" });
      await assertTrackingEnabledForProject(
        input.workspaceId,
        target.projectId,
        TIME_TRACKING_FEATURE_KEY,
      );
      projectId = target.projectId;
      workItemId = target.id;
      workItemKey = target.key;
    }
    if (input.changes.activityId)
      await requireActiveActivity(
        tx,
        input.workspaceId,
        input.changes.activityId,
      );

    const date = input.changes.date ?? before.date;
    if (input.changes.date && input.changes.date !== before.date) {
      const clock = await callerClock(tx, before.personId);
      const failure = checkEntryDate({
        date,
        today: clock.today,
        limitDays: await backdateLimitDays(tx, input.workspaceId),
        canLogBackdated: input.canLogBackdated,
      });
      if (failure)
        throw new HTTPException(422, {
          message: failure === "future" ? "date_in_future" : "date_too_old",
        });
    }

    // The captured rate stays with the entry (D4) unless the entry moves to another date or
    // project, in which case it is captured again for the new date and project.
    const repriced = date !== before.date || projectId !== before.projectId;
    const snapshot = repriced
      ? await snapshotRate(
          tx,
          input.workspaceId,
          before.personId,
          projectId,
          date,
        )
      : { rateMinor: before.rateMinor, currency: before.currency };

    const row = one(
      (
        await tx
          .update(timeEntryTable)
          .set({
            projectId,
            workItemId,
            date,
            minutes: input.changes.minutes ?? before.minutes,
            activityId: input.changes.activityId ?? before.activityId,
            description:
              input.changes.description === undefined
                ? before.description
                : input.changes.description,
            billable: input.changes.billable ?? before.billable,
            ...snapshot,
            // Editing a capped entry is the answer to "what actually happened".
            needsReview: false,
          })
          .where(eq(timeEntryTable.id, input.id))
          .returning({ id: timeEntryTable.id })
      )[0],
    );
    await auditTime(tx, {
      action: "time_entry.updated",
      workspaceId: input.workspaceId,
      projectId,
      entityType: "time_entry",
      entityId: input.id,
      actor: input.actor,
      before: {
        date: before.date,
        minutes: before.minutes,
        activityId: before.activityId,
        billable: before.billable,
        workItemId: before.workItemId,
      },
      after: {
        date,
        minutes: input.changes.minutes ?? before.minutes,
        activityId: input.changes.activityId ?? before.activityId,
        billable: input.changes.billable ?? before.billable,
        workItemId,
        ...(workItemKey ? { workItemKey } : {}),
      },
    });
    return row.id;
  });
}

/** Lock one entry for a registered deletion (the approval re-reads it under this lock). */
export async function lockEntryForDeletion(tx: Executor, id: string) {
  const [entry] = await tx
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, id))
    .for("update")
    .limit(1);
  return entry;
}

export async function entryExistsInWorkspace(
  tx: Executor,
  id: string,
  workspaceId: string,
) {
  const [entry] = await tx
    .select({ id: timeEntryTable.id })
    .from(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.id, id),
        eq(timeEntryTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return entry !== undefined;
}

/**
 * PA-12: a hard delete of held history is refused. An open hold on the logging person, or on the
 * organisation of that person, the workspace or the project, fences the entry; the predicate is
 * the shared one in `utils/legal-hold-scope.ts`. Taking the SHARE lock first makes the check
 * race-free against a concurrent hold placement.
 */
export async function entryUnderOpenHold(
  tx: Executor,
  id: string,
): Promise<boolean> {
  await lockLegalHolds(tx);
  const result = await tx.execute<{ held: boolean }>(sql`
    SELECT ${openHoldOver(
      sql`SELECT te."person_id" FROM "time_entry" te WHERE te."id" = ${id}`,
      sql`
        SELECT w."organisation_id" FROM "time_entry" te JOIN "workspace" w ON w."id" = te."workspace_id" WHERE te."id" = ${id}
        UNION ALL
        SELECT p."organisation_id" FROM "time_entry" te JOIN "project" p ON p."id" = te."project_id" WHERE te."id" = ${id}
      `,
    )} AS held
  `);
  return result.rows[0]?.held === true;
}

export async function deleteEntryRow(
  tx: Executor,
  id: string,
  workspaceId: string,
  actor: TimeActor,
) {
  const [row] = await tx
    .delete(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.id, id),
        eq(timeEntryTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!row) return false;
  await auditTime(tx, {
    action: "time_entry.deleted",
    workspaceId,
    projectId: row.projectId,
    entityType: "time_entry",
    entityId: id,
    actor,
    before: {
      personId: row.personId,
      date: row.date,
      minutes: row.minutes,
      workItemId: row.workItemId,
    },
  });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Timer (TC-6)
// ---------------------------------------------------------------------------------------------

const timerColumns = {
  personId: runningTimerTable.personId,
  workspaceId: runningTimerTable.workspaceId,
  projectId: runningTimerTable.projectId,
  workItemId: runningTimerTable.workItemId,
  workItemKey: workItemTable.key,
  workItemTitle: workItemTable.title,
  activityId: runningTimerTable.activityId,
  activityName: timeActivityTable.name,
  description: runningTimerTable.description,
  billable: runningTimerTable.billable,
  startedAt: runningTimerTable.startedAt,
};

export type TimerRow = {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  workItemKey: string | null;
  workItemTitle: string | null;
  activityId: string;
  activityName: string;
  description: string | null;
  billable: boolean;
  startedAt: Date;
};

export async function getTimer(
  personId: string,
  executor: Executor = db,
): Promise<TimerRow | undefined> {
  const [row] = await executor
    .select(timerColumns)
    .from(runningTimerTable)
    .innerJoin(
      timeActivityTable,
      eq(timeActivityTable.id, runningTimerTable.activityId),
    )
    .leftJoin(workItemTable, eq(workItemTable.id, runningTimerTable.workItemId))
    .where(eq(runningTimerTable.personId, personId));
  return row;
}

type StoppedTimer = {
  entryIds: string[];
  capped: boolean;
};

/** Close one locked timer row into entries: cap, split at local midnight, snapshot rates. */
async function closeTimer(
  tx: Executor,
  timer: typeof runningTimerTable.$inferSelect,
  nowMs: number,
  patch: { description?: string; activityId?: string },
  actor: TimeActor,
): Promise<StoppedTimer> {
  const stop = stopTimer(timer.startedAt.getTime(), nowMs);
  const [person] = await tx
    .select({ zone: personTable.quietHoursTimezone })
    .from(personTable)
    .where(eq(personTable.id, timer.personId))
    .limit(1);
  const zone = resolveTimeZone(person?.zone, await loadInstanceTimeZone(tx));
  const startMs = stop.endMs - stop.minutes * 60_000;
  const segments = splitAtMidnight(startMs, stop.endMs, zone);
  const rates = await loadRates(tx, timer.workspaceId, timer.personId);
  const activityId = patch.activityId ?? timer.activityId;
  const description =
    patch.description === undefined ? timer.description : patch.description;
  const entryIds: string[] = [];
  for (const segment of segments) {
    const rate = selectEffectiveRate(rates, timer.projectId, segment.date);
    const row = one(
      (
        await tx
          .insert(timeEntryTable)
          .values({
            workspaceId: timer.workspaceId,
            projectId: timer.projectId,
            workItemId: timer.workItemId,
            personId: timer.personId,
            date: segment.date,
            minutes: segment.minutes,
            activityId,
            description,
            billable: timer.billable,
            rateMinor: rate?.rateMinor ?? null,
            currency: rate?.currency ?? null,
            source: stop.capped ? "timer_capped" : "timer",
            needsReview: stop.capped,
          })
          .returning({ id: timeEntryTable.id })
      )[0],
    );
    entryIds.push(row.id);
  }
  await tx
    .delete(runningTimerTable)
    .where(eq(runningTimerTable.personId, timer.personId));
  await auditTime(tx, {
    action: stop.capped
      ? "time_entry.timer_capped"
      : "time_entry.timer_stopped",
    workspaceId: timer.workspaceId,
    projectId: timer.projectId,
    entityType: "time_entry",
    entityId: entryIds[0] ?? timer.personId,
    actor,
    after: {
      personId: timer.personId,
      workItemId: timer.workItemId,
      minutes: stop.minutes,
      segments: segments.length,
      capped: stop.capped,
    },
  });
  return { entryIds, capped: stop.capped };
}

export async function startTimer(input: {
  identity: ResolvedIdentity;
  actor: TimeActor;
  workspaceId: string;
  workItemId: string;
  activityId?: string;
  description?: string;
  billable?: boolean;
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const target = await loadWorkItemTarget(
        tx,
        input.identity,
        input.workspaceId,
        input.workItemId,
        true,
      );
      if (!target)
        throw new HTTPException(404, { message: "Work item not found" });
      await assertTrackingEnabledForProject(
        input.workspaceId,
        target.projectId,
        TIME_TRACKING_FEATURE_KEY,
      );
      const person = await loadTimePerson(
        tx,
        input.workspaceId,
        input.identity.personId,
      );
      if (!person)
        throw new HTTPException(422, { message: "person_not_loggable" });
      const activityId = input.activityId
        ? (await requireActiveActivity(tx, input.workspaceId, input.activityId))
            .id
        : await defaultActivityId(tx, input.workspaceId);

      const [existing] = await tx
        .select()
        .from(runningTimerTable)
        .where(eq(runningTimerTable.personId, input.identity.personId))
        .for("update");
      if (existing) {
        // An expired timer the sweeper has not reached yet is closed (capped) so a new one can start.
        if (!timerExpired(existing.startedAt.getTime(), Date.now()))
          throw new HTTPException(409, { message: "timer_already_running" });
        await closeTimer(tx, existing, Date.now(), {}, input.actor);
      }
      await tx.insert(runningTimerTable).values({
        personId: input.identity.personId,
        workspaceId: input.workspaceId,
        projectId: target.projectId,
        workItemId: target.id,
        activityId,
        description: input.description ?? null,
        billable: input.billable ?? target.defaultBillable,
      });
      await auditTime(tx, {
        action: "time_entry.timer_started",
        workspaceId: input.workspaceId,
        projectId: target.projectId,
        entityType: "work_item",
        entityId: target.id,
        actor: input.actor,
        after: { personId: input.identity.personId, workItemKey: target.key },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new HTTPException(409, { message: "timer_already_running" });
    throw error;
  }
}

export async function stopTimerForPerson(input: {
  personId: string;
  workspaceId: string;
  actor: TimeActor;
  description?: string;
  activityId?: string;
}): Promise<StoppedTimer | undefined> {
  // running_timer is locked, then time_entry is inserted (FK KEY SHARE on work_item): the
  // opposite order to a subtree move, which locks work_item then updates running_timer. A 40P01
  // victim retries the whole transaction (R5-05) instead of surfacing as a 500.
  return runWithParentWriteDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const [timer] = await tx
        .select()
        .from(runningTimerTable)
        .where(
          and(
            eq(runningTimerTable.personId, input.personId),
            eq(runningTimerTable.workspaceId, input.workspaceId),
          ),
        )
        .for("update");
      if (!timer) return undefined;
      if (input.activityId)
        await requireActiveActivity(tx, timer.workspaceId, input.activityId);
      return closeTimer(
        tx,
        timer,
        Date.now(),
        { description: input.description, activityId: input.activityId },
        input.actor,
      );
    }),
  );
}

export async function getEntriesByIds(
  identity: ResolvedIdentity,
  ids: readonly string[],
  executor: Executor = db,
): Promise<EntryRow[]> {
  if (ids.length === 0) return [];
  return selectEntries(identity, executor)
    .where(
      and(
        inArray(timeEntryTable.id, [...ids]),
        projectReach(identity, executor),
      ),
    )
    .orderBy(asc(timeEntryTable.date), asc(timeEntryTable.createdAt));
}

/**
 * The `timer-sweeper` job body: stop every timer older than the 12 h cap into a capped entry
 * marked `needs_review`, claiming rows with `SKIP LOCKED` so two replicas never close one timer.
 */
export async function sweepExpiredTimers(limit = 100): Promise<{
  swept: number;
  failed: number;
}> {
  let swept = 0;
  let failed = 0;
  const system: TimeActor = { userId: null, actorType: "system" };
  const candidates = await db
    .select({ personId: runningTimerTable.personId })
    .from(runningTimerTable)
    .where(
      sql`${runningTimerTable.startedAt} <= now() - make_interval(mins => ${TIMER_CAP_MINUTES})`,
    )
    .orderBy(asc(runningTimerTable.startedAt))
    .limit(limit);
  for (const candidate of candidates) {
    try {
      // Same lock order as timer stop, so the same deadlock retry (R5-05).
      await runWithParentWriteDeadlockRetry(() =>
        db.transaction(async (tx) => {
          const [timer] = await tx
            .select()
            .from(runningTimerTable)
            .where(
              and(
                eq(runningTimerTable.personId, candidate.personId),
                sql`${runningTimerTable.startedAt} <= now() - make_interval(mins => ${TIMER_CAP_MINUTES})`,
              ),
            )
            .for("update", { skipLocked: true });
          if (!timer) return false;
          await closeTimer(tx, timer, Date.now(), {}, system);
          return true;
        }),
      ).then((closed) => {
        if (closed) swept += 1;
      });
    } catch (error) {
      failed += 1;
      console.error("timer-sweeper: could not close a timer", error);
    }
  }
  return { swept, failed };
}

// ---------------------------------------------------------------------------------------------
// Roll-ups (TC-7, TC-16)
// ---------------------------------------------------------------------------------------------

export type Breakdown = { key: string; label: string; minutes: number };

export type Summary = {
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  byActivity: Breakdown[];
  byPerson: Breakdown[];
  byCurrency: Array<{
    currency: string;
    costMinor: number;
    pricedMinutes: number;
  }>;
  unpricedMinutes: number;
};

/** Work items whose time rolls up into `rootId`: the item and every descendant (TC-7). */
function descendantIds(workspaceId: string, rootId: string): SQL {
  return sql`(WITH RECURSIVE tree(id) AS (
      SELECT wi.id FROM work_item wi WHERE wi.id = ${rootId} AND wi.workspace_id = ${workspaceId}
      UNION
      SELECT c.id FROM work_item c JOIN tree t ON c.parent_id = t.id
      WHERE c.workspace_id = ${workspaceId} AND c.deleted_at IS NULL
    ) SELECT id FROM tree)`;
}

export async function summarise(
  identity: ResolvedIdentity,
  scope: {
    workspaceId: string;
    workItemId?: string;
    projectId?: string;
    cycleId?: string;
    moduleId?: string;
    from?: string;
    to?: string;
    /** Limits every figure to one person's entries (callers without `time_entry:read_any`). */
    personId?: string;
  },
  executor: Executor = db,
): Promise<Summary> {
  const where = and(
    eq(timeEntryTable.workspaceId, scope.workspaceId),
    scope.personId ? eq(timeEntryTable.personId, scope.personId) : undefined,
    projectReach(identity, executor),
    scope.workItemId
      ? sql`${timeEntryTable.workItemId} IN ${descendantIds(scope.workspaceId, scope.workItemId)}`
      : undefined,
    scope.projectId ? eq(timeEntryTable.projectId, scope.projectId) : undefined,
    // TC-7: a cycle's or module's time is the time on the work items assigned to it.
    scope.cycleId
      ? sql`${timeEntryTable.workItemId} IN (SELECT wi.id FROM work_item wi WHERE wi.workspace_id = ${scope.workspaceId} AND wi.cycle_id = ${scope.cycleId})`
      : undefined,
    scope.moduleId
      ? sql`${timeEntryTable.workItemId} IN (SELECT wi.id FROM work_item wi WHERE wi.workspace_id = ${scope.workspaceId} AND wi.module_id = ${scope.moduleId})`
      : undefined,
    scope.from ? gte(timeEntryTable.date, scope.from) : undefined,
    scope.to ? lte(timeEntryTable.date, scope.to) : undefined,
  );

  const [totals] = await executor
    .select({
      totalMinutes: sql<number>`coalesce(sum(${timeEntryTable.minutes}), 0)::int`,
      billableMinutes: sql<number>`coalesce(sum(${timeEntryTable.minutes}) filter (where ${timeEntryTable.billable}), 0)::int`,
      entryCount: sql<number>`count(*)::int`,
      unpricedMinutes: sql<number>`coalesce(sum(${timeEntryTable.minutes}) filter (where ${timeEntryTable.rateMinor} is null), 0)::int`,
    })
    .from(timeEntryTable)
    .innerJoin(projectTable, eq(projectTable.id, timeEntryTable.projectId))
    .where(where);

  const byActivity = await executor
    .select({
      key: timeEntryTable.activityId,
      label: timeActivityTable.name,
      minutes: sql<number>`sum(${timeEntryTable.minutes})::int`,
    })
    .from(timeEntryTable)
    .innerJoin(projectTable, eq(projectTable.id, timeEntryTable.projectId))
    .innerJoin(
      timeActivityTable,
      eq(timeActivityTable.id, timeEntryTable.activityId),
    )
    .where(where)
    .groupBy(timeEntryTable.activityId, timeActivityTable.name)
    .orderBy(desc(sql`sum(${timeEntryTable.minutes})`));

  const byPerson = await executor
    .select({
      key: timeEntryTable.personId,
      label: sql<string>`coalesce(${personTable.displayName}, ${userTable.name}, ${timeEntryTable.personId})`,
      minutes: sql<number>`sum(${timeEntryTable.minutes})::int`,
    })
    .from(timeEntryTable)
    .innerJoin(projectTable, eq(projectTable.id, timeEntryTable.projectId))
    .innerJoin(personTable, eq(personTable.id, timeEntryTable.personId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(where)
    .groupBy(timeEntryTable.personId, personTable.displayName, userTable.name)
    .orderBy(desc(sql`sum(${timeEntryTable.minutes})`));

  const byCurrency = await executor
    .select({
      currency: sql<string>`${timeEntryTable.currency}`,
      costMinor: sql<string>`coalesce(sum((${timeEntryTable.minutes}::bigint * ${timeEntryTable.rateMinor} + 30) / 60), 0)::text`,
      pricedMinutes: sql<number>`sum(${timeEntryTable.minutes})::int`,
    })
    .from(timeEntryTable)
    .innerJoin(projectTable, eq(projectTable.id, timeEntryTable.projectId))
    .where(and(where, sql`${timeEntryTable.rateMinor} is not null`))
    .groupBy(timeEntryTable.currency)
    .orderBy(asc(timeEntryTable.currency));

  return {
    totalMinutes: totals?.totalMinutes ?? 0,
    billableMinutes: totals?.billableMinutes ?? 0,
    entryCount: totals?.entryCount ?? 0,
    byActivity,
    byPerson,
    byCurrency: byCurrency.map((row) => ({
      currency: row.currency,
      costMinor: Number(row.costMinor),
      pricedMinutes: row.pricedMinutes,
    })),
    unpricedMinutes: totals?.unpricedMinutes ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Settings (TC-3, TC-4)
// ---------------------------------------------------------------------------------------------

export async function getTimeSettings(
  identity: ResolvedIdentity,
  workspaceId: string,
  projectId: string | undefined,
  executor: Executor = db,
) {
  let project: { id: string; defaultBillable: boolean } | null = null;
  if (projectId) {
    const [row] = await executor
      .select({
        id: projectTable.id,
        defaultBillable: projectTable.defaultBillable,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, workspaceId),
          projectReach(identity, executor),
        ),
      )
      .limit(1);
    project = row ?? null;
  }
  return {
    backdateLimitDays: await backdateLimitDays(executor, workspaceId),
    project,
  };
}

export async function updateTimeSettings(input: {
  identity: ResolvedIdentity;
  workspaceId: string;
  backdateLimitDays?: number;
  project?: { id: string; defaultBillable: boolean };
  actor: TimeActor;
}) {
  await db.transaction(async (tx) => {
    const changed: Record<string, unknown> = {};
    if (input.backdateLimitDays !== undefined) {
      const [before] = await tx
        .select({ days: workspaceTable.timeEntryBackdateLimitDays })
        .from(workspaceTable)
        .where(eq(workspaceTable.id, input.workspaceId))
        .for("update");
      await tx
        .update(workspaceTable)
        .set({ timeEntryBackdateLimitDays: input.backdateLimitDays })
        .where(eq(workspaceTable.id, input.workspaceId));
      changed.backdateLimitDays = {
        from: before?.days ?? null,
        to: input.backdateLimitDays,
      };
    }
    if (input.project) {
      const [row] = await tx
        .select({
          id: projectTable.id,
          defaultBillable: projectTable.defaultBillable,
        })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, input.project.id),
            eq(projectTable.workspaceId, input.workspaceId),
            isNull(projectTable.archivedAt),
            projectReach(input.identity, tx),
          ),
        )
        .for("update");
      if (!row) throw new HTTPException(404, { message: "Project not found" });
      await tx
        .update(projectTable)
        .set({ defaultBillable: input.project.defaultBillable })
        .where(eq(projectTable.id, row.id));
      changed.projectDefaultBillable = {
        projectId: row.id,
        from: row.defaultBillable,
        to: input.project.defaultBillable,
      };
    }
    await auditTime(tx, {
      action: "time_settings.updated",
      workspaceId: input.workspaceId,
      projectId: input.project?.id ?? null,
      entityType: "workspace",
      entityId: input.workspaceId,
      actor: input.actor,
      after: changed,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Rates (TC-8..TC-11)
// ---------------------------------------------------------------------------------------------

export async function listRates(
  workspaceId: string,
  personId: string | undefined,
  executor: Executor = db,
) {
  return executor
    .select({
      id: hourlyRateTable.id,
      workspaceId: hourlyRateTable.workspaceId,
      personId: hourlyRateTable.personId,
      personName: sql<
        string | null
      >`coalesce(${personTable.displayName}, ${userTable.name})`,
      projectId: hourlyRateTable.projectId,
      rateMinor: hourlyRateTable.rateMinor,
      currency: hourlyRateTable.currency,
      effectiveFrom: hourlyRateTable.effectiveFrom,
      createdAt: hourlyRateTable.createdAt,
    })
    .from(hourlyRateTable)
    .innerJoin(personTable, eq(personTable.id, hourlyRateTable.personId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(
      and(
        eq(hourlyRateTable.workspaceId, workspaceId),
        personId ? eq(hourlyRateTable.personId, personId) : undefined,
      ),
    )
    .orderBy(
      asc(hourlyRateTable.personId),
      desc(hourlyRateTable.effectiveFrom),
    );
}

/** Active staff members of the workspace: who can be given an hourly rate. */
export async function listRatePeople(
  workspaceId: string,
  executor: Executor = db,
) {
  const rows = await executor
    .select({
      personId: personTable.id,
      name: sql<string>`coalesce(${personTable.displayName}, ${userTable.name}, ${personTable.id})`,
    })
    .from(personTable)
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(and(eq(personTable.active, true), eq(personTable.side, "staff")));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createRate(input: {
  workspaceId: string;
  personId: string;
  projectId: string | null;
  rateMinor: number;
  currency: string;
  effectiveFrom: string;
  actor: TimeActor;
}) {
  try {
    return await db.transaction(async (tx) => {
      const person = await loadTimePerson(
        tx,
        input.workspaceId,
        input.personId,
      );
      if (!person)
        throw new HTTPException(404, { message: "Person not found" });
      if (input.projectId) {
        const [project] = await tx
          .select({ id: projectTable.id })
          .from(projectTable)
          .where(
            and(
              eq(projectTable.id, input.projectId),
              eq(projectTable.workspaceId, input.workspaceId),
              isNull(projectTable.deletedAt),
            ),
          )
          .limit(1);
        if (!project)
          throw new HTTPException(404, { message: "Project not found" });
      }
      const row = one(
        (
          await tx
            .insert(hourlyRateTable)
            .values({
              id: createId(),
              workspaceId: input.workspaceId,
              personId: input.personId,
              projectId: input.projectId,
              rateMinor: input.rateMinor,
              currency: input.currency,
              effectiveFrom: input.effectiveFrom,
              createdBy: input.actor.userId,
            })
            .returning()
        )[0],
      );
      await auditTime(tx, {
        action: "hourly_rate.created",
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        entityType: "hourly_rate",
        entityId: row.id,
        actor: input.actor,
        after: {
          personId: input.personId,
          projectId: input.projectId,
          // The amount and currency are rate data (TC-11): the audit log is readable with
          // workspace:manage_settings alone, so it records only that a rate was set.
          rateSet: true,
          effectiveFrom: input.effectiveFrom,
        },
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new HTTPException(409, {
        message:
          "A rate already starts on this date for this person and project",
      });
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Budgets (TC-15..TC-19)
// ---------------------------------------------------------------------------------------------

export async function loadReachableProject(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [project] = await executor
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      archivedAt: projectTable.archivedAt,
    })
    .from(projectTable)
    .where(
      and(eq(projectTable.id, projectId), projectReach(identity, executor)),
    )
    .limit(1);
  return project;
}

export async function listBudgets(
  identity: ResolvedIdentity,
  workspaceId: string,
  projectId: string,
  executor: Executor = db,
  /**
   * False for callers without `time_entry:manage_rates`: every actual is priced time, and
   * successive polls of it would reveal a colleague's hourly rate (TC-11), so none is computed.
   */
  withActuals = true,
) {
  const budgets = await executor
    .select()
    .from(budgetTable)
    .where(
      and(
        eq(budgetTable.workspaceId, workspaceId),
        eq(budgetTable.projectId, projectId),
      ),
    )
    .orderBy(desc(budgetTable.periodStart), asc(budgetTable.name));
  const result = [] as Array<{
    budget: (typeof budgets)[number];
    actuals: {
      actualMinor: number;
      otherCurrencies: Summary["byCurrency"];
      unpricedMinutes: number;
      threshold: 75 | 90 | null;
    } | null;
  }>;
  for (const budget of budgets) {
    if (!withActuals) {
      result.push({ budget, actuals: null });
      continue;
    }
    const summary = await summarise(
      identity,
      {
        workspaceId,
        projectId,
        from: budget.periodStart,
        to: budget.periodEnd,
      },
      executor,
    );
    const own = summary.byCurrency.find(
      (row) => row.currency === budget.currency,
    );
    const actualMinor = own?.costMinor ?? 0;
    result.push({
      budget,
      actuals: {
        actualMinor,
        otherCurrencies: summary.byCurrency.filter(
          (row) => row.currency !== budget.currency,
        ),
        unpricedMinutes: summary.unpricedMinutes,
        threshold: budgetThreshold(budget.plannedAmountMinor, actualMinor),
      },
    });
  }
  return result;
}

export async function createBudget(input: {
  workspaceId: string;
  projectId: string;
  name: string;
  plannedAmountMinor: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  actor: TimeActor;
}) {
  return db.transaction(async (tx) => {
    const row = one(
      (
        await tx
          .insert(budgetTable)
          .values({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            name: input.name,
            plannedAmountMinor: input.plannedAmountMinor,
            currency: input.currency,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            createdBy: input.actor.userId,
          })
          .returning()
      )[0],
    );
    await auditTime(tx, {
      action: "budget.created",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      entityType: "budget",
      entityId: row.id,
      actor: input.actor,
      after: {
        name: row.name,
        plannedAmountMinor: row.plannedAmountMinor,
        currency: row.currency,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      },
    });
    return row;
  });
}
