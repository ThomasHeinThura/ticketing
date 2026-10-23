/**
 * Parent outbox consumer (`EV-1`/`EV-2`, `outbox-drain`): due `pending` parents are claimed with
 * `SKIP LOCKED`, delivered once, retried with backoff on consumer failure, and dead-lettered at
 * the attempt cap. A replay never re-processes a terminal parent, and event-derived inbox rows
 * are idempotent through `notification_event_person_unique`.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { enqueueOutboxEvent } from "../../apps/api/src/events/outbox";
import {
  type ParentEventConsumer,
  processNextParentEvent,
} from "../../apps/api/src/events/outbox-consumer";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function enqueue(workspaceId: string) {
  const id = `evt_${randomUUID()}`;
  await db.transaction((tx) =>
    enqueueOutboxEvent(tx, {
      id,
      kind: "work_item.created",
      occurredAt: new Date().toISOString(),
      actor: { type: "system", id: null, name: "System" },
      scope: { workspaceId },
      payload: { key: "TEST-1" },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    }),
  );
  return id;
}

async function parent(eventId: string) {
  return requireRow(
    await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.eventId, eventId)),
    "outbox parent",
  );
}

function failing(name = "failing"): ParentEventConsumer {
  return {
    name,
    handles: () => true,
    handle: async () => {
      throw new TypeError("consumer failed");
    },
  };
}

describe("parent outbox consumer", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("delivers a due parent once and never re-claims it on replay", async () => {
    const { workspace } = await createWorkspaceMember();
    const eventId = await enqueue(workspace.id);
    const seen: string[] = [];
    const recorder: ParentEventConsumer = {
      name: "recorder",
      handles: () => true,
      handle: async (_tx, envelope) => {
        seen.push(envelope.id);
      },
    };

    await expect(processNextParentEvent([recorder])).resolves.toEqual({
      kind: "delivered",
      eventId,
    });
    await expect(processNextParentEvent([recorder])).resolves.toEqual({
      kind: "idle",
    });
    expect(seen).toEqual([eventId]);
    expect(await parent(eventId)).toMatchObject({
      state: "delivered",
      attempts: 1,
      lastError: null,
    });
  });

  it("rolls back a failing consumer's writes, records a bounded error and backs off", async () => {
    const { workspace } = await createWorkspaceMember();
    const eventId = await enqueue(workspace.id);
    const writer: ParentEventConsumer = {
      name: "writer",
      handles: () => true,
      handle: async (tx) => {
        await tx.execute(
          sql`UPDATE outbox SET dedupe_key = 'written-by-consumer' WHERE event_id = ${eventId}`,
        );
        throw new TypeError("after write");
      },
    };

    await expect(processNextParentEvent([writer])).resolves.toEqual({
      kind: "retry",
      eventId,
    });
    const row = await parent(eventId);
    expect(row).toMatchObject({
      state: "pending",
      attempts: 1,
      lastError: "writer:TypeError",
      dedupeKey: null,
    });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    // Not due yet: a second drain does not retry it immediately.
    await expect(processNextParentEvent([writer])).resolves.toEqual({
      kind: "idle",
    });
  });

  it("dead-letters at the sixth failed attempt", async () => {
    const { workspace } = await createWorkspaceMember();
    const eventId = await enqueue(workspace.id);
    await db
      .update(schema.outboxTable)
      .set({ attempts: 5 })
      .where(eq(schema.outboxTable.eventId, eventId));

    await expect(processNextParentEvent([failing()])).resolves.toEqual({
      kind: "dead",
      eventId,
    });
    expect(await parent(eventId)).toMatchObject({ state: "dead", attempts: 6 });
  });

  it("lets concurrent drains process each parent exactly once (SKIP LOCKED)", async () => {
    const { workspace } = await createWorkspaceMember();
    const ids = [await enqueue(workspace.id), await enqueue(workspace.id)];
    const seen: string[] = [];
    const slow: ParentEventConsumer = {
      name: "slow",
      handles: () => true,
      handle: async (_tx, envelope) => {
        seen.push(envelope.id);
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    };

    const results = await Promise.all([
      processNextParentEvent([slow]),
      processNextParentEvent([slow]),
    ]);

    expect(results.map((result) => result.kind)).toEqual([
      "delivered",
      "delivered",
    ]);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("EV-2: replaying an event-derived inbox row for the same person is refused by the unique key", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const eventId = await enqueue(workspace.id);
    const person = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, user.id)),
      "person",
    );
    const row = {
      userId: user.id,
      personId: person.id,
      eventId,
      resourceType: "person",
      resourceId: person.id,
      type: "security_alert",
      title: "replay",
      content: "replay",
    } as typeof schema.notificationTable.$inferInsert;
    await db.insert(schema.notificationTable).values(row);
    await expect(
      db.insert(schema.notificationTable).values(row),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "notification_event_person_unique" },
    });
  });
});
