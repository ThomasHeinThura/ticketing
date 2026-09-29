import type { JsonValue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import {
  type AppendAuditLogInput,
  appendAuditLog,
} from "../audit/audit-writer";
import db from "../database";
import { serviceCalendarTable } from "../database/schema";

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
  } catch (error) {
    console.error("AU-14: service-calendar audit write failed", {
      action: input.action,
      entityId: input.entityId,
      error,
    });
  }
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

export const listCalendars = (workspaceId: string) =>
  db
    .select()
    .from(serviceCalendarTable)
    .where(eq(serviceCalendarTable.workspaceId, workspaceId))
    .orderBy(serviceCalendarTable.name);
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
  return db.transaction(async (tx) => {
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
    await appendCalendarAudit(tx, {
      ...input.actor,
      workspaceId: input.workspaceId,
      action: "service_calendar.created",
      entityType: "service_calendar",
      entityId: row.id,
      after: auditSnapshot(row),
    });
    return row;
  });
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
  actor: CalendarActor,
) {
  return db.transaction(async (tx) => {
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
    const [row] = await tx
      .update(serviceCalendarTable)
      .set(input)
      .where(
        and(
          eq(serviceCalendarTable.id, id),
          eq(serviceCalendarTable.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!row) return undefined;
    await appendCalendarAudit(tx, {
      ...actor,
      workspaceId,
      action: "service_calendar.updated",
      entityType: "service_calendar",
      entityId: row.id,
      before: auditSnapshot(before),
      after: auditSnapshot(row),
    });
    return { before, row };
  });
}
