import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { defineNotificationOutboxSuite } from "./helpers/notification-outbox-suite";

describe("notification JSONB driver materialization", () => {
  const eventIds: string[] = [];
  let organisationId = "";
  let workspaceId = "";

  beforeEach(async () => {
    eventIds.length = 0;
    await resetTestDatabase();
    const suffix = randomUUID();
    organisationId = `jsonb-test-org-${suffix}`;
    workspaceId = `jsonb-test-workspace-${suffix}`;
    await db.insert(schema.organisationTable).values({
      id: organisationId,
      key: `jsonb-test-${suffix}`,
      name: "JSONB materialization test",
    });
    await db.insert(schema.workspaceTable).values({
      id: workspaceId,
      organisationId,
      name: "JSONB materialization test",
      slug: `jsonb-test-${suffix}`,
      createdAt: new Date(),
    });
  });

  afterEach(async () => {
    if (eventIds.length)
      await db
        .delete(schema.outboxTable)
        .where(inArray(schema.outboxTable.eventId, eventIds));
    if (workspaceId)
      await db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
    if (organisationId)
      await db
        .delete(schema.organisationTable)
        .where(eq(schema.organisationTable.id, organisationId));
  });

  it("preserves typed and raw JSONB driver values", async () => {
    const jsonTextId = `evt_${randomUUID()}`;
    const ordinaryStringId = `evt_${randomUUID()}`;
    const nestedId = `evt_${randomUUID()}`;
    const nullId = `evt_${randomUUID()}`;
    const overflowId = `evt_${randomUUID()}`;
    eventIds.push(jsonTextId, ordinaryStringId, nestedId, nullId, overflowId);

    await db.insert(schema.outboxTable).values([
      {
        eventId: jsonTextId,
        kind: "materialization.probe",
        payload: "123",
        workspaceId,
        organisationId,
      },
      {
        eventId: ordinaryStringId,
        kind: "materialization.probe",
        payload: "ordinary text",
        workspaceId,
        organisationId,
      },
      {
        eventId: nestedId,
        kind: "materialization.probe",
        payload: { values: [true, false, null, { text: "kept" }] },
        workspaceId,
        organisationId,
      },
    ]);
    await db.execute(sql`
      INSERT INTO outbox (event_id, kind, payload, workspace_id, organisation_id)
      VALUES
        (
          ${nullId},
          'materialization.probe',
          'null'::jsonb,
          ${workspaceId},
          ${organisationId}
        ),
        (
          ${overflowId},
          'materialization.probe',
          '1e400'::jsonb,
          ${workspaceId},
          ${organisationId}
        )
    `);

    const typed = await db
      .select({
        eventId: schema.outboxTable.eventId,
        payload: schema.outboxTable.payload,
      })
      .from(schema.outboxTable)
      .where(inArray(schema.outboxTable.eventId, eventIds));
    const raw = await db.execute<{
      eventId: string;
      payload: unknown;
      sqlNull: boolean;
    }>(sql`
      SELECT event_id AS "eventId", payload, payload IS NULL AS "sqlNull"
        FROM outbox
       WHERE ${inArray(schema.outboxTable.eventId, eventIds)}
    `);
    const typedById = new Map(typed.map((row) => [row.eventId, row.payload]));
    const rawById = new Map(raw.rows.map((row) => [row.eventId, row.payload]));

    expect(typedById.get(jsonTextId)).toBe(123);
    expect(rawById.get(jsonTextId)).toBe("123");
    expect(typedById.get(ordinaryStringId)).toBe("ordinary text");
    expect(rawById.get(ordinaryStringId)).toBe("ordinary text");
    expect(typedById.get(nestedId)).toEqual({
      values: [true, false, null, { text: "kept" }],
    });
    expect(rawById.get(nestedId)).toEqual({
      values: [true, false, null, { text: "kept" }],
    });
    expect(typedById.get(nullId)).toBeNull();
    expect(rawById.get(nullId)).toBeNull();
    expect(raw.rows.find((row) => row.eventId === nullId)?.sqlNull).toBe(false);
    expect(typedById.get(overflowId)).toBe(Number.POSITIVE_INFINITY);
    expect(rawById.get(overflowId)).toBe(Number.POSITIVE_INFINITY);
  });
});

vi.mock(
  "../../apps/api/src/database/repositories/notification-delivery.repository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/database/repositories/notification-delivery.repository")
      >();
    const faults = () =>
      (
        globalThis as {
          __outboxFaults?: { renewal?: boolean; contention?: boolean };
        }
      ).__outboxFaults;
    return {
      ...actual,
      renewNotificationReservation: (
        ...args: Parameters<typeof actual.renewNotificationReservation>
      ) => {
        if (faults()?.renewal) throw new Error("injected renewal failure");
        return actual.renewNotificationReservation(...args);
      },
      acquireNotificationReservation: (
        ...args: Parameters<typeof actual.acquireNotificationReservation>
      ) => {
        if (faults()?.contention)
          throw new actual.NotificationReservationContentionError();
        return actual.acquireNotificationReservation(...args);
      },
    };
  },
);

defineNotificationOutboxSuite("TZ=UTC");
