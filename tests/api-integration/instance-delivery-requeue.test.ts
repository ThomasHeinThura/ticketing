import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { legacySha256ApiKeyHash } from "../../apps/api/src/api-key/secret-hash";
import db, { schema } from "../../apps/api/src/database";
import {
  notificationDeliveryTable,
  notificationDigestTable,
} from "../../apps/api/src/database/schema";
import type { DomainEventEnvelope } from "../../apps/api/src/events/outbox";
import { processNextParentEvent } from "../../apps/api/src/events/outbox-consumer";
import { createApp } from "../../apps/api/src/index";
import { notificationReservationKey } from "../../apps/api/src/notification/delivery-primitives";
import { enqueueNotificationEvent } from "../../apps/api/src/notification/fanout";
import { processNextNotificationDelivery } from "../../apps/api/src/notification/outbox-drain";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const password = "delivery-requeue-integration-fixture-password";

async function makeUser(role: string | null) {
  const id = `delivery-requeue-${randomUUID()}`;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id,
        name: "Synthetic delivery operator",
        email: `${id}@example.test`,
        emailVerified: true,
        role,
      })
      .returning(),
    "delivery requeue user",
  );
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
  });
  return user;
}

async function signIn(app: ReturnType<typeof createApp>["app"], email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(`Fixture sign-in returned ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("Fixture sign-in did not issue a session");
  return cookie;
}

async function createDeadEvent(input: {
  id?: string;
  workspaceId?: string | null;
  organisationId?: string | null;
  state?: "dead" | "delivered";
}) {
  const eventId = input.id ?? `evt_${randomUUID()}`;
  await db.insert(schema.outboxTable).values({
    eventId,
    kind: input.workspaceId ? "work_item.updated" : "identity.provisioned",
    payload: {
      id: eventId,
      kind: input.workspaceId ? "work_item.updated" : "identity.provisioned",
      occurredAt: new Date().toISOString(),
      depth: 0,
      actor: { id: "synthetic-actor", name: "Synthetic actor" },
      scope: input.workspaceId ? { workspaceId: input.workspaceId } : {},
      payload: {},
    },
    workspaceId: input.workspaceId ?? null,
    organisationId: input.organisationId ?? null,
    state: input.state ?? "dead",
    attempts: input.state === "delivered" ? 1 : 6,
    lastError: input.state === "delivered" ? null : "SyntheticConsumerError",
  });
  return eventId;
}

async function createNotificationChild(input: {
  state?: "dead" | "delivered" | "suppressed";
  deliveredAt?: Date | null;
  digestId?: string | null;
  id?: string;
  eventId?: string;
}) {
  const recipient = await createWorkspaceMember();
  const person = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, recipient.user.id))
      .limit(1),
    "delivery recipient person",
  );
  const eventId =
    input.eventId ??
    (await createDeadEvent({
      workspaceId: recipient.workspace.id,
      organisationId: recipient.workspace.organisationId,
      state: "delivered",
    }));
  const deliveryId = input.id ?? `notify_${randomUUID()}`;
  const state = input.state ?? "dead";
  const dedupeKey = `notification-requeue:${randomUUID()}`;
  if (input.digestId) {
    const now = new Date();
    await db.insert(notificationDigestTable).values({
      id: input.digestId,
      recipientPersonId: person.id,
      channel: "notify.email",
      workspaceId: recipient.workspace.id,
      organisationId: recipient.workspace.organisationId,
      cadence: "hourly",
      timezone: "UTC",
      windowStartAt: new Date(now.getTime() - 60 * 60 * 1000),
      windowEndAt: now,
      state: "dead",
      attempts: 6,
    });
  }
  await db.insert(schema.notificationTable).values({
    id: `inbox_${randomUUID()}`,
    userId: recipient.user.id,
    personId: person.id,
    eventId,
    type: "info",
    title: "Synthetic notification",
    body: "Synthetic body withheld from API responses",
  });
  await db.insert(notificationDeliveryTable).values({
    id: deliveryId,
    eventId,
    recipientPersonId: person.id,
    channel: "notify.email",
    workspaceId: recipient.workspace.id,
    organisationId: recipient.workspace.organisationId,
    dedupeKey,
    digestId: input.digestId ?? null,
    state,
    attempts: state === "dead" ? 6 : 1,
    deliveredAt: input.deliveredAt ?? null,
    lastError: state === "dead" ? "attempt_limit" : null,
  });
  return {
    deliveryId,
    eventId,
    personId: person.id,
    workspaceId: recipient.workspace.id,
    organisationId: recipient.workspace.organisationId,
    channel: "notify.email",
    dedupeKey,
  };
}

async function requestRequeue(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  id: string,
) {
  return csrfRequest(
    app,
    `/api/instance/deliveries/${encodeURIComponent(id)}/requeue`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    },
    cookie,
  );
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("instance Delivery requeue HTTP API", () => {
  it("requeues a dead parent event and writes audit atomically", async () => {
    const actor = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, actor.email);
    const eventId = await createDeadEvent({});

    const response = await requestRequeue(app, cookie, eventId);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({
      id: eventId,
      kind: "event",
      state: "pending",
    });

    const event = requireRow(
      await db
        .select({
          state: schema.outboxTable.state,
          attempts: schema.outboxTable.attempts,
          lastError: schema.outboxTable.lastError,
        })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.eventId, eventId))
        .limit(1),
      "requeued event",
    );
    expect(event).toEqual({ state: "pending", attempts: 0, lastError: null });
    const audit = requireRow(
      await db
        .select({
          action: schema.auditLogTable.action,
          before: schema.auditLogTable.before,
          after: schema.auditLogTable.after,
        })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityId, eventId))
        .limit(1),
      "delivery requeue audit",
    );
    expect(audit).toEqual({
      action: "instance.delivery.requeued",
      before: { kind: "event", state: "dead", attempts: 6 },
      after: { kind: "event", state: "pending", attempts: 0 },
    });
  });

  it("reprocesses a native parent without changing its already-delivered notification child", async () => {
    const actor = await makeUser("admin");
    const recipient = await createWorkspaceMember();
    const recipientPerson = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, recipient.user.id))
        .limit(1),
      "native event notification recipient",
    );
    const { app } = createApp();
    const cookie = await signIn(app, actor.email);
    const eventId = `evt_${randomUUID()}`;
    const workItemId = `wi_${randomUUID()}`;
    const event: DomainEventEnvelope<Record<string, unknown>> = {
      id: eventId,
      kind: "work_item.mentioned",
      occurredAt: new Date().toISOString(),
      actor: { type: "system", id: null, name: "TaskDesk" },
      scope: {
        workspaceId: recipient.workspace.id,
        organisationId: recipient.workspace.organisationId,
      },
      payload: {
        key: "REQUEUE-1",
        url: "/agent/work-items/REQUEUE-1",
        workItemId,
        mentionedPersonId: recipientPerson.id,
        commentId: `comment_${randomUUID()}`,
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    };
    await db.transaction((tx) =>
      enqueueNotificationEvent(tx, event, {
        resolveRecipients: async () => [
          {
            personId: recipientPerson.id,
            resourceType: "work_item",
            resourceId: workItemId,
            title: "You were mentioned",
            body: "A synthetic work item mention was recorded.",
            channels: ["notify.email"],
          },
        ],
      }),
    );

    const initialChild = requireRow(
      await db
        .select()
        .from(notificationDeliveryTable)
        .where(eq(notificationDeliveryTable.eventId, eventId))
        .limit(1),
      "materialized notification delivery",
    );
    let providerCalls = 0;
    await expect(
      processNextNotificationDelivery({
        evaluateCurrentEligibility: async () => ({
          kind: "eligible",
          projection: {
            title: "You were mentioned",
            body: "A synthetic work item mention was recorded.",
            url: "/agent/work-items/REQUEUE-1",
          },
        }),
        send: async (_channel, _projection, options) => {
          providerCalls += 1;
          expect(options.idempotencyKey).toBe(initialChild.id);
        },
      }),
    ).resolves.toMatchObject({ kind: "delivered" });
    expect(providerCalls).toBe(1);

    const deliveredChild = requireRow(
      await db
        .select()
        .from(notificationDeliveryTable)
        .where(eq(notificationDeliveryTable.id, initialChild.id))
        .limit(1),
      "delivered notification child",
    );
    expect(deliveredChild).toMatchObject({
      id: initialChild.id,
      eventId,
      state: "delivered",
      attempts: 1,
    });
    expect(deliveredChild.deliveredAt).toBeInstanceOf(Date);

    await db
      .update(schema.outboxTable)
      .set({
        state: "dead",
        attempts: 6,
        nextAttemptAt: new Date(Date.now() - 60_000),
        lastError: "SyntheticConsumerError",
      })
      .where(eq(schema.outboxTable.eventId, eventId));
    const response = await requestRequeue(app, cookie, eventId);
    expect(response.status, await response.clone().text()).toBe(200);

    await expect(processNextParentEvent()).resolves.toEqual({
      kind: "delivered",
      eventId,
    });
    const children = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.eventId, eventId));
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      id: initialChild.id,
      eventId,
      state: "delivered",
      attempts: 1,
      deliveredAt: deliveredChild.deliveredAt,
    });
    const inboxRows = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.eventId, eventId));
    expect(inboxRows).toHaveLength(1);
    expect(providerCalls).toBe(1);
  });

  it("requeues a standalone notification on the same child id and preserves one child", async () => {
    const actor = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, actor.email);
    const delivery = await createNotificationChild({});

    const list = await app.request("/api/instance/deliveries", {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      items: Array<{ id: string; kind: string; requeueAllowed: boolean }>;
    };
    expect(
      listed.items.find((item) => item.id === delivery.deliveryId),
    ).toMatchObject({ kind: "notification", requeueAllowed: true });

    const before = await db
      .select({ id: notificationDeliveryTable.id })
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.eventId, delivery.eventId));
    expect(before).toHaveLength(1);

    const response = await requestRequeue(app, cookie, delivery.deliveryId);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({
      id: delivery.deliveryId,
      kind: "notification",
      state: "pending",
    });

    const updated = requireRow(
      await db
        .select({
          id: notificationDeliveryTable.id,
          state: notificationDeliveryTable.state,
          attempts: notificationDeliveryTable.attempts,
          deliveredAt: notificationDeliveryTable.deliveredAt,
          lastError: notificationDeliveryTable.lastError,
        })
        .from(notificationDeliveryTable)
        .where(eq(notificationDeliveryTable.id, delivery.deliveryId))
        .limit(1),
      "requeued notification child",
    );
    expect(updated).toEqual({
      id: delivery.deliveryId,
      state: "pending",
      attempts: 0,
      deliveredAt: null,
      lastError: null,
    });
    const after = await db
      .select({ id: notificationDeliveryTable.id })
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.eventId, delivery.eventId));
    expect(after).toEqual(before);
  });

  it("refuses delivered, suppressed, digest-linked, ambiguous, and live-reservation targets", async () => {
    const actor = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, actor.email);
    const delivered = await createNotificationChild({
      state: "delivered",
      deliveredAt: new Date(),
    });
    const suppressed = await createNotificationChild({ state: "suppressed" });
    const digestId = `digest_${randomUUID()}`;
    const digestChild = await createNotificationChild({
      digestId,
    });
    const active = await createNotificationChild({});
    const reservationKey = notificationReservationKey({
      recipientPersonId: active.personId,
      channel: active.channel,
      dedupeKey: active.dedupeKey,
    });
    await db.execute(sql`
      INSERT INTO outbox_dedupe_reservation
        (reservation_key, recipient_person_id, channel, dedupe_key,
         owner_delivery_id, lease_token, lease_expires_at)
      VALUES (${reservationKey}, ${active.personId}, ${active.channel},
              ${active.dedupeKey}, ${active.deliveryId}, ${randomUUID()},
              (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes')
    `);

    const sourceForCollision = await createNotificationChild({});
    const collisionId = await createDeadEvent({ id: `amb_${randomUUID()}` });
    await db.execute(sql`
      UPDATE notification_delivery SET id = ${collisionId}
       WHERE id = ${sourceForCollision.deliveryId}
    `);

    for (const id of [
      delivered.deliveryId,
      suppressed.deliveryId,
      digestChild.deliveryId,
      active.deliveryId,
      collisionId,
    ]) {
      const response = await requestRequeue(app, cookie, id);
      expect(response.status, id).toBe(409);
    }

    const unchanged = await db
      .select({
        id: notificationDeliveryTable.id,
        state: notificationDeliveryTable.state,
        attempts: notificationDeliveryTable.attempts,
      })
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, active.deliveryId));
    expect(unchanged).toEqual([
      { id: active.deliveryId, state: "dead", attempts: 6 },
    ]);
  });

  it("rechecks a reservation lease after waiting for its row lock", async () => {
    const actor = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, actor.email);
    const delivery = await createNotificationChild({});
    const reservationKey = notificationReservationKey({
      recipientPersonId: delivery.personId,
      channel: delivery.channel,
      dedupeKey: delivery.dedupeKey,
    });
    await db.execute(sql`
      INSERT INTO outbox_dedupe_reservation
        (reservation_key, recipient_person_id, channel, dedupe_key,
         owner_delivery_id, lease_token, lease_expires_at)
      VALUES (${reservationKey}, ${delivery.personId}, ${delivery.channel},
              ${delivery.dedupeKey}, ${delivery.deliveryId}, ${randomUUID()},
              (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute')
    `);

    let responsePromise: Promise<Response> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT reservation_key FROM outbox_dedupe_reservation
         WHERE reservation_key = ${reservationKey}
         FOR UPDATE
      `);
      responsePromise = requestRequeue(app, cookie, delivery.deliveryId);

      let observedLockWait = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await db.execute(sql`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND wait_event_type = 'Lock'
               AND position('outbox_dedupe_reservation' in query) > 0
          ) AS waiting
        `);
        observedLockWait =
          (waiting.rows as Array<{ waiting: boolean }>)[0]?.waiting === true;
        if (observedLockWait) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!observedLockWait)
        throw new Error("Requeue did not wait on the reservation row lock");

      await tx.execute(sql`
        UPDATE outbox_dedupe_reservation
           SET lease_expires_at = (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes'
         WHERE reservation_key = ${reservationKey}
      `);
    });

    const response = await responsePromise;
    expect(response?.status).toBe(409);
    const current = requireRow(
      await db
        .select({
          state: notificationDeliveryTable.state,
          attempts: notificationDeliveryTable.attempts,
        })
        .from(notificationDeliveryTable)
        .where(eq(notificationDeliveryTable.id, delivery.deliveryId))
        .limit(1),
      "delivery blocked by reservation",
    );
    expect(current).toEqual({ state: "dead", attempts: 6 });
  });

  it("rolls back the queued state change when the requeue audit cannot be written", async () => {
    const actor = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, actor.email);
    const eventId = await createDeadEvent({});
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION codex_requeue_reject_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'instance.delivery.requeued' THEN
          RAISE EXCEPTION 'synthetic audit rejection';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await db.execute(sql`
      CREATE TRIGGER codex_requeue_reject_audit
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION codex_requeue_reject_audit()
    `);

    try {
      const response = await requestRequeue(app, cookie, eventId);
      expect(response.status).toBe(500);
      const current = requireRow(
        await db
          .select({
            state: schema.outboxTable.state,
            attempts: schema.outboxTable.attempts,
          })
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.eventId, eventId))
          .limit(1),
        "event after audit failure",
      );
      expect(current).toEqual({ state: "dead", attempts: 6 });
    } finally {
      await db.execute(sql`
        DROP TRIGGER IF EXISTS codex_requeue_reject_audit ON audit_log
      `);
      await db.execute(sql`
        DROP FUNCTION IF EXISTS codex_requeue_reject_audit()
      `);
    }
  });

  it("refuses a non-admin browser session", async () => {
    const nonAdmin = await makeUser("user");
    const { app } = createApp();
    const nonAdminCookie = await signIn(app, nonAdmin.email);
    const target = `evt_${randomUUID()}`;
    expect((await requestRequeue(app, nonAdminCookie, target)).status).toBe(
      403,
    );
  });

  it("refuses an impersonated administrator session", async () => {
    const admin = await makeUser("admin");
    mockAuthenticatedSession(
      {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        emailVerified: admin.emailVerified,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
        role: admin.role,
      },
      { impersonatedBy: `actor-${randomUUID()}` },
    );
    const { app } = createApp();
    const response = await app.request(
      `/api/instance/deliveries/evt_${randomUUID()}/requeue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(403);
  });

  it("refuses a customer-side session", async () => {
    const customer = await makeUser("admin");
    mockAuthenticatedSession(
      {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        emailVerified: customer.emailVerified,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        role: customer.role,
      },
      { portal: "customer" },
    );
    const { app } = createApp();
    const response = await app.request(
      `/api/instance/deliveries/evt_${randomUUID()}/requeue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(401);
  });

  it("hides the agent-only endpoint on the customer host", async () => {
    const customer = await makeUser("admin");
    mockAuthenticatedSession(
      {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        emailVerified: customer.emailVerified,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        role: customer.role,
      },
      { portal: "customer" },
    );
    const { app } = createApp();
    const response = await app.request(
      `http://portal.localhost:5174/api/instance/deliveries/evt_${randomUUID()}/requeue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(404);
  });

  it("refuses an API key even when its owner is an administrator", async () => {
    const admin = await makeUser("admin");
    const { app } = createApp();
    const target = `evt_${randomUUID()}`;
    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: admin.id,
      userId: admin.id,
      key: legacySha256ApiKeyHash(rawKey),
      name: "delivery requeue key fixture",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ "instance:admin": true }),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const keyResponse = await app.request(
      `/api/instance/deliveries/${target}/requeue`,
      {
        method: "POST",
        headers: { "x-api-key": rawKey, "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(keyResponse.status).toBe(403);
  });
});
