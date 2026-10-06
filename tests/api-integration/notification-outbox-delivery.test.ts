import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import {
  acquireNotificationReservation,
  authorizeNotificationProviderAttempt,
  completeNotificationDelivery,
  hasRecentNotificationSuccess,
} from "../../apps/api/src/database/repositories/notification-delivery.repository";
import { evaluateCurrentNotificationReachAndPreference } from "../../apps/api/src/notification/current-eligibility";
import { notificationReservationKey } from "../../apps/api/src/notification/delivery-primitives";
import type { NotificationOutboxRuntime } from "../../apps/api/src/notification/outbox-drain";
import { processNextNotificationDelivery } from "../../apps/api/src/notification/outbox-drain";
import { seedDefaultWorkspaceRoles } from "../../apps/api/src/utils/seed-default-workspace-roles";
import { ensureTestDatabaseMigrated } from "./helpers/database";

const suffix = randomUUID().replaceAll("-", "");
const ids = {
  organisation: `notification-test-org-${suffix}`,
  workspace: `notification-test-workspace-${suffix}`,
  user: `notification-test-user-${suffix}`,
  person: `notification-test-person-${suffix}`,
};
const createdEvents: string[] = [];
const channel = "notify.email";
const dedupeKey = "notification:v1:integration-test";

async function makeEventAndDelivery(
  withInbox = false,
  mapping: {
    eventKind?: string;
    resourceType?: string;
    resourceId?: string;
    payload?: Record<string, unknown>;
  } = {},
) {
  const itemSuffix = randomUUID().replaceAll("-", "");
  const eventId = `notification-test-event-${itemSuffix}`;
  const deliveryId = `notification-test-delivery-${itemSuffix}`;
  const eventKind = mapping.eventKind ?? "work_item.assigned";
  createdEvents.push(eventId);
  await db.execute(sql`
    INSERT INTO outbox (event_id, kind, payload, workspace_id, organisation_id)
    VALUES (${eventId}, ${eventKind}, ${JSON.stringify({ id: eventId, kind: eventKind, payload: mapping.payload ?? {} })}::jsonb,
      ${ids.workspace}, ${ids.organisation})
  `);
  await db.execute(sql`
    INSERT INTO notification_delivery
      (id, event_id, recipient_person_id, channel, workspace_id, organisation_id, dedupe_key)
    VALUES (${deliveryId}, ${eventId}, ${ids.person}, ${channel}, ${ids.workspace}, ${ids.organisation}, ${dedupeKey})
  `);
  if (withInbox) {
    await db.execute(sql`
      INSERT INTO notification (id, user_id, person_id, event_id, kind, title, body,
                               resource_type, resource_id)
      VALUES (${`notification-${eventId}`}, ${ids.user}, ${ids.person}, ${eventId},
              ${eventKind}, 'Assigned', 'A safe summary', ${mapping.resourceType ?? "work_item"},
              ${mapping.resourceId ?? "item-1"})
    `);
  }
  return { eventId, deliveryId };
}

describe("outbox notification direct-delivery persistence", () => {
  beforeAll(async () => {
    const url = new URL(process.env.TASKDESK_DATABASE_URL ?? "");
    if (!url.pathname.replace(/^\//, "").endsWith("_test")) {
      throw new Error(
        "Refusing notification delivery integration test outside *_test database",
      );
    }
    await ensureTestDatabaseMigrated();
    await db.execute(
      sql`INSERT INTO organisation (id, key, name) VALUES (${ids.organisation}, ${suffix}, 'Notification test')`,
    );
    await db.execute(sql`INSERT INTO workspace (id, organisation_id, name, slug, created_at)
      VALUES (${ids.workspace}, ${ids.organisation}, 'Notification test', ${suffix}, clock_timestamp())`);
    await db.execute(
      sql`INSERT INTO "user" (id, name, email) VALUES (${ids.user}, 'Notification test', ${`${suffix}@example.invalid`})`,
    );
    await db.execute(sql`INSERT INTO person (id, user_id, organisation_id, side)
      VALUES (${ids.person}, ${ids.user}, ${ids.organisation}, 'staff')`);
    await seedDefaultWorkspaceRoles();
    await db.execute(sql`INSERT INTO workspace_member (id, workspace_id, user_id, role, joined_at)
      VALUES (${`notification-test-member-${suffix}`}, ${ids.workspace}, ${ids.user}, 'admin', clock_timestamp())`);
  });

  afterEach(async () => {
    for (const eventId of createdEvents.splice(0)) {
      await db.execute(sql`DELETE FROM outbox WHERE event_id = ${eventId}`);
    }
    await db.execute(
      sql`DELETE FROM notification_preference WHERE person_id = ${ids.person}`,
    );
    await db.execute(
      sql`UPDATE workspace SET deleted_at = NULL WHERE id = ${ids.workspace}`,
    );
    await db.execute(sql`UPDATE person SET quiet_hours_start = NULL, quiet_hours_end = NULL,
      quiet_hours_timezone = NULL WHERE id = ${ids.person}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM person WHERE id = ${ids.person}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${ids.user}`);
    await db.execute(sql`DELETE FROM workspace WHERE id = ${ids.workspace}`);
    await db.execute(
      sql`DELETE FROM organisation WHERE id = ${ids.organisation}`,
    );
  });

  it("serializes concurrent same-key attempts and samples expiry after the lock wait", async () => {
    const firstFixture = await makeEventAndDelivery();
    const secondFixture = await makeEventAndDelivery();
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const first = db.transaction(async (tx) => {
      const claim = await acquireNotificationReservation(tx, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        ownerDeliveryId: firstFixture.deliveryId,
      });
      acquired();
      await gate;
      return claim;
    });
    await firstAcquired;
    const second = db.transaction((tx) =>
      acquireNotificationReservation(tx, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        ownerDeliveryId: secondFixture.deliveryId,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    release();
    const [firstClaim, secondClaim] = await Promise.all([first, second]);
    expect(firstClaim.status).toBe("acquired");
    expect(secondClaim.status).toBe("deferred");

    const oldLease =
      firstClaim.status === "acquired" ? firstClaim.reservation : null;
    if (!oldLease) throw new Error("first reservation was not acquired");
    await db.execute(sql`UPDATE outbox_dedupe_reservation
      SET lease_expires_at = clock_timestamp() + interval '40 milliseconds'
      WHERE reservation_key = ${oldLease.key}`);
    let unlock!: () => void;
    let rowLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      rowLocked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const lockTx = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT 1 FROM outbox_dedupe_reservation WHERE reservation_key = ${oldLease.key} FOR UPDATE`,
      );
      rowLocked();
      await hold;
    });
    await locked;
    const takeover = db.transaction((tx) =>
      acquireNotificationReservation(tx, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        ownerDeliveryId: secondFixture.deliveryId,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    unlock();
    await lockTx;
    const takeoverClaim = await takeover;
    expect(takeoverClaim.status).toBe("acquired");
    if (takeoverClaim.status === "acquired") {
      expect(
        takeoverClaim.reservation.leaseExpiresAt.getTime(),
      ).toBeGreaterThan(Date.now() + 55_000);
    }
  });

  it("durably counts exactly six authorized provider attempts and dead-letters the sixth", async () => {
    const fixture = await makeEventAndDelivery();
    for (let expected = 1; expected <= 6; expected += 1) {
      await db.execute(sql`UPDATE notification_delivery SET next_attempt_at = clock_timestamp() - interval '1 second'
        WHERE id = ${fixture.deliveryId}`);
      const result = await db.transaction(async (tx) => {
        const claim = await acquireNotificationReservation(tx, {
          recipientPersonId: ids.person,
          channel,
          dedupeKey,
          ownerDeliveryId: fixture.deliveryId,
        });
        if (claim.status !== "acquired") return { claim, attempt: null };
        const attempt = await authorizeNotificationProviderAttempt(
          tx,
          fixture.deliveryId,
          claim.reservation,
        );
        const completed = await completeNotificationDelivery(
          tx,
          fixture.deliveryId,
          claim.reservation,
          {
            kind: "failed",
            errorCode: "provider_failed",
          },
        );
        return { claim, attempt, completed };
      });
      expect(result.claim.status).toBe("acquired");
      expect(result.attempt).toBe(expected);
      expect(result.completed).toBe(true);
    }
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 6, state: "dead" });
    expect(
      await hasRecentNotificationSuccess(db, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        excludeDeliveryId: fixture.deliveryId,
      }),
    ).toBe(false);
  });

  it("calls only the injected adapter after the fenced attempt, then commits child success", async () => {
    const fixture = await makeEventAndDelivery(true);
    let sent = 0;
    const runtime: NotificationOutboxRuntime = {
      evaluateCurrentEligibility: async () => ({
        kind: "eligible",
        projection: {
          title: "Assigned",
          body: "Safe",
          url: "/agent/work-items/item-1",
        },
      }),
      send: async (_channel, projection, options) => {
        expect(projection.body).toBe("Safe");
        expect(options.idempotencyKey).toBe(fixture.deliveryId);
        sent += 1;
      },
    };
    const result = await processNextNotificationDelivery(runtime);
    expect(result).toEqual({ kind: "delivered" });
    expect(sent).toBe(1);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 1, state: "delivered" });
  });

  it("suppresses after send-time reach denial without calling the adapter or consuming an attempt", async () => {
    const fixture = await makeEventAndDelivery(true);
    let sent = 0;
    const runtime: NotificationOutboxRuntime = {
      evaluateCurrentEligibility: async () => ({
        kind: "suppress",
        reason: "reach_lost",
      }),
      send: async () => {
        sent += 1;
      },
    };
    expect(await processNextNotificationDelivery(runtime)).toEqual({
      kind: "suppressed",
      reason: "reach_lost",
    });
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "suppressed" });
  });

  it("suppresses a resource deleted after enqueue before provider authorization", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "workspace.created",
      resourceType: "workspace",
      resourceId: ids.workspace,
      payload: { workspaceId: ids.workspace, ownerId: ids.user },
    });
    await db.execute(
      sql`UPDATE workspace SET deleted_at = clock_timestamp() WHERE id = ${ids.workspace}`,
    );
    let sent = 0;
    const runtime: NotificationOutboxRuntime = {
      evaluateCurrentEligibility: async (tx, delivery) => {
        const current = await evaluateCurrentNotificationReachAndPreference(
          tx,
          delivery,
        );
        if (current.kind === "quiet_hours_unresolved")
          throw new Error("Quiet-hours contract is unresolved");
        if (current.kind === "destination_unresolved")
          throw new Error("Resource destination contract is unresolved");
        return current;
      },
      send: async () => {
        sent += 1;
      },
    };

    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "suppressed",
      reason: "resource_unavailable",
    });
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "suppressed" });
  });

  it("uses the channel preference changed after enqueue and spends no provider attempt", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "workspace.created",
      resourceType: "workspace",
      resourceId: ids.workspace,
      payload: { workspaceId: ids.workspace, ownerId: ids.user },
    });
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${ids.person}, 'global', NULL, ${channel}, 'workspace.created', false, 'off')`);

    let sent = 0;
    const runtime: NotificationOutboxRuntime = {
      evaluateCurrentEligibility: async (tx, delivery) => {
        const current = await evaluateCurrentNotificationReachAndPreference(
          tx,
          delivery,
        );
        if (current.kind === "quiet_hours_unresolved")
          throw new Error("Quiet-hours contract is unresolved");
        if (current.kind === "destination_unresolved")
          throw new Error("Resource destination contract is unresolved");
        return current;
      },
      send: async () => {
        sent += 1;
      },
    };

    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "suppressed",
      reason: "channel_disabled",
    });
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "suppressed" });
  });

  it("leaves a child pending without provider authorization when quiet hours are configured but unresolved", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "workspace.created",
      resourceType: "workspace",
      resourceId: ids.workspace,
      payload: { workspaceId: ids.workspace, ownerId: ids.user },
    });
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${ids.person}, 'global', NULL, ${channel}, 'workspace.created', true, 'off')`);
    await db.execute(sql`UPDATE person SET quiet_hours_start = '22:00', quiet_hours_end = '07:00',
      quiet_hours_timezone = 'Europe/London' WHERE id = ${ids.person}`);

    let sent = 0;
    const runtime: NotificationOutboxRuntime = {
      evaluateCurrentEligibility: async (tx, delivery) => {
        const current = await evaluateCurrentNotificationReachAndPreference(
          tx,
          delivery,
        );
        if (current.kind === "quiet_hours_unresolved")
          throw new Error("Quiet-hours contract is unresolved");
        if (current.kind === "destination_unresolved")
          throw new Error("Resource destination contract is unresolved");
        return current;
      },
      send: async () => {
        sent += 1;
      },
    };

    await expect(processNextNotificationDelivery(runtime)).rejects.toThrow(
      "Quiet-hours contract is unresolved",
    );
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "pending" });
  });

  it("rejects a mismatched reservation tuple even if its digest key collides", async () => {
    const fixture = await makeEventAndDelivery();
    const hashedKey = notificationReservationKey({
      recipientPersonId: ids.person,
      channel,
      dedupeKey,
    });
    await db.execute(sql`INSERT INTO outbox_dedupe_reservation
      (reservation_key, recipient_person_id, channel, dedupe_key, owner_delivery_id, lease_token, lease_expires_at)
      VALUES (${hashedKey}, ${ids.person}, 'notify.webhook', 'other', ${fixture.deliveryId}, ${randomUUID()},
              clock_timestamp() + interval '1 minute')`);
    const claim = await db.transaction((tx) =>
      acquireNotificationReservation(tx, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        ownerDeliveryId: fixture.deliveryId,
      }),
    );
    expect(claim).toEqual({ status: "digest_collision" });
  });
});
