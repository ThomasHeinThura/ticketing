import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { type Holiday, holidayImportIdentity } from "@taskdesk/domain";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type AppendAuditLogInput,
  appendAuditLog,
} from "../audit/audit-writer";
import db from "../database";
import {
  apikeyTable,
  serviceCalendarTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { enqueueOutboxEvent } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";

type CalendarActor = {
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

type CalendarTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function appendCalendarAudit(
  tx: CalendarTransaction,
  input: AppendAuditLogInput,
) {
  try {
    // An audit failure rolls back only this savepoint; the calendar write still commits.
    await tx.transaction(async (auditTx) => appendAuditLog(auditTx, input));
  } catch {
    // The calendar mutation commits independently from its audit savepoint. Record
    // the bounded operational signal here, then notify admins after the outer
    // calendar transaction commits. Never log audit input or the raw error.
    recordAuditWriteFailure("mutation");
    return true;
  }
  return false;
}

async function appendCalendarEvent(
  tx: CalendarTransaction,
  input: {
    kind: "service_calendar.created" | "service_calendar.updated";
    calendar: typeof serviceCalendarTable.$inferSelect;
    actor: CalendarActor;
    changedFields?: Array<"name" | "timezone" | "windows" | "holidays">;
  },
) {
  const [context] = await tx
    .select({
      actorName: userTable.name,
      organisationId: workspaceTable.organisationId,
    })
    .from(workspaceTable)
    .innerJoin(userTable, eq(userTable.id, input.actor.actorId))
    .where(eq(workspaceTable.id, input.calendar.workspaceId))
    .limit(1);
  if (!context) {
    throw new Error("Could not resolve service-calendar event actor or scope");
  }

  let eventActor = {
    type: input.actor.actorType,
    id: input.actor.actorId,
    name: context.actorName,
  };
  if (input.actor.actorType === "api_key") {
    if (!input.actor.apiKeyId) {
      throw new Error("Could not resolve service-calendar API-key actor");
    }
    const [apiKey] = await tx
      .select({ id: apikeyTable.id, name: apikeyTable.name })
      .from(apikeyTable)
      .where(
        and(
          eq(apikeyTable.id, input.actor.apiKeyId),
          eq(apikeyTable.referenceId, input.actor.actorId),
        ),
      )
      .limit(1);
    if (!apiKey) {
      throw new Error("Could not resolve service-calendar API-key actor");
    }
    eventActor = {
      type: "api_key",
      id: apiKey.id,
      name: apiKey.name ?? apiKey.id,
    };
  }

  const payload = {
    key: input.calendar.id,
    url: `/agent/settings/calendars/${input.calendar.id}`,
    calendarId: input.calendar.id,
    workspaceId: input.calendar.workspaceId,
    name: input.calendar.name,
    ...(input.kind === "service_calendar.updated"
      ? { changedFields: input.changedFields ?? [] }
      : {}),
  };

  await enqueueOutboxEvent(tx, {
    id: `evt_${createId()}`,
    kind: input.kind,
    occurredAt: new Date().toISOString(),
    actor: eventActor,
    scope: {
      workspaceId: input.calendar.workspaceId,
      ...(context.organisationId
        ? { organisationId: context.organisationId }
        : {}),
    },
    payload,
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
}

const CALENDAR_EVENT_FIELDS = [
  "name",
  "timezone",
  "windows",
  "holidays",
] as const;

function changedCalendarFields(
  before: typeof serviceCalendarTable.$inferSelect,
  after: typeof serviceCalendarTable.$inferSelect,
) {
  return CALENDAR_EVENT_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

function auditSnapshot(calendar: {
  name: string;
  timezone: string;
  windows: unknown;
  holidays: unknown;
}) {
  return JSON.parse(
    JSON.stringify({
      name: calendar.name,
      timezone: calendar.timezone,
      windows: calendar.windows,
      holidays: calendar.holidays,
    }),
  ) as JsonValue;
}

type CalendarCursor = {
  v: 1;
  workspaceId: string;
  name: string;
  id: string;
  direction: "after" | "before";
};

function encodeCalendarCursor(
  row: { name: string; id: string },
  workspaceId: string,
  direction: CalendarCursor["direction"],
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      workspaceId,
      name: row.name,
      id: row.id,
      direction,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCalendarCursor(
  cursor: string,
  workspaceId: string,
): CalendarCursor {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as CalendarCursor).v !== 1 ||
    (parsed as CalendarCursor).workspaceId !== workspaceId ||
    typeof (parsed as CalendarCursor).name !== "string" ||
    (parsed as CalendarCursor).name.length === 0 ||
    (parsed as CalendarCursor).name.length > 120 ||
    (parsed as CalendarCursor).name.includes("\u0000") ||
    typeof (parsed as CalendarCursor).id !== "string" ||
    (parsed as CalendarCursor).id.length === 0 ||
    (parsed as CalendarCursor).id.length > 64 ||
    (parsed as CalendarCursor).id.includes("\u0000") ||
    ((parsed as CalendarCursor).direction !== "after" &&
      (parsed as CalendarCursor).direction !== "before") ||
    Object.keys(parsed).sort().join(",") !== "direction,id,name,v,workspaceId"
  ) {
    throw new HTTPException(400, {
      message: "cursor: malformed or belongs to another workspace",
    });
  }
  return parsed as CalendarCursor;
}

export async function listCalendars(
  workspaceId: string,
  options: { cursor?: string; limit: number },
) {
  const cursor = options.cursor
    ? decodeCalendarCursor(options.cursor, workspaceId)
    : undefined;
  const cursorPredicate = cursor
    ? cursor.direction === "after"
      ? sql`(${serviceCalendarTable.name}, ${serviceCalendarTable.id}) > (${cursor.name}, ${cursor.id})`
      : sql`(${serviceCalendarTable.name}, ${serviceCalendarTable.id}) < (${cursor.name}, ${cursor.id})`
    : undefined;
  const rows = await db
    .select()
    .from(serviceCalendarTable)
    .where(
      and(eq(serviceCalendarTable.workspaceId, workspaceId), cursorPredicate),
    )
    .orderBy(
      cursor?.direction === "before"
        ? desc(serviceCalendarTable.name)
        : asc(serviceCalendarTable.name),
      cursor?.direction === "before"
        ? desc(serviceCalendarTable.id)
        : asc(serviceCalendarTable.id),
    )
    .limit(options.limit);
  const data = cursor?.direction === "before" ? rows.reverse() : rows;
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(serviceCalendarTable)
    .where(eq(serviceCalendarTable.workspaceId, workspaceId));
  const first = data[0];
  const last = data.at(-1);
  const [hasPrevious] = first
    ? await db
        .select({ id: serviceCalendarTable.id })
        .from(serviceCalendarTable)
        .where(
          and(
            eq(serviceCalendarTable.workspaceId, workspaceId),
            sql`(${serviceCalendarTable.name}, ${serviceCalendarTable.id}) < (${first.name}, ${first.id})`,
          ),
        )
        .limit(1)
    : [];
  const [hasNext] = last
    ? await db
        .select({ id: serviceCalendarTable.id })
        .from(serviceCalendarTable)
        .where(
          and(
            eq(serviceCalendarTable.workspaceId, workspaceId),
            sql`(${serviceCalendarTable.name}, ${serviceCalendarTable.id}) > (${last.name}, ${last.id})`,
          ),
        )
        .limit(1)
    : [];
  const nextCursor =
    hasNext && last ? encodeCalendarCursor(last, workspaceId, "after") : null;
  return {
    data,
    page: {
      previousCursor:
        hasPrevious && first
          ? encodeCalendarCursor(first, workspaceId, "before")
          : null,
      nextCursor,
      hasMore: nextCursor !== null,
    },
    meta: { total: count?.total ?? 0 },
  };
}
export const getCalendar = async (id: string, workspaceId: string) =>
  (
    await db
      .select()
      .from(serviceCalendarTable)
      .where(eq(serviceCalendarTable.id, id))
      .limit(1)
  ).find((row) => row.workspaceId === workspaceId);
export async function createCalendar(input: {
  workspaceId: string;
  name: string;
  timezone: string;
  windows: unknown;
  holidays: unknown;
  actor: CalendarActor;
}) {
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(serviceCalendarTable)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        timezone: input.timezone,
        windows: input.windows,
        holidays: input.holidays,
      })
      .returning();
    if (!row) throw new Error("Calendar insert returned no row");
    const auditFailed = await appendCalendarAudit(tx, {
      ...input.actor,
      workspaceId: input.workspaceId,
      action: "service_calendar.created",
      entityType: "service_calendar",
      entityId: row.id,
      after: auditSnapshot(row),
    });
    await appendCalendarEvent(tx, {
      kind: "service_calendar.created",
      calendar: row,
      actor: input.actor,
    });
    return { row, auditFailed };
  });
  if (outcome.auditFailed) {
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  return outcome.row;
}
export class ServiceCalendarVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Version mismatch: expected version ${assertedVersion}, but the calendar is now at version ${currentVersion}`,
    );
    this.name = "ServiceCalendarVersionConflictError";
  }
}

export async function updateCalendar(
  id: string,
  workspaceId: string,
  input: {
    name?: string;
    timezone?: string;
    windows?: unknown;
    holidays?: unknown;
  },
  assertedVersion: number | undefined,
  actor: CalendarActor,
) {
  const outcome = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(serviceCalendarTable)
      .where(
        and(
          eq(serviceCalendarTable.id, id),
          eq(serviceCalendarTable.workspaceId, workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!before) return undefined;
    if (assertedVersion !== undefined && before.version !== assertedVersion) {
      throw new ServiceCalendarVersionConflictError(
        assertedVersion,
        before.version,
      );
    }
    const [row] = await tx
      .update(serviceCalendarTable)
      .set({
        ...input,
        version: sql`${serviceCalendarTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceCalendarTable.id, id),
          eq(serviceCalendarTable.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!row) return undefined;
    const auditFailed = await appendCalendarAudit(tx, {
      ...actor,
      workspaceId,
      action: "service_calendar.updated",
      entityType: "service_calendar",
      entityId: row.id,
      before: auditSnapshot(before),
      after: auditSnapshot(row),
    });
    await appendCalendarEvent(tx, {
      kind: "service_calendar.updated",
      calendar: row,
      actor,
      changedFields: changedCalendarFields(before, row),
    });
    return { value: { before, row }, auditFailed };
  });
  if (outcome?.auditFailed) {
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  return outcome?.value;
}

export async function importCalendarHolidays(
  id: string,
  workspaceId: string,
  imported: Holiday[],
  assertedVersion: number | undefined,
  actor: CalendarActor,
) {
  const outcome = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(serviceCalendarTable)
      .where(
        and(
          eq(serviceCalendarTable.id, id),
          eq(serviceCalendarTable.workspaceId, workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!before) return undefined;
    if (assertedVersion !== undefined && before.version !== assertedVersion)
      throw new ServiceCalendarVersionConflictError(
        assertedVersion,
        before.version,
      );
    const existing = new Set(
      (before.holidays as Holiday[]).map(holidayImportIdentity),
    );
    const additions: Holiday[] = [];
    let duplicateCount = 0;
    for (const holiday of imported) {
      const identity = holidayImportIdentity(holiday);
      if (existing.has(identity)) duplicateCount++;
      else {
        existing.add(identity);
        additions.push(holiday);
      }
    }
    if (additions.length === 0)
      return {
        value: { row: before, importedCount: 0, duplicateCount },
        auditFailed: false,
      };
    const [row] = await tx
      .update(serviceCalendarTable)
      .set({
        holidays: [...(before.holidays as Holiday[]), ...additions],
        version: sql`${serviceCalendarTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceCalendarTable.id, id),
          eq(serviceCalendarTable.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!row) return undefined;
    const auditFailed = await appendCalendarAudit(tx, {
      ...actor,
      workspaceId,
      action: "service_calendar.updated",
      entityType: "service_calendar",
      entityId: row.id,
      before: auditSnapshot(before),
      after: auditSnapshot(row),
    });
    await appendCalendarEvent(tx, {
      kind: "service_calendar.updated",
      calendar: row,
      actor,
      changedFields: ["holidays"],
    });
    return {
      value: { row, importedCount: additions.length, duplicateCount },
      auditFailed,
    };
  });
  if (outcome?.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return outcome?.value;
}
