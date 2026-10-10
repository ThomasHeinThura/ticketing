import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  acquireNotificationReservation,
  authorizeNotificationProviderAttempt,
  completeNotificationDelivery,
  deferNotificationDelivery,
  hasRecentNotificationSuccess,
  NotificationReservationContentionError,
  releaseNotificationReservation,
  renewNotificationReservation,
} from "../../apps/api/src/database/repositories/notification-delivery.repository";
import { notificationReservationKey } from "../../apps/api/src/notification/delivery-primitives";
import type { NotificationOutboxRuntime } from "../../apps/api/src/notification/outbox-drain";
import {
  currentEligibilityRuntime,
  processNextNotificationDelivery,
} from "../../apps/api/src/notification/outbox-drain";
import { deleteExpiredNotificationReservations } from "../../apps/api/src/scheduler/session-cleanup";
import { seedDefaultWorkspaceRoles } from "../../apps/api/src/utils/seed-default-workspace-roles";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";

const renewalFault = vi.hoisted(() => ({ fail: false }));
vi.mock(
  "../../apps/api/src/database/repositories/notification-delivery.repository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/database/repositories/notification-delivery.repository")
      >();
    return {
      ...actual,
      renewNotificationReservation: (
        ...args: Parameters<typeof actual.renewNotificationReservation>
      ) => {
        if (renewalFault.fail) throw new Error("injected renewal failure");
        return actual.renewNotificationReservation(...args);
      },
    };
  },
);

const suffix = randomUUID().replaceAll("-", "");
const ids = {
  organisation: `notification-test-org-${suffix}`,
  workspace: `notification-test-workspace-${suffix}`,
  user: `notification-test-user-${suffix}`,
  person: `notification-test-person-${suffix}`,
  project: "",
  item: `notification-test-item-${suffix}`,
  type: `notification-test-type-${suffix}`,
  template: `notification-test-template-${suffix}`,
  state: `notification-test-state-${suffix}`,
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
    workspaceId?: string;
  } = {},
) {
  const deliveryWorkspace = mapping.workspaceId ?? ids.workspace;
  const itemSuffix = randomUUID().replaceAll("-", "");
  const eventId = `notification-test-event-${itemSuffix}`;
  const deliveryId = `notification-test-delivery-${itemSuffix}`;
  const eventKind = mapping.eventKind ?? "work_item.assigned";
  createdEvents.push(eventId);
  await db.execute(sql`
    INSERT INTO outbox (event_id, kind, payload, workspace_id, organisation_id)
    VALUES (${eventId}, ${eventKind}, ${JSON.stringify({
      id: eventId,
      kind: eventKind,
      scope: {
        workspaceId: deliveryWorkspace,
        organisationId: ids.organisation,
      },
      payload: mapping.payload ?? {},
    })}::jsonb,
      ${deliveryWorkspace}, ${ids.organisation})
  `);
  await db.execute(sql`
    INSERT INTO notification_delivery
      (id, event_id, recipient_person_id, channel, workspace_id, organisation_id, dedupe_key)
    VALUES (${deliveryId}, ${eventId}, ${ids.person}, ${channel}, ${deliveryWorkspace}, ${ids.organisation}, ${dedupeKey})
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
    // Integration files share a database, while some fixture setup writes effective
    // memberships directly. Reset this suite's database before the cutover verifier
    // checks that every existing membership has a matching provenance projection.
    await resetTestDatabase();
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
    const project = await createProjectFixture({
      workspaceId: ids.workspace,
      slug: `notification-test-${suffix}`,
    });
    ids.project = project.project.id;
    await db.execute(
      sql`UPDATE project SET organisation_id = ${ids.organisation} WHERE id = ${ids.project}`,
    );
    await grantProjectRole(ids.user, ids.project, ["work_item:read"]);
    await db.insert(schema.workItemTypeTable).values({
      id: ids.type,
      workspaceId: ids.workspace,
      key: `type-${suffix}`,
      name: "Task",
      category: "delivery",
    });
    await db.insert(schema.stateTemplateTable).values({
      id: ids.template,
      workspaceId: ids.workspace,
      key: `state-${suffix}`,
      name: "Backlog",
      group: "backlog",
    });
    await db.insert(schema.stateTable).values({
      id: ids.state,
      projectId: ids.project,
      stateTemplateId: ids.template,
      isDefault: true,
    });
    await db.execute(sql`INSERT INTO work_item (id, project_id, workspace_id, type_id, number, key, title, state_id, customer_visibility)
      VALUES (${ids.item}, ${ids.project}, ${ids.workspace}, ${ids.type}, 1, ${`NOT-${suffix.slice(0, 8)}-1`}, 'Assigned', ${ids.state}, 'organisation')`);
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

  it("re-acquires when cleanup deletes the expired conflict in the insert/lock gap", async () => {
    const fixture = await makeEventAndDelivery();
    const key = notificationReservationKey({
      recipientPersonId: ids.person,
      channel,
      dedupeKey,
    });
    await db.execute(sql`
      INSERT INTO outbox_dedupe_reservation
        (reservation_key, recipient_person_id, channel, dedupe_key,
         owner_delivery_id, lease_token, lease_expires_at)
      VALUES (${key}, ${ids.person}, ${channel}, ${dedupeKey}, ${fixture.deliveryId},
        ${randomUUID()}, clock_timestamp() AT TIME ZONE 'UTC' - interval '1 second')
    `);

    let cleanupInterleaved = false;
    const claim = await db.transaction(async (tx) => {
      const interleavedExecutor = {
        execute: async (query: Parameters<typeof tx.execute>[0]) => {
          const result = await tx.execute(query);
          if (!cleanupInterleaved) {
            cleanupInterleaved = true;
            expect(await deleteExpiredNotificationReservations()).toBe(1);
          }
          return result;
        },
      } as unknown as Parameters<typeof acquireNotificationReservation>[0];
      return acquireNotificationReservation(interleavedExecutor, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        ownerDeliveryId: fixture.deliveryId,
      });
    });

    expect(cleanupInterleaved).toBe(true);
    expect(claim.status).toBe("acquired");
    const reservation = await db.execute<{
      ownerDeliveryId: string;
      leaseExpiresAt: Date | string;
    }>(sql`
      SELECT owner_delivery_id AS "ownerDeliveryId",
             lease_expires_at AT TIME ZONE 'UTC' AS "leaseExpiresAt"
        FROM outbox_dedupe_reservation WHERE reservation_key = ${key}
    `);
    expect(reservation.rows).toHaveLength(1);
    expect(reservation.rows[0]?.ownerDeliveryId).toBe(fixture.deliveryId);
    const leaseExpiryMs = new Date(
      reservation.rows[0]?.leaseExpiresAt ?? 0,
    ).getTime();
    expect(leaseExpiryMs).toBeGreaterThan(Date.now() + 55_000);
  });

  it("fails retryably after repeated cleanup races without claiming a lease or consuming an attempt", async () => {
    const fixture = await makeEventAndDelivery();
    let reservationOperations = 0;
    let firstCall = true;
    await expect(
      db.transaction(async (tx) => {
        const interleavedExecutor = {
          execute: async (query: Parameters<typeof tx.execute>[0]) => {
            const result = await tx.execute(query);
            if (firstCall) {
              firstCall = false;
              return result;
            }
            // Each acquire cycle begins with INSERT followed by SELECT. Remove the
            // just-inserted epoch lease inside this transaction to inject a repeated
            // insert/lock-gap loss deterministically; the separate-connection cleanup race
            // is covered by the preceding integration case. The first call is the delivery
            // row serialization lock added before reservation acquisition.
            if (reservationOperations % 2 === 0) {
              const removed = await tx.execute(sql`
                DELETE FROM outbox_dedupe_reservation
                 WHERE reservation_key = ${notificationReservationKey({
                   recipientPersonId: ids.person,
                   channel,
                   dedupeKey,
                 })}
                   AND lease_expires_at <= clock_timestamp() AT TIME ZONE 'UTC'
              `);
              expect(removed.rowCount).toBe(1);
            }
            reservationOperations += 1;
            return result;
          },
        } as unknown as Parameters<typeof acquireNotificationReservation>[0];
        return acquireNotificationReservation(interleavedExecutor, {
          recipientPersonId: ids.person,
          channel,
          dedupeKey,
          ownerDeliveryId: fixture.deliveryId,
        });
      }),
    ).rejects.toBeInstanceOf(NotificationReservationContentionError);
    expect(reservationOperations).toBe(12);
    const row = await db.execute<{ attempts: number }>(sql`
      SELECT attempts FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]?.attempts).toBe(0);
    const reservations = await db.execute(sql`
      SELECT reservation_key FROM outbox_dedupe_reservation WHERE reservation_key =
        ${notificationReservationKey({ recipientPersonId: ids.person, channel, dedupeKey })}
    `);
    expect(reservations.rows).toHaveLength(0);
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

  it("NO-3/NO-9 rechecks a staff work-item destination with no configured quiet hours before send", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "work_item.assigned",
      resourceType: "work_item",
      resourceId: ids.item,
      payload: { workItemId: ids.item },
    });
    let sent = 0;
    const runtime = currentEligibilityRuntime(async (_channel, projection) => {
      expect(projection.url).toContain("/agent/work-items/");
      sent += 1;
    });
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "delivered",
    });
    expect(sent).toBe(1);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 1, state: "delivered" });
  });

  it.each([
    {
      name: "suppression",
      outcome: { kind: "suppress" as const, reason: "reach_lost" },
    },
    {
      name: "deferral",
      outcome: {
        kind: "defer" as const,
        until: new Date(Date.now() + 60_000),
        reason: "quiet_hours",
      },
    },
  ])(
    "does not apply a second worker's $name while this child owns an in-flight provider fence",
    async ({ outcome }) => {
      const fixture = await makeEventAndDelivery(true, {
        payload: { workItemId: ids.item },
      });
      let checks = 0;
      let enterProvider!: () => void;
      let finishProvider!: () => void;
      const providerEntered = new Promise<void>((resolve) => {
        enterProvider = resolve;
      });
      const providerGate = new Promise<void>((resolve) => {
        finishProvider = resolve;
      });
      const runtime: NotificationOutboxRuntime = {
        evaluateCurrentEligibility: async () => {
          checks += 1;
          return checks <= 2
            ? {
                kind: "eligible",
                projection: {
                  title: "Assigned",
                  body: "Safe",
                  url: "/agent/work-items/item-1",
                },
              }
            : outcome;
        },
        send: async () => {
          enterProvider();
          await providerGate;
        },
      };

      const firstWorker = processNextNotificationDelivery(runtime);
      await providerEntered;
      await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
        kind: "deferred",
        reason: "delivery_fence",
      });
      const duringProvider = await db.execute<{
        attempts: number;
        state: string;
        deliveredAt: Date | null;
      }>(sql`
      SELECT attempts, state, delivered_at AS "deliveredAt"
        FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
      expect(duringProvider.rows[0]).toEqual({
        attempts: 1,
        state: "pending",
        deliveredAt: null,
      });

      finishProvider();
      await expect(firstWorker).resolves.toEqual({ kind: "delivered" });
      const completed = await db.execute<{
        attempts: number;
        state: string;
        deliveredAt: Date | null;
      }>(sql`
      SELECT attempts, state, delivered_at AS "deliveredAt"
        FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
      expect(completed.rows[0]?.attempts).toBe(1);
      expect(completed.rows[0]?.state).toBe("delivered");
      expect(completed.rows[0]?.deliveredAt).not.toBeNull();
    },
  );

  it("fails closed when the event envelope workspace does not match its delivery", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "work_item.assigned",
      resourceType: "work_item",
      resourceId: ids.item,
      payload: { workItemId: ids.item },
    });
    await db.execute(sql`
      UPDATE outbox SET payload = jsonb_set(payload, '{scope,workspaceId}', '"foreign-workspace"')
       WHERE event_id = ${fixture.eventId}
    `);
    let sent = 0;
    await expect(
      processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {
          sent += 1;
        }),
      ),
    ).resolves.toEqual({
      kind: "suppressed",
      reason: "resource_mapping_mismatch",
    });
    expect(sent).toBe(0);
  });

  it("fails closed when the event organisation is absent for an organisation-bound delivery", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "work_item.assigned",
      resourceType: "work_item",
      resourceId: ids.item,
      payload: { workItemId: ids.item },
    });
    await db.execute(sql`
      UPDATE outbox SET payload = payload #- '{scope,organisationId}'
       WHERE event_id = ${fixture.eventId}
    `);
    let sent = 0;
    await expect(
      processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {
          sent += 1;
        }),
      ),
    ).resolves.toEqual({
      kind: "suppressed",
      reason: "resource_mapping_mismatch",
    });
    expect(sent).toBe(0);
  });

  it("fails closed when supplied work-item id and key resolve to different rows", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "work_item.assigned",
      resourceType: "work_item",
      resourceId: ids.item,
      payload: { workItemId: ids.item, key: "OTHER-ITEM" },
    });
    let sent = 0;
    await expect(
      processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {
          sent += 1;
        }),
      ),
    ).resolves.toEqual({ kind: "suppressed", reason: "resource_unavailable" });
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "suppressed" });
  });

  it("accepts a work-item notification mapped by the canonical work-item key", async () => {
    const key = `NOT-${suffix.slice(0, 8)}-1`;
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "work_item.unblocked",
      resourceType: "work_item",
      resourceId: key,
      payload: { key, formerBlockerId: "blocker-1" },
    });
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${ids.person}, 'global', NULL, ${channel}, 'work_item.unblocked', true, 'off')`);
    let sent = 0;
    await expect(
      processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {
          sent += 1;
        }),
      ),
    ).resolves.toEqual({ kind: "delivered" });
    expect(sent).toBe(1);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 1, state: "delivered" });
  });

  it("fails closed for an unregistered resource mapping", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "work_item.assigned",
      resourceType: "unregistered_resource",
      resourceId: ids.item,
      payload: { workItemId: ids.item },
    });
    let sent = 0;
    await expect(
      processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {
          sent += 1;
        }),
      ),
    ).resolves.toEqual({
      kind: "suppressed",
      reason: "resource_mapping_mismatch",
    });
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "suppressed" });
  });

  it.each([
    ["work_item.assigned", { workItemId: "another-item" }],
    ["work_item.unblocked", { key: "OTHER-1", formerBlockerId: "blocker-1" }],
    ["work_item.mentioned", { commentId: "comment-1" }],
  ])(
    "fails closed for mismatched work-item mapping on %s",
    async (eventKind, payload) => {
      const fixture = await makeEventAndDelivery(true, {
        eventKind,
        resourceType: "work_item",
        resourceId: ids.item,
        payload,
      });
      let sent = 0;
      await expect(
        processNextNotificationDelivery(
          currentEligibilityRuntime(async () => {
            sent += 1;
          }),
        ),
      ).resolves.toEqual({
        kind: "suppressed",
        reason: "resource_mapping_mismatch",
      });
      expect(sent).toBe(0);
      const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
      expect(row.rows[0]).toEqual({ attempts: 0, state: "suppressed" });
    },
  );

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
    const runtime = currentEligibilityRuntime(async () => {
      sent += 1;
    });

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
    const runtime = currentEligibilityRuntime(async () => {
      sent += 1;
    });

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

  it("keeps an eligible but unmapped destination pending with no provider attempt", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "workspace.created",
      resourceType: "workspace",
      resourceId: ids.workspace,
      payload: { workspaceId: ids.workspace, ownerId: ids.user },
    });
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${ids.person}, 'global', NULL, ${channel}, 'workspace.created', true, 'off')`);
    let sent = 0;
    await expect(
      processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {
          sent += 1;
        }),
      ),
    ).resolves.toEqual({
      kind: "unresolved",
      reason: "destination_unresolved",
    });
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "pending" });
  });

  it("NO-3 leaves a child pending without provider authorization when quiet hours are configured but unresolved", async () => {
    const fixture = await makeEventAndDelivery(true, {
      eventKind: "work_item.assigned",
      resourceType: "work_item",
      resourceId: ids.item,
      payload: { workItemId: ids.item },
    });
    await db.execute(sql`UPDATE person SET quiet_hours_start = '22:00', quiet_hours_end = '07:00',
      quiet_hours_timezone = 'Europe/London' WHERE id = ${ids.person}`);

    let sent = 0;
    const runtime = currentEligibilityRuntime(async () => {
      sent += 1;
    });

    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "unresolved",
      reason: "quiet_hours_unresolved",
    });
    expect(sent).toBe(0);
    const row = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(row.rows[0]).toEqual({ attempts: 0, state: "pending" });
  });

  it("releases its fenced reservation when eligibility becomes unresolved during preflight", async () => {
    const fixture = await makeEventAndDelivery(true);
    let checks = 0;
    let sent = 0;
    const runtime: NotificationOutboxRuntime = {
      evaluateCurrentEligibility: async () => {
        checks += 1;
        return checks === 1
          ? {
              kind: "eligible",
              projection: {
                title: "Assigned",
                body: "Safe",
                url: "/agent/work-items/item-1",
              },
            }
          : { kind: "unresolved", reason: "quiet_hours_unresolved" };
      },
      send: async () => {
        sent += 1;
      },
    };
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "unresolved",
      reason: "quiet_hours_unresolved",
    });
    expect(checks).toBe(2);
    expect(sent).toBe(0);
    const delivery = await db.execute<{ attempts: number; state: string }>(sql`
      SELECT attempts, state FROM notification_delivery WHERE id = ${fixture.deliveryId}
    `);
    expect(delivery.rows[0]).toEqual({ attempts: 0, state: "pending" });
    const reservations = await db.execute(sql`
      SELECT reservation_key FROM outbox_dedupe_reservation WHERE owner_delivery_id = ${fixture.deliveryId}
    `);
    expect(reservations.rows).toHaveLength(0);
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

  const eligibleRuntime = (onSend: () => void): NotificationOutboxRuntime => ({
    evaluateCurrentEligibility: async () => ({
      kind: "eligible",
      projection: { title: "t", body: "b", url: "/agent/work-items/x" },
    }),
    send: async () => {
      onSend();
    },
  });

  async function deliveryRow(id: string) {
    const row = await db.execute<{
      attempts: number;
      state: string;
      last_error: string | null;
      future: boolean;
    }>(sql`
      SELECT attempts, state, last_error,
             next_attempt_at > clock_timestamp() AT TIME ZONE 'UTC' AS future
        FROM notification_delivery WHERE id = ${id}
    `);
    return row.rows[0];
  }

  async function withRevokedMemberships<T>(
    scope: "project" | "workspace",
    scopeId: string,
    body: () => Promise<T>,
  ): Promise<T> {
    const saved = await db.execute(sql`
      SELECT * FROM membership
       WHERE person_id = ${ids.person} AND scope = ${scope} AND scope_id = ${scopeId}
    `);
    await db.execute(sql`
      DELETE FROM membership
       WHERE person_id = ${ids.person} AND scope = ${scope} AND scope_id = ${scopeId}
    `);
    try {
      return await body();
    } finally {
      for (const row of saved.rows) {
        const keys = Object.keys(row);
        await db.execute(
          sql`INSERT INTO membership (${sql.raw(keys.map((k) => `"${k}"`).join(", "))})
              VALUES (${sql.join(
                keys.map((k) => sql`${(row as Record<string, unknown>)[k]}`),
                sql`, `,
              )})`,
        );
      }
    }
  }

  const workItemMapping = () => ({
    eventKind: "work_item.assigned",
    resourceType: "work_item",
    resourceId: ids.item,
    payload: { workItemId: ids.item },
  });

  it("F1 suppresses a recipient whose project role no longer grants work_item:read", async () => {
    const control = await makeEventAndDelivery(true, workItemMapping());
    let sent = 0;
    const runtime = currentEligibilityRuntime(async () => {
      sent += 1;
    });
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "delivered",
    });
    expect(sent).toBe(1);
    expect((await deliveryRow(control.deliveryId))?.state).toBe("delivered");
    await db.execute(sql`DELETE FROM outbox_dedupe_reservation`);

    const roleIds = await db.execute<{ id: string; caps: unknown }>(sql`
      SELECT r.id, r.capabilities AS caps FROM role r
        JOIN membership m ON m.role_id = r.id
       WHERE m.person_id = ${ids.person} AND m.scope = 'project' AND m.scope_id = ${ids.project}
    `);
    const role = roleIds.rows[0];
    if (!role) throw new Error("project role fixture missing");
    await db.execute(
      sql`UPDATE role SET capabilities = '[]'::jsonb WHERE id = ${role.id}`,
    );
    try {
      const fixture = await makeEventAndDelivery(true, workItemMapping());
      await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
        kind: "suppressed",
        reason: "read_authority_lost",
      });
      expect(sent).toBe(1);
      expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
        attempts: 0,
        state: "suppressed",
      });
    } finally {
      await db.execute(
        sql`UPDATE role SET capabilities = ${JSON.stringify(role.caps)}::jsonb WHERE id = ${role.id}`,
      );
    }
  });

  it("F6 suppresses after project reach is revoked, then drains again once restored", async () => {
    await withRevokedMemberships("project", ids.project, async () => {
      const fixture = await makeEventAndDelivery(true, workItemMapping());
      let sent = 0;
      const result = await processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {
          sent += 1;
        }),
      );
      expect(result).toMatchObject({ kind: "suppressed" });
      expect(sent).toBe(0);
      expect((await deliveryRow(fixture.deliveryId))?.state).toBe("suppressed");
    });
  });

  it("F6 suppresses a workspace notification after workspace authority is removed", async () => {
    const mapping = {
      eventKind: "workspace.created",
      resourceType: "workspace",
      resourceId: ids.workspace,
      payload: { workspaceId: ids.workspace, ownerId: ids.user },
    };
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${ids.person}, 'global', NULL, ${channel}, 'workspace.created', true, 'off')`);
    const withAuthority = await makeEventAndDelivery(true, mapping);
    await expect(
      processNextNotificationDelivery(
        currentEligibilityRuntime(async () => {}),
      ),
    ).resolves.toEqual({
      kind: "unresolved",
      reason: "destination_unresolved",
    });
    expect((await deliveryRow(withAuthority.deliveryId))?.state).toBe(
      "pending",
    );
    await db.execute(sql`DELETE FROM notification_delivery`);

    // Workspace authority comes from the legacy workspace_member row.
    await db.execute(
      sql`DELETE FROM workspace_member WHERE workspace_id = ${ids.workspace} AND user_id = ${ids.user}`,
    );
    try {
      const fixture = await makeEventAndDelivery(true, mapping);
      await expect(
        processNextNotificationDelivery(
          currentEligibilityRuntime(async () => {}),
        ),
      ).resolves.toEqual({ kind: "suppressed", reason: "reach_lost" });
      expect((await deliveryRow(fixture.deliveryId))?.state).toBe("suppressed");
    } finally {
      await db.execute(sql`INSERT INTO workspace_member (id, workspace_id, user_id, role, joined_at)
        VALUES (${`notification-test-member-${suffix}`}, ${ids.workspace}, ${ids.user}, 'admin', clock_timestamp())`);
    }
  });

  it("F6 suppresses when the resource's workspace differs from the delivery's workspace", async () => {
    const otherWorkspace = `notification-test-other-ws-${suffix}`;
    await db.execute(sql`INSERT INTO workspace (id, organisation_id, name, slug, created_at)
      VALUES (${otherWorkspace}, ${ids.organisation}, 'Other', ${`other-${suffix}`}, clock_timestamp())`);
    try {
      const fixture = await makeEventAndDelivery(true, {
        ...workItemMapping(),
        workspaceId: otherWorkspace,
      });
      await expect(
        processNextNotificationDelivery(
          currentEligibilityRuntime(async () => {}),
        ),
      ).resolves.toEqual({
        kind: "suppressed",
        reason: "resource_scope_changed",
      });
      expect((await deliveryRow(fixture.deliveryId))?.state).toBe("suppressed");
    } finally {
      await db.execute(
        sql`DELETE FROM outbox WHERE workspace_id = ${otherWorkspace}`,
      );
      await db.execute(sql`DELETE FROM workspace WHERE id = ${otherWorkspace}`);
    }
  });

  it("F2 backs off an unresolved head so an eligible sibling is still delivered", async () => {
    const head = await makeEventAndDelivery(true, {
      eventKind: "workspace.created",
      resourceType: "workspace",
      resourceId: ids.workspace,
      payload: { workspaceId: ids.workspace, ownerId: ids.user },
    });
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${ids.person}, 'global', NULL, ${channel}, 'workspace.created', true, 'off')`);
    const sibling = await makeEventAndDelivery(true, workItemMapping());
    let sent = 0;
    const runtime = currentEligibilityRuntime(async () => {
      sent += 1;
    });
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "unresolved",
      reason: "destination_unresolved",
    });
    expect(await deliveryRow(head.deliveryId)).toMatchObject({
      attempts: 0,
      state: "pending",
      last_error: "destination_unresolved",
      future: true,
    });
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "delivered",
    });
    expect(sent).toBe(1);
    expect((await deliveryRow(sibling.deliveryId))?.state).toBe("delivered");
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "idle",
    });
  });

  it("F2 backs off a row whose evaluator throws so a sibling is still delivered", async () => {
    const poison = await makeEventAndDelivery(true);
    const sibling = await makeEventAndDelivery(true);
    let sent = 0;
    const runtime: NotificationOutboxRuntime = {
      evaluateCurrentEligibility: async (_tx, delivery) => {
        if (delivery.id === poison.deliveryId) throw new Error("poison row");
        return {
          kind: "eligible",
          projection: { title: "t", body: "b", url: "/agent/work-items/x" },
        };
      },
      send: async () => {
        sent += 1;
      },
    };
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "deferred",
      reason: "evaluator_error",
    });
    expect(await deliveryRow(poison.deliveryId)).toMatchObject({
      attempts: 0,
      state: "pending",
      future: true,
    });
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "delivered",
    });
    expect(sent).toBe(1);
    expect((await deliveryRow(sibling.deliveryId))?.state).toBe("delivered");
  });

  describe("F3 fencing token and lease expiry are refused by every writer", () => {
    async function acquired() {
      const fixture = await makeEventAndDelivery();
      const claim = await db.transaction((tx) =>
        acquireNotificationReservation(tx, {
          recipientPersonId: ids.person,
          channel,
          dedupeKey,
          ownerDeliveryId: fixture.deliveryId,
        }),
      );
      if (claim.status !== "acquired") throw new Error("not acquired");
      return { fixture, reservation: claim.reservation };
    }

    async function expireLease(reservation: { key: Buffer }) {
      await db.execute(sql`UPDATE outbox_dedupe_reservation
        SET lease_expires_at = clock_timestamp() AT TIME ZONE 'UTC' - interval '1 second'
        WHERE reservation_key = ${reservation.key}`);
    }

    it("accepts the live owner token (positive control)", async () => {
      const { fixture, reservation } = await acquired();
      const renewed = await db.transaction((tx) =>
        renewNotificationReservation(tx, reservation),
      );
      expect(renewed).not.toBeNull();
      const attempt = await db.transaction((tx) =>
        authorizeNotificationProviderAttempt(
          tx,
          fixture.deliveryId,
          reservation,
        ),
      );
      expect(attempt).toBe(1);
      await expect(
        db.transaction((tx) =>
          completeNotificationDelivery(tx, fixture.deliveryId, reservation, {
            kind: "delivered",
          }),
        ),
      ).resolves.toBe(true);
    });

    it.each([
      { name: "a foreign lease token", expire: false },
      { name: "an expired lease", expire: true },
    ])(
      "authorize, renew, complete, defer and release all refuse $name",
      async ({ expire }) => {
        const { fixture, reservation } = await acquired();
        const presented = expire
          ? reservation
          : { ...reservation, leaseToken: randomUUID() };
        if (expire) await expireLease(reservation);

        await expect(
          db.transaction((tx) => renewNotificationReservation(tx, presented)),
        ).resolves.toBeNull();
        await expect(
          db.transaction((tx) =>
            authorizeNotificationProviderAttempt(
              tx,
              fixture.deliveryId,
              presented,
            ),
          ),
        ).resolves.toBeNull();
        await expect(
          db.transaction((tx) =>
            completeNotificationDelivery(tx, fixture.deliveryId, presented, {
              kind: "delivered",
            }),
          ),
        ).resolves.toBe(false);
        await expect(
          db.transaction((tx) =>
            deferNotificationDelivery(
              tx,
              fixture.deliveryId,
              new Date(Date.now() + 3_600_000),
              "stale_defer",
              presented,
            ),
          ),
        ).resolves.toBe(false);
        await expect(
          db.transaction((tx) =>
            releaseNotificationReservation(tx, fixture.deliveryId, presented),
          ),
        ).resolves.toBe(false);
        expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
          attempts: 0,
          state: "pending",
          last_error: null,
          future: false,
        });
        const kept = await db.execute(sql`
        SELECT 1 FROM outbox_dedupe_reservation WHERE reservation_key = ${reservation.key}
      `);
        expect(kept.rows).toHaveLength(1);
      },
    );
  });

  it("B-F1 a stale holder of the same delivery cannot authorize, renew, complete, defer or release", async () => {
    const fixture = await makeEventAndDelivery();
    const other = await makeEventAndDelivery();
    const first = await db.transaction((tx) =>
      acquireNotificationReservation(tx, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        ownerDeliveryId: fixture.deliveryId,
      }),
    );
    if (first.status !== "acquired") throw new Error("not acquired");
    const stale = first.reservation;
    await db.execute(sql`UPDATE outbox_dedupe_reservation
      SET lease_expires_at = clock_timestamp() AT TIME ZONE 'UTC' - interval '1 second'
      WHERE reservation_key = ${stale.key}`);
    const second = await db.transaction((tx) =>
      acquireNotificationReservation(tx, {
        recipientPersonId: ids.person,
        channel,
        dedupeKey,
        ownerDeliveryId: fixture.deliveryId,
      }),
    );
    if (second.status !== "acquired") throw new Error("not re-acquired");
    const current = second.reservation;
    expect(current.leaseToken).not.toBe(stale.leaseToken);

    const snapshot = async () =>
      (
        await db.execute(sql`
          SELECT owner_delivery_id, lease_token, lease_expires_at
            FROM outbox_dedupe_reservation WHERE reservation_key = ${stale.key}
        `)
      ).rows;
    const before = await snapshot();

    await expect(
      db.transaction((tx) =>
        authorizeNotificationProviderAttempt(tx, fixture.deliveryId, stale),
      ),
    ).resolves.toBeNull();
    await expect(
      db.transaction((tx) => renewNotificationReservation(tx, stale)),
    ).resolves.toBeNull();
    await expect(
      db.transaction((tx) =>
        completeNotificationDelivery(tx, fixture.deliveryId, stale, {
          kind: "delivered",
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      db.transaction((tx) =>
        deferNotificationDelivery(
          tx,
          fixture.deliveryId,
          new Date(Date.now() + 60_000),
          "stale",
          stale,
        ),
      ),
    ).resolves.toBe(false);
    await expect(
      db.transaction((tx) =>
        releaseNotificationReservation(tx, fixture.deliveryId, stale),
      ),
    ).resolves.toBe(false);
    // The owner comparison: the current holder's valid token, presented for a different
    // delivery, is also refused.
    await expect(
      db.transaction((tx) =>
        authorizeNotificationProviderAttempt(tx, other.deliveryId, current),
      ),
    ).resolves.toBeNull();

    expect(await snapshot()).toEqual(before);
    expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
      attempts: 0,
      state: "pending",
    });
    expect(await deliveryRow(other.deliveryId)).toMatchObject({
      attempts: 0,
      state: "pending",
    });
    // Positive control: the current holder still proceeds.
    await expect(
      db.transaction((tx) =>
        authorizeNotificationProviderAttempt(tx, fixture.deliveryId, current),
      ),
    ).resolves.toBe(1);
  });

  it("B-F3 suppresses a deactivated recipient with the recipient_inactive reason", async () => {
    const fixture = await makeEventAndDelivery(true, workItemMapping());
    await db.execute(
      sql`UPDATE person SET active = false WHERE id = ${ids.person}`,
    );
    try {
      let sent = 0;
      await expect(
        processNextNotificationDelivery(
          currentEligibilityRuntime(async () => {
            sent += 1;
          }),
        ),
      ).resolves.toEqual({ kind: "suppressed", reason: "recipient_inactive" });
      expect(sent).toBe(0);
      expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
        attempts: 0,
        state: "suppressed",
      });
    } finally {
      await db.execute(
        sql`UPDATE person SET active = true WHERE id = ${ids.person}`,
      );
    }
  });

  describe("B-F6 drain-level provider outcomes", () => {
    it("a provider failure schedules a retry with backoff and consumes one attempt", async () => {
      const fixture = await makeEventAndDelivery(true);
      const runtime: NotificationOutboxRuntime = {
        ...eligibleRuntime(() => {}),
        send: async () => {
          throw new Error("provider down");
        },
      };
      await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
        kind: "retry",
        ambiguous: false,
      });
      expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
        attempts: 1,
        state: "pending",
        last_error: "provider_failed",
        future: true,
      });
    });

    it("a provider deadline is ambiguous and keeps the reservation until lease expiry", async () => {
      const fixture = await makeEventAndDelivery(true);
      const runtime: NotificationOutboxRuntime = {
        ...eligibleRuntime(() => {}),
        send: () => new Promise<void>(() => {}),
      };
      await expect(
        processNextNotificationDelivery(runtime, { providerDeadlineMs: 50 }),
      ).resolves.toEqual({ kind: "retry", ambiguous: true });
      expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
        attempts: 1,
        state: "pending",
      });
      const held = await db.execute(sql`
        SELECT 1 FROM outbox_dedupe_reservation WHERE owner_delivery_id = ${fixture.deliveryId}
      `);
      expect(held.rows).toHaveLength(1);
    });

    it("losing the lease mid-send reports an ambiguous retry and never records delivered", async () => {
      const fixture = await makeEventAndDelivery(true);
      let sent = 0;
      const runtime: NotificationOutboxRuntime = {
        ...eligibleRuntime(() => {}),
        send: async () => {
          sent += 1;
          await db.execute(sql`UPDATE outbox_dedupe_reservation
            SET lease_token = ${randomUUID()}
            WHERE owner_delivery_id = ${fixture.deliveryId}`);
        },
      };
      await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
        kind: "retry",
        ambiguous: true,
      });
      expect(sent).toBe(1);
      expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
        attempts: 1,
        state: "pending",
      });
    });

    it("suppresses a second delivery with the same key as a recent duplicate", async () => {
      const first = await makeEventAndDelivery(true);
      let sent = 0;
      const runtime = eligibleRuntime(() => {
        sent += 1;
      });
      await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
        kind: "delivered",
      });
      const second = await makeEventAndDelivery(true);
      await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
        kind: "suppressed",
        reason: "recent_duplicate",
      });
      expect(sent).toBe(1);
      expect((await deliveryRow(first.deliveryId))?.state).toBe("delivered");
      expect(await deliveryRow(second.deliveryId)).toMatchObject({
        attempts: 0,
        state: "suppressed",
      });
    });

    it("B-F2 a renewal failure stops the send fail-closed without an unhandled rejection", async () => {
      const fixture = await makeEventAndDelivery(true);
      let aborted = false;
      const runtime: NotificationOutboxRuntime = {
        ...eligibleRuntime(() => {}),
        send: (_channel, _projection, options) =>
          new Promise<void>((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              aborted = true;
              reject(options.signal.reason);
            });
          }),
      };
      renewalFault.fail = true;
      try {
        await expect(
          processNextNotificationDelivery(runtime, {
            renewalIntervalMs: 20,
            providerDeadlineMs: 5_000,
          }),
        ).resolves.toEqual({ kind: "retry", ambiguous: true });
      } finally {
        renewalFault.fail = false;
      }
      expect(aborted).toBe(true);
      expect(await deliveryRow(fixture.deliveryId)).toMatchObject({
        attempts: 1,
        state: "pending",
      });
    });
  });

  it("F4 fan-out writes no inbox row for an approval resource and does for a work item", async () => {
    const { materializeNotificationFanout } = await import(
      "../../apps/api/src/notification/fanout"
    );
    const eventId = `notification-test-fanout-${randomUUID()}`;
    createdEvents.push(eventId);
    await db.execute(sql`
      INSERT INTO outbox (event_id, kind, payload, workspace_id, organisation_id)
      VALUES (${eventId}, 'work_item.assigned', '{}'::jsonb, ${ids.workspace}, ${ids.organisation})
    `);
    const event = {
      id: eventId,
      kind: "work_item.assigned",
      occurredAt: new Date().toISOString(),
      actor: { type: "system" as const, id: null, name: "system" },
      scope: {
        workspaceId: ids.workspace,
        organisationId: ids.organisation,
      },
      payload: {},
      causationId: null,
      depth: 0,
      originAutomationId: null,
    };
    const candidate = (resourceType: string) => ({
      personId: ids.person,
      resourceType,
      resourceId: `res-${resourceType}`,
      title: "t",
      body: "b",
      channels: [] as string[],
    });
    await db.transaction((tx) =>
      materializeNotificationFanout(tx, event, {
        resolveRecipients: async () => [candidate("approval")],
      }),
    );
    const none = await db.execute(
      sql`SELECT 1 FROM notification WHERE event_id = ${eventId}`,
    );
    expect(none.rows).toHaveLength(0);
    await db.transaction((tx) =>
      materializeNotificationFanout(tx, event, {
        resolveRecipients: async () => [candidate("work_item")],
      }),
    );
    const some = await db.execute(
      sql`SELECT resource_type FROM notification WHERE event_id = ${eventId}`,
    );
    expect(some.rows).toEqual([{ resource_type: "work_item" }]);
  });
});
