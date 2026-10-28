import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { notificationDeliveryTable } from "../../apps/api/src/database/schema";
import type { DomainEventEnvelope } from "../../apps/api/src/events/outbox";
import {
  enqueueNotificationEvent,
  materializeNotificationFanout,
  type NotificationFanoutHooks,
} from "../../apps/api/src/notification/fanout";
import { resetTestDatabase } from "./helpers/database";

/**
 * EV-2: replaying a parent event's fan-out never duplicates its children. The
 * `notification_event_person_unique` and `notification_delivery_event_recipient_channel_unique`
 * keys, with the repositories' `ON CONFLICT DO NOTHING`, make replay idempotent.
 * DB integration test: run only against a dedicated `_test` database.
 */
const organisationId = "organisation-fanout-replay";
const workspaceId = "workspace-fanout-replay";
const userId = "user-fanout-replay";
const personId = "person-fanout-replay";

function mentionEvent(): DomainEventEnvelope<Record<string, unknown>> {
  return {
    id: `evt_${randomUUID()}`,
    kind: "work_item.mentioned",
    occurredAt: new Date().toISOString(),
    actor: { type: "system", id: null, name: "TaskDesk" },
    scope: { workspaceId, organisationId },
    payload: { key: "SUP-1", workItemId: "work-item-fanout-replay" },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
}

const hooks: NotificationFanoutHooks = {
  // A fixed canonical recipient with one external channel; `work_item.mentioned` is
  // urgent and default-enabled for `notify.email`, so it materializes a delivery child.
  resolveRecipients: async () => [
    {
      personId,
      resourceType: "work_item",
      resourceId: "work-item-fanout-replay",
      title: "You were mentioned",
      body: "You were mentioned in a comment on SUP-1.",
      channels: ["notify.email"],
    },
  ],
};

async function childCounts(eventId: string) {
  const inbox = await db
    .select({ id: schema.notificationTable.id })
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.eventId, eventId));
  const deliveries = await db
    .select({ id: notificationDeliveryTable.id })
    .from(notificationDeliveryTable)
    .where(eq(notificationDeliveryTable.eventId, eventId));
  return { inbox: inbox.length, deliveries: deliveries.length };
}

describe("notification fan-out replay idempotency", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
    await db.insert(schema.organisationTable).values({
      id: organisationId,
      key: organisationId,
      name: "Fan-out replay organisation",
    });
    await db.insert(schema.userTable).values({
      id: userId,
      name: "Fan-out Replay Recipient",
      email: "fanout-replay@example.test",
    });
    await db.insert(schema.personTable).values({
      id: personId,
      userId,
      organisationId,
      side: "staff",
    });
    await db.insert(schema.workspaceTable).values({
      id: workspaceId,
      organisationId,
      name: "Fan-out replay workspace",
      slug: "fanout-replay",
      createdAt: new Date(),
    });
  });

  it("replaying fan-out in later transactions creates no duplicate inbox or delivery rows", async () => {
    const event = mentionEvent();
    await db.transaction((tx) => enqueueNotificationEvent(tx, event, hooks));
    expect(await childCounts(event.id)).toEqual({ inbox: 1, deliveries: 1 });

    for (let replay = 0; replay < 2; replay += 1)
      await db.transaction((tx) =>
        materializeNotificationFanout(tx, event, hooks),
      );
    expect(await childCounts(event.id)).toEqual({ inbox: 1, deliveries: 1 });
  });

  it("replaying fan-out in the same transaction creates no duplicate rows", async () => {
    const event = mentionEvent();
    await db.transaction(async (tx) => {
      await enqueueNotificationEvent(tx, event, hooks);
      await materializeNotificationFanout(tx, event, hooks);
    });
    expect(await childCounts(event.id)).toEqual({ inbox: 1, deliveries: 1 });
  });

  it("a different event for the same recipient is a separate notification", async () => {
    const first = mentionEvent();
    const second = mentionEvent();
    await db.transaction((tx) => enqueueNotificationEvent(tx, first, hooks));
    await db.transaction((tx) => enqueueNotificationEvent(tx, second, hooks));
    expect(await childCounts(first.id)).toEqual({ inbox: 1, deliveries: 1 });
    expect(await childCounts(second.id)).toEqual({ inbox: 1, deliveries: 1 });
  });
});
