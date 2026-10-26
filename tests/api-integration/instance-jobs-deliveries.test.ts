import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacySha256ApiKeyHash } from "../../apps/api/src/api-key/secret-hash";
import db, { schema } from "../../apps/api/src/database";
import {
  webhookDeliveryTable,
  webhookTable,
} from "../../apps/api/src/database/schema";
import {
  instanceJobConfigurationTable,
  instanceJobRunTable,
} from "../../apps/api/src/database/schema-instance-jobs";
import { createApp } from "../../apps/api/src/index";
import {
  dispatchOneManualRun,
  pruneJobRunHistory,
  readLastJobRuns,
  readQueuedJobRuns,
  stopJobRunWorker,
} from "../../apps/api/src/instance/jobs/runtime";
import {
  initializeScheduler,
  registeredJobCatalog,
  registeredJobs,
  shutdownScheduler,
} from "../../apps/api/src/scheduler";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const password = "jobs-integration-fixture-password";

async function makeUser(role: string | null) {
  const id = `jobs-api-${randomUUID()}`;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: "Synthetic jobs API actor",
      email: `${id}@example.test`,
      emailVerified: true,
      role,
    })
    .returning();
  if (!user) throw new Error("Jobs API user fixture was not created");
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
  if (!cookie)
    throw new Error("Fixture sign-in did not issue an agent session");
  return cookie;
}

async function readyScheduler() {
  initializeScheduler();
  const expiresAt = Date.now() + 5_000;
  while (Date.now() < expiresAt) {
    if (
      registeredJobCatalog().some(
        (job) => job.name === "outbox-drain" && job.enabled,
      )
    ) {
      stopJobRunWorker();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Scheduler configuration did not become ready");
}

beforeEach(async () => {
  shutdownScheduler();
  await resetTestDatabase();
});
afterEach(() => {
  shutdownScheduler();
});

describe("instance Jobs HTTP API", () => {
  it("serves the static real job catalogue in a web process without starting Cron or workers", async () => {
    const user = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, user.email);

    expect(registeredJobs()).toHaveLength(0);
    const staticCatalog = registeredJobCatalog();
    expect(staticCatalog.map((job) => job.name)).toContain("outbox-drain");
    expect(staticCatalog.map((job) => job.name)).toContain("secrets-rekey");
    expect(registeredJobs()).toHaveLength(0);

    const response = await app.request("/api/instance/jobs", {
      headers: { cookie },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      jobs: Array<{
        name: string;
        pattern: string | null;
        timezone: string | null;
        enabled: boolean;
        nextRunAt: string | null;
      }>;
    };
    expect(body.jobs).toContainEqual(
      expect.objectContaining({
        name: "outbox-drain",
        pattern: "*/30 * * * * *",
        enabled: true,
      }),
    );
    expect(
      body.jobs.find((job) => job.name === "outbox-drain")?.nextRunAt,
    ).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(registeredJobs()).toHaveLength(0);
  });

  it("lists registered jobs, applies versioned configuration, queues a real run, and records audit history", async () => {
    const user = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    await readyScheduler();

    const listed = await app.request("/api/instance/jobs", {
      headers: { cookie },
    });
    expect(listed.status, await listed.clone().text()).toBe(200);
    const list = (await listed.json()) as {
      jobs: Array<{ name: string; version: number; enabled: boolean }>;
    };
    expect(list.jobs.map((job) => job.name)).toContain("session-cleanup");
    expect(list.jobs.map((job) => job.name)).toContain("secrets-rekey");
    const scheduleJob = list.jobs.find(
      (job) => job.name === "notification-digest",
    );
    expect(scheduleJob).toMatchObject({ version: 0, enabled: true });

    const update = await csrfRequest(
      app,
      "/api/instance/jobs/notification-digest",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          expectedVersion: 0,
          pattern: "*/7 * * * *",
          enabled: false,
        }),
      },
      cookie,
    );
    expect(update.status, await update.clone().text()).toBe(200);
    expect(await update.json()).toMatchObject({
      job: {
        name: "notification-digest",
        pattern: "*/7 * * * *",
        enabled: false,
        version: 1,
      },
    });

    const stale = await csrfRequest(
      app,
      "/api/instance/jobs/notification-digest",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ expectedVersion: 0, enabled: true }),
      },
      cookie,
    );
    expect(stale.status).toBe(409);

    const queue = await csrfRequest(
      app,
      "/api/instance/jobs/session-cleanup/run",
      { method: "POST", headers: { cookie } },
      cookie,
    );
    expect(queue.status, await queue.clone().text()).toBe(202);
    const queued = (await queue.json()) as {
      run: { id: string; state: string };
    };
    expect(queued.run.state).toBe("queued");
    const jobsAfterQueue = await app.request("/api/instance/jobs", {
      headers: { cookie },
    });
    const queuedJob = (
      (await jobsAfterQueue.json()) as {
        jobs: Array<{
          name: string;
          lastRun: { id: string } | null;
          queuedRun: { id: string; state: string } | null;
        }>;
      }
    ).jobs.find((job) => job.name === "session-cleanup");
    expect(queuedJob?.queuedRun).toMatchObject({
      id: queued.run.id,
      state: "queued",
    });
    expect(queuedJob?.lastRun).toBeNull();
    const [run] = await db
      .select({
        trigger: instanceJobRunTable.trigger,
        actorPersonId: instanceJobRunTable.actorPersonId,
      })
      .from(instanceJobRunTable)
      .where(eq(instanceJobRunTable.id, queued.run.id));
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));
    expect(run).toEqual({ trigger: "manual", actorPersonId: person?.id });

    const [configuration] = await db
      .select({
        pattern: instanceJobConfigurationTable.pattern,
        version: instanceJobConfigurationTable.version,
      })
      .from(instanceJobConfigurationTable)
      .where(eq(instanceJobConfigurationTable.name, "notification-digest"));
    expect(configuration).toEqual({ pattern: "*/7 * * * *", version: 1 });
    const changes = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "job.configuration_changed"),
          eq(schema.auditLogTable.entityId, "notification-digest"),
        ),
      );
    expect(changes).toHaveLength(1);
  });

  it("refuses unknown job names and generic secrets-rekey changes or runs", async () => {
    const user = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    await readyScheduler();

    const unknownPatch = await csrfRequest(
      app,
      "/api/instance/jobs/not-a-registered-job",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ expectedVersion: 0, enabled: false }),
      },
      cookie,
    );
    expect(unknownPatch.status).toBe(404);
    const unknownRun = await csrfRequest(
      app,
      "/api/instance/jobs/not-a-registered-job/run",
      { method: "POST", headers: { cookie } },
      cookie,
    );
    expect(unknownRun.status).toBe(404);

    const rekeyPatch = await csrfRequest(
      app,
      "/api/instance/jobs/secrets-rekey",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ expectedVersion: 0, enabled: false }),
      },
      cookie,
    );
    expect(rekeyPatch.status).toBe(400);
    const rekeyRun = await csrfRequest(
      app,
      "/api/instance/jobs/secrets-rekey/run",
      { method: "POST", headers: { cookie } },
      cookie,
    );
    expect(rekeyRun.status).toBe(404);
  });

  it("denies a non-admin session", async () => {
    const user = await makeUser("user");
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const response = await app.request("/api/instance/jobs", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });

  it("denies a customer-side session", async () => {
    const customer = await createCustomerPrincipal();
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const { app } = createApp();
    const response = await app.request("/api/instance/jobs", {
      headers: {
        cookie: `__Host-tdk_agent_session=token-${customer.user.id}`,
      },
    });
    expect([401, 403]).toContain(response.status);
  });

  it("denies an impersonated administrator session", async () => {
    const user = await makeUser("admin");
    mockAuthenticatedSession(user, { impersonatedBy: `actor-${randomUUID()}` });
    const { app } = createApp();
    const response = await app.request("/api/instance/jobs");
    expect(response.status).toBe(403);
  });

  it("denies an API-key credential even when its owner is an administrator", async () => {
    const user = await makeUser("admin");
    mockAnonymousSession();
    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: user.id,
      userId: user.id,
      key: legacySha256ApiKeyHash(rawKey),
      name: "session-only route fixture",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ "instance:manage_jobs": true }),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = createApp();
    const response = await app.request("/api/instance/jobs", {
      headers: { "x-api-key": rawKey },
    });
    expect([401, 403]).toContain(response.status);
  });
});

describe("instance job history metadata", () => {
  it("keeps a terminal run for 30 days after completion even when requested long ago", async () => {
    const now = Date.now();
    const requestedAt = new Date(now - 45 * 24 * 60 * 60 * 1000);
    const startedAt = new Date(requestedAt.getTime() + 1_000);
    const finishedAt = new Date(now - 60_000);
    const id = randomUUID();
    const expiredId = randomUUID();
    const expiredRequestedAt = new Date(now - 45 * 24 * 60 * 60 * 1000);
    const expiredStartedAt = new Date(expiredRequestedAt.getTime() + 1_000);
    const expiredFinishedAt = new Date(now - 31 * 24 * 60 * 60 * 1000);
    await db.insert(instanceJobRunTable).values([
      {
        id,
        name: "metrics-snapshot",
        trigger: "scheduled",
        state: "succeeded",
        requestedAt,
        startedAt,
        heartbeatAt: finishedAt,
        finishedAt,
        durationMs: 1_000,
      },
      {
        id: expiredId,
        name: "metrics-snapshot",
        trigger: "scheduled",
        state: "succeeded",
        requestedAt: expiredRequestedAt,
        startedAt: expiredStartedAt,
        heartbeatAt: expiredFinishedAt,
        finishedAt: expiredFinishedAt,
        durationMs: 1_000,
      },
    ]);

    await pruneJobRunHistory();

    const [remaining] = await db
      .select({ id: instanceJobRunTable.id })
      .from(instanceJobRunTable)
      .where(eq(instanceJobRunTable.id, id));
    expect(remaining?.id).toBe(id);
    const [expired] = await db
      .select({ id: instanceJobRunTable.id })
      .from(instanceJobRunTable)
      .where(eq(instanceJobRunTable.id, expiredId));
    expect(expired).toBeUndefined();
  });

  it("shows the latest actual execution when a newer manual request is only queued", async () => {
    const now = Date.now();
    const completedId = randomUUID();
    const queuedId = randomUUID();
    const requestedAt = new Date(now - 60 * 60 * 1000);
    const startedAt = new Date(requestedAt.getTime() + 1_000);
    const finishedAt = new Date(requestedAt.getTime() + 2_000);
    await db.insert(instanceJobRunTable).values([
      {
        id: completedId,
        name: "metrics-snapshot",
        trigger: "scheduled",
        state: "succeeded",
        requestedAt,
        startedAt,
        heartbeatAt: finishedAt,
        finishedAt,
        durationMs: 1_000,
      },
      {
        id: queuedId,
        name: "metrics-snapshot",
        trigger: "manual",
        state: "queued",
        requestedAt: new Date(now),
      },
    ]);

    const latest = await readLastJobRuns(["metrics-snapshot"]);
    expect(latest.get("metrics-snapshot")?.id).toBe(completedId);
    expect(latest.get("metrics-snapshot")?.state).toBe("succeeded");
  });
});

describe("manual job claim configuration race", () => {
  it("lets a real disable PATCH win the shared lock, leaves the queued run pending, then permits re-enable", async () => {
    const user = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    await readyScheduler();
    const queuedResponse = await csrfRequest(
      app,
      "/api/instance/jobs/metrics-snapshot/run",
      { method: "POST", headers: { cookie } },
      cookie,
    );
    expect(queuedResponse.status, await queuedResponse.clone().text()).toBe(
      202,
    );
    const queued = (await queuedResponse.json()) as {
      run: { id: string; state: string };
    };
    expect(queued.run.state).toBe("queued");

    let lockReady!: () => void;
    let releaseLock!: () => void;
    const ready = new Promise<void>((resolve) => {
      lockReady = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(2026, hashtext(${"metrics-snapshot"}))`,
      );
      lockReady();
      await held;
    });
    await ready;

    async function waitForAdvisoryWaiters(count: number) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const result = await db.execute(sql`
          SELECT count(*)::int AS count FROM pg_locks
           WHERE locktype = 'advisory' AND granted = false
        `);
        if ((result.rows[0] as { count?: number } | undefined)?.count === count)
          return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Expected ${count} advisory-lock waiter(s)`);
    }

    let patchPromise: Promise<Response> | undefined;
    let dispatchPromise: Promise<void> | undefined;
    const handler = vi.fn(async () => undefined);
    try {
      patchPromise = csrfRequest(
        app,
        "/api/instance/jobs/metrics-snapshot",
        {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: 0, enabled: false }),
        },
        cookie,
      );
      await waitForAdvisoryWaiters(1);
      dispatchPromise = dispatchOneManualRun((name) =>
        name === "metrics-snapshot" ? handler : undefined,
      );
      await waitForAdvisoryWaiters(2);
    } finally {
      releaseLock();
    }

    const [disabled] = await Promise.all([
      patchPromise as Promise<Response>,
      dispatchPromise as Promise<void>,
      lockTransaction,
    ]);
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    expect(await disabled.json()).toMatchObject({
      job: { enabled: false, version: 1 },
    });
    expect(handler).not.toHaveBeenCalled();
    const active = await readQueuedJobRuns(["metrics-snapshot"]);
    expect(active.get("metrics-snapshot")).toMatchObject({
      id: queued.run.id,
      state: "queued",
      trigger: "manual",
    });

    const reenabled = await csrfRequest(
      app,
      "/api/instance/jobs/metrics-snapshot",
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, enabled: true }),
      },
      cookie,
    );
    expect(reenabled.status, await reenabled.clone().text()).toBe(200);
    expect(await reenabled.json()).toMatchObject({
      job: { enabled: true, version: 2 },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(
      (await readQueuedJobRuns(["metrics-snapshot"])).get("metrics-snapshot"),
    ).toMatchObject({ id: queued.run.id, state: "queued" });
  });
});

describe("instance Deliveries HTTP API", () => {
  it("projects actual event, notification, digest, and webhook rows without private content and preserves UTC instants", async () => {
    const admin = await makeUser("admin");
    const owner = await createWorkspaceMember({ role: "member" });
    const [ownerPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id));
    if (!ownerPerson) throw new Error("Delivery recipient fixture is missing");
    const { app } = createApp();
    const cookie = await signIn(app, admin.email);
    const knownInstant = "2026-10-25T06:30:00.000Z";
    const eventId = `delivery-event-${randomUUID()}`;
    const notificationId = `delivery-notification-${randomUUID()}`;
    const digestId = `delivery-digest-${randomUUID()}`;
    const webhookId = `delivery-webhook-${randomUUID()}`;
    const webhookAttemptId = `delivery-attempt-${randomUUID()}`;
    const payloadMarker = `private-payload-${randomUUID()}`;
    const errorMarker = `private-error-${randomUUID()}`;
    const endpointMarker = `https://private-endpoint.invalid/${randomUUID()}`;
    const recipientMarker = owner.user.email;
    const secretMarker = `encrypted-envelope-${randomUUID()}`;

    await db.insert(schema.outboxTable).values({
      eventId,
      kind: "work_item.updated",
      payload: { private: payloadMarker, recipient: recipientMarker },
      workspaceId: owner.workspace.id,
      state: "dead",
      attempts: 2,
      lastError: errorMarker,
      createdAt: new Date(knownInstant),
      updatedAt: new Date(knownInstant),
    });
    await db.execute(sql`
      INSERT INTO notification_digest
        (id, recipient_person_id, channel, workspace_id, cadence, timezone,
         window_start_at, window_end_at, state, attempts, next_attempt_at,
         last_error, created_at, updated_at)
      VALUES
        (${digestId}, ${ownerPerson.id}, 'notify.email', ${owner.workspace.id},
         'daily', 'UTC', TIMESTAMP '2026-10-24 00:00:00',
         TIMESTAMP '2026-10-25 00:00:00', 'dead', 1,
         TIMESTAMP '2026-10-25 06:30:01', ${errorMarker},
         TIMESTAMP '2026-10-25 06:30:00', TIMESTAMP '2026-10-25 06:30:00')
    `);
    await db.execute(sql`
      INSERT INTO notification_delivery
        (id, event_id, recipient_person_id, channel, workspace_id, dedupe_key,
         digest_id, state, attempts, next_attempt_at, delivered_at, last_error,
         created_at, updated_at)
      VALUES
        (${notificationId}, ${eventId}, ${ownerPerson.id}, 'notify.email',
         ${owner.workspace.id}, ${notificationId}, ${digestId}, 'dead', 3,
         TIMESTAMP '2026-10-25 06:30:01', TIMESTAMP '2026-10-25 06:30:02',
         ${errorMarker}, TIMESTAMP '2026-10-25 06:30:00', TIMESTAMP '2026-10-25 06:30:00')
    `);
    await db.insert(webhookTable).values({
      id: webhookId,
      workspaceId: owner.workspace.id,
      name: "Delivery fixture",
      url: endpointMarker,
      secret: secretMarker,
      events: ["work_item.updated"],
      createdBy: ownerPerson.id,
    });
    await db.insert(webhookDeliveryTable).values({
      id: webhookAttemptId,
      webhookId,
      workspaceId: owner.workspace.id,
      eventId,
      eventKind: "work_item.updated",
      attempt: 4,
      state: "dead",
      statusCode: 502,
      durationMs: 321,
      requestBody: { private: payloadMarker },
      responseBody: errorMarker,
      error: errorMarker,
      attemptedAt: new Date(knownInstant),
      createdAt: new Date(knownInstant),
    });

    const response = await app.request("/api/instance/deliveries", {
      headers: { cookie },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      counts: {
        events: { dead: number };
        notifications: { dead: number };
        digests: { dead: number };
        webhooks: { dead: number };
      };
      items: Array<Record<string, unknown>>;
    };
    expect(body.counts).toMatchObject({
      events: { dead: 1 },
      notifications: { dead: 1 },
      digests: { dead: 1 },
      webhooks: { dead: 1 },
    });
    const event = body.items.find((item) => item.id === eventId);
    const notification = body.items.find((item) => item.id === notificationId);
    const digest = body.items.find((item) => item.id === digestId);
    const attempt = body.items.find((item) => item.id === webhookAttemptId);
    expect(event).toMatchObject({
      kind: "event",
      createdAt: knownInstant,
      errorPresent: true,
    });
    expect(notification).toMatchObject({
      kind: "notification",
      createdAt: knownInstant,
      deliveredAt: "2026-10-25T06:30:02.000Z",
      errorPresent: true,
    });
    expect(digest).toMatchObject({
      kind: "digest",
      createdAt: knownInstant,
      children: 1,
      errorPresent: true,
    });
    expect(attempt).toMatchObject({
      kind: "webhook",
      createdAt: knownInstant,
      attemptedAt: knownInstant,
      statusCode: 502,
      durationMs: 321,
      errorPresent: true,
    });
    const serialized = JSON.stringify(body);
    for (const marker of [
      payloadMarker,
      errorMarker,
      endpointMarker,
      recipientMarker,
      secretMarker,
    ])
      expect(serialized).not.toContain(marker);
  });
});
