import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacySha256ApiKeyHash } from "../../apps/api/src/api-key/secret-hash";
import { createServiceApiKey } from "../../apps/api/src/api-key/service";
import { runAuditPurge } from "../../apps/api/src/audit/purge";
import { verifyAuditChain } from "../../apps/api/src/audit/verify-audit-chain";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as legalHolds from "../../apps/api/src/instance/legal-holds";
import { executeHardPurge } from "../../apps/api/src/instance/purge-target";
import { purgeReadNotifications } from "../../apps/api/src/notification/retention";
import { deleteAccountData } from "../../apps/api/src/user/controllers/delete-account-data";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { createImpersonatingAdmin } from "./helpers/impersonator";
import { workItemWorld } from "./helpers/p4-closeout";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const PASSWORD = "legal-holds-integration-password";

async function makeUser(role: string | null) {
  const id = `lh-api-${randomUUID()}`;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: `Legal Hold User ${id}`,
      email: `${id}@example.test`,
      emailVerified: true,
      role,
    })
    .returning();
  if (!user) throw new Error("Legal hold user fixture was not created");
  await ensureStaffPersonForUser(user.id);
  const person = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id)),
    "makeUser.person",
  );
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return { user, person };
}

async function makeOrganisation() {
  const key = `lh-org-${randomUUID()}`;
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key,
        name: "Legal Hold Target Org",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );
}

async function signIn(app: ReturnType<typeof createApp>["app"], email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`Fixture sign-in returned ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) {
    throw new Error("Fixture sign-in did not issue an agent session");
  }
  return cookie;
}

describe("instance legal holds HTTP API (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function mutate(
    app: ReturnType<typeof createApp>["app"],
    cookie: string,
    path: string,
    body: unknown,
  ) {
    return csrfRequest(
      app,
      path,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      cookie,
    );
  }

  it("rejects accounts without a canonical person and protects erasure until HTTP lift", async () => {
    const admin = await makeUser("admin");
    const target = await makeUser(null);
    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, target.person.id));
    const { app } = createApp();
    const cookie = await signIn(app, admin.user.email);
    const body = {
      scope: "person",
      scopeId: target.user.id,
      reason: "Preserve custodian",
    };
    const rejected = await mutate(
      app,
      cookie,
      "/api/instance/legal-holds",
      body,
    );
    expect(rejected.status).toBe(404);
    expect(await rejected.text()).toBe("Person not found");
    await ensureStaffPersonForUser(target.user.id);
    const placed = await mutate(app, cookie, "/api/instance/legal-holds", body);
    expect(placed.status).toBe(201);
    const hold = (await placed.json()) as { id: string; scopeId: string };
    expect(hold.scopeId).not.toBe(target.user.id);
    expect(
      (
        await mutate(app, cookie, "/api/instance/legal-holds", {
          ...body,
          scopeId: hold.scopeId,
        })
      ).status,
    ).toBe(409);
    await expect(deleteAccountData(target.user.id)).rejects.toMatchObject({
      status: "CONFLICT",
      body: { code: "legal_hold" },
    });
    expect(
      (
        await mutate(
          app,
          cookie,
          `/api/instance/legal-holds/${hold.id}/lift`,
          {},
        )
      ).status,
    ).toBe(200);
    await expect(deleteAccountData(target.user.id)).resolves.toBeDefined();
  });

  it("refuses hard purge under an HTTP hold and succeeds after HTTP lift", async () => {
    const admin = await makeUser("admin");
    const member = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const world = await workItemWorld(member.workspace.id, project.id);
    const item = await world.makeItem("Held purge target");
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, item.id));
    const { app } = createApp();
    const cookie = await signIn(app, admin.user.email);
    const response = await mutate(app, cookie, "/api/instance/legal-holds", {
      scope: "organisation",
      scopeId: member.workspace.organisationId,
      reason: "Preserve purge target",
    });
    expect(response.status).toBe(201);
    const hold = (await response.json()) as { id: string };
    const target = { targetType: "work_item" as const, targetId: item.id };
    await expect(
      db.transaction((tx) => executeHardPurge(tx, target)),
    ).rejects.toMatchObject({
      check: { status: "refused", reason: "legal_hold" },
    });
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, item.id)),
    ).toHaveLength(1);
    expect(
      (
        await mutate(
          app,
          cookie,
          `/api/instance/legal-holds/${hold.id}/lift`,
          {},
        )
      ).status,
    ).toBe(200);
    await expect(
      db.transaction((tx) => executeHardPurge(tx, target)),
    ).resolves.toMatchObject({ targetId: item.id });
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, item.id)),
    ).toHaveLength(0);
  });

  it("reports unavailable hold counts without manufacturing zero", async () => {
    const admin = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, admin.user.email);
    const spy = vi
      .spyOn(legalHolds, "countActiveLegalHolds")
      .mockRejectedValue(new Error("count unavailable"));
    try {
      const response = await app.request("/api/instance/health", {
        headers: { cookie },
      });
      expect(response.status).toBe(200);
      const health = (await response.json()) as {
        state: string;
        legalHolds: unknown;
      };
      expect(health.legalHolds).toEqual({
        state: "unknown",
        activeCount: null,
      });
      expect(health.state).not.toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });

  it("serializes row-blocked notification retention before hold placement and preserves held rows", async () => {
    const admin = await makeUser("admin");
    const target = await makeUser(null);
    const { app } = createApp();
    const cookie = await signIn(app, admin.user.email);
    const notification = {
      id: randomUUID(),
      userId: target.user.id,
      personId: target.person.id,
      type: "info",
      title: "retention race",
      resourceType: "person",
      resourceId: target.person.id,
      isRead: true,
      readAt: new Date(Date.now() - 200 * 86400000),
    };
    await db.insert(schema.notificationTable).values(notification);
    const blocker = await getDatabasePool().connect();
    let purge: Promise<number> | undefined;
    let placement: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM notification WHERE id = $1 FOR UPDATE",
        [notification.id],
      );
      purge = purgeReadNotifications();
      await vi.waitFor(async () => {
        const locks = await blocker.query(
          "SELECT 1 FROM pg_locks WHERE relation = 'notification'::regclass AND mode = 'RowExclusiveLock' AND pid <> pg_backend_pid()",
        );
        expect(locks.rowCount).toBeGreaterThan(0);
      });
      placement = mutate(app, cookie, "/api/instance/legal-holds", {
        scope: "person",
        scopeId: target.person.id,
        reason: "Concurrent retention hold",
      });
      await vi.waitFor(async () => {
        const locks = await blocker.query(
          "SELECT 1 FROM pg_locks WHERE relation = 'legal_hold'::regclass AND mode = 'ShareRowExclusiveLock' AND NOT granted",
        );
        expect(locks.rowCount).toBeGreaterThan(0);
      });
      await blocker.query("COMMIT");
      expect(await purge).toBe(1);
      expect((await placement).status).toBe(201);
      await db
        .insert(schema.notificationTable)
        .values({ ...notification, id: randomUUID() });
      expect(await purgeReadNotifications()).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([purge, placement]);
    }
  });

  it("orders hold placement and lift ahead of audit-chain locking during concurrent purge", async () => {
    const admin = await makeUser("admin");
    const org = await makeOrganisation();
    const { app } = createApp();
    const cookie = await signIn(app, admin.user.email);
    const blocker = await getDatabasePool().connect();
    try {
      // A held exclusive fence queues both contenders; observing the queue proves overlap.
      for (const lifting of [false, true]) {
        await blocker.query("BEGIN");
        await blocker.query(
          "LOCK TABLE legal_hold IN SHARE ROW EXCLUSIVE MODE",
        );
        const holds = await db.select().from(schema.legalHoldTable);
        const path = lifting
          ? `/api/instance/legal-holds/${holds[0]?.id}/lift`
          : "/api/instance/legal-holds";
        const mutation = mutate(
          app,
          cookie,
          path,
          lifting
            ? {}
            : { scope: "organisation", scopeId: org.id, reason: "Audit race" },
        );
        await vi.waitFor(async () => {
          const locks = await blocker.query(
            "SELECT 1 FROM pg_locks WHERE relation = 'legal_hold'::regclass AND NOT granted",
          );
          expect(locks.rowCount).toBeGreaterThan(0);
        });
        const purge = runAuditPurge();
        await vi.waitFor(async () => {
          const locks = await blocker.query(
            "SELECT 1 FROM pg_locks WHERE relation = 'legal_hold'::regclass AND NOT granted",
          );
          expect(locks.rowCount).toBeGreaterThanOrEqual(2);
        });
        await blocker.query("COMMIT");
        expect((await mutation).status).toBe(lifting ? 200 : 201);
        expect((await purge).status).not.toBe("skipped");
      }
      expect((await verifyAuditChain(db)).ok).toBe(true);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

  it("places, canonicalizes person targets, updates health counts, lifts holds, and verifies the audit chain", async () => {
    const admin = await makeUser("admin");
    const target = await makeUser(null);
    const org = await makeOrganisation();
    const { app } = createApp();
    const cookie = await signIn(app, admin.user.email);

    const initialList = await app.request("/api/instance/legal-holds", {
      headers: { cookie },
    });
    expect(initialList.status).toBe(200);
    expect(initialList.headers.get("cache-control")).toBe("no-store");
    expect(await initialList.json()).toMatchObject({
      activeCount: 0,
      holds: [],
    });

    const missingOrg = await csrfRequest(
      app,
      "/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: `missing-org-${randomUUID()}`,
          reason: "Should 404",
        }),
      },
      cookie,
    );
    expect(missingOrg.status).toBe(404);

    const placeOrg = await csrfRequest(
      app,
      "/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: org.id,
          reason: "Regulatory preservation hold",
        }),
      },
      cookie,
    );
    expect(placeOrg.status).toBe(201);
    expect(placeOrg.headers.get("cache-control")).toBe("no-store");
    const orgHold = (await placeOrg.json()) as {
      id: string;
      scope: string;
      scopeId: string;
      status: string;
      reason: string;
    };
    expect(orgHold).toMatchObject({
      scope: "organisation",
      scopeId: org.id,
      status: "active",
      reason: "Regulatory preservation hold",
    });

    const dupOrg = await csrfRequest(
      app,
      "/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: org.id,
          reason: "Duplicate hold must conflict",
        }),
      },
      cookie,
    );
    expect(dupOrg.status).toBe(409);

    // Supplying user.id for a person hold must canonicalize to person.id in both response and DB.
    const placePerson = await csrfRequest(
      app,
      "/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          scope: "person",
          scopeId: target.user.id,
          reason: "Custodian litigation hold",
        }),
      },
      cookie,
    );
    expect(placePerson.status).toBe(201);
    const personHold = (await placePerson.json()) as {
      id: string;
      scope: string;
      scopeId: string;
      status: string;
    };
    expect(personHold).toMatchObject({
      scope: "person",
      scopeId: target.person.id,
      status: "active",
    });

    const [storedPersonHold] = await db
      .select()
      .from(schema.legalHoldTable)
      .where(eq(schema.legalHoldTable.id, personHold.id));
    expect(storedPersonHold?.scopeId).toBe(target.person.id);

    const dupByPersonId = await csrfRequest(
      app,
      "/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          scope: "person",
          scopeId: target.person.id,
          reason: "Duplicate canonical hold must conflict",
        }),
      },
      cookie,
    );
    expect(dupByPersonId.status).toBe(409);

    const health = await app.request("/api/instance/health", {
      headers: { cookie },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      legalHolds: { activeCount: 2 },
    });

    const filteredActive = await app.request(
      `/api/instance/legal-holds?status=active&scope=person&scopeId=${encodeURIComponent(target.person.id)}`,
      { headers: { cookie } },
    );
    expect(filteredActive.status).toBe(200);
    expect(await filteredActive.json()).toMatchObject({
      activeCount: 2,
      holds: [{ id: personHold.id, status: "active" }],
    });

    const liftRes = await csrfRequest(
      app,
      `/api/instance/legal-holds/${orgHold.id}/lift`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ reason: "Matter closed" }),
      },
      cookie,
    );
    expect(liftRes.status).toBe(200);
    expect(liftRes.headers.get("cache-control")).toBe("no-store");
    expect(await liftRes.json()).toMatchObject({
      id: orgHold.id,
      status: "lifted",
      liftedBy: { id: admin.user.id },
    });

    const reliftRes = await csrfRequest(
      app,
      `/api/instance/legal-holds/${orgHold.id}/lift`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ reason: "Cannot lift twice" }),
      },
      cookie,
    );
    expect(reliftRes.status).toBe(409);

    const missingLift = await csrfRequest(
      app,
      `/api/instance/legal-holds/missing-${randomUUID()}/lift`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      },
      cookie,
    );
    expect(missingLift.status).toBe(404);

    const auditRows = await db
      .select({
        action: schema.auditLogTable.action,
        entityType: schema.auditLogTable.entityType,
        entityId: schema.auditLogTable.entityId,
        organisationId: schema.auditLogTable.organisationId,
      })
      .from(schema.auditLogTable);
    expect(auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "legal_hold.placed",
          entityType: "legal_hold",
          entityId: orgHold.id,
          organisationId: org.id,
        }),
        expect.objectContaining({
          action: "legal_hold.placed",
          entityType: "legal_hold",
          entityId: personHold.id,
          organisationId: null,
        }),
        expect.objectContaining({
          action: "legal_hold.lifted",
          entityType: "legal_hold",
          entityId: orgHold.id,
          organisationId: org.id,
        }),
      ]),
    );
    const chain = await verifyAuditChain(db);
    expect(chain.ok).toBe(true);
  });

  it("denies non-admins, customer sessions, impersonated admins, non-agent hosts, and API keys", async () => {
    const admin = await makeUser("admin");
    const nonAdmin = await makeUser(null);
    const org = await makeOrganisation();
    const { app } = createApp();
    const adminCookie = await signIn(app, admin.user.email);

    const placedRes = await csrfRequest(
      app,
      "/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: org.id,
          reason: "Access control test hold",
        }),
      },
      adminCookie,
    );
    expect(placedRes.status).toBe(201);
    const hold = (await placedRes.json()) as { id: string };

    // 1. Non-admin session
    const nonAdminCookie = await signIn(app, nonAdmin.user.email);
    expect(
      (
        await app.request("/api/instance/legal-holds", {
          headers: { cookie: nonAdminCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await csrfRequest(
          app,
          "/api/instance/legal-holds",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: nonAdminCookie,
            },
            body: JSON.stringify({
              scope: "organisation",
              scopeId: org.id,
              reason: "Must fail",
            }),
          },
          nonAdminCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await csrfRequest(
          app,
          `/api/instance/legal-holds/${hold.id}/lift`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: nonAdminCookie,
            },
            body: JSON.stringify({}),
          },
          nonAdminCookie,
        )
      ).status,
    ).toBe(403);

    const requests = [
      { path: "/api/instance/legal-holds", method: "GET", body: undefined },
      {
        path: "/api/instance/legal-holds",
        method: "POST",
        body: JSON.stringify({
          scope: "organisation",
          scopeId: org.id,
          reason: "Denied",
        }),
      },
      {
        path: `/api/instance/legal-holds/${hold.id}/lift`,
        method: "POST",
        body: "{}",
      },
    ];
    for (const request of requests) {
      expect(
        (
          await app.request(`http://portal.localhost:5174${request.path}`, {
            ...request,
            headers: {
              cookie: adminCookie,
              "content-type": "application/json",
            },
          })
        ).status,
      ).toBe(404);
    }

    // 2. Non-agent host (portal host hides agent-only /api/instance/* routes -> 404)
    expect(
      (
        await app.request(
          "http://portal.localhost:5174/api/instance/legal-holds",
          {
            headers: { cookie: adminCookie },
          },
        )
      ).status,
    ).toBe(404);

    // 3. Customer portal session
    const customer = await createCustomerPrincipal();
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    expect([401, 403]).toContain(
      (
        await app.request("/api/instance/legal-holds", {
          headers: {
            cookie: `__Host-tdk_agent_session=token-${customer.user.id}`,
          },
        })
      ).status,
    );

    for (const request of requests) {
      expect([401, 403]).toContain(
        (
          await app.request(request.path, {
            ...request,
            headers: { "content-type": "application/json" },
          })
        ).status,
      );
    }

    // 4. Impersonated instance admin
    mockAuthenticatedSession(admin.user, {
      impersonatedBy: await createImpersonatingAdmin(),
    });
    expect((await app.request("/api/instance/legal-holds")).status).toBe(403);

    for (const request of requests) {
      expect(
        (
          await app.request(request.path, {
            ...request,
            headers: { "content-type": "application/json" },
          })
        ).status,
      ).toBe(403);
    }

    // 5. API key even with admin owner
    mockAnonymousSession();
    const owner = await createWorkspaceMember({ role: "owner" });
    const service = await createServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      { name: "hold denial", capabilities: ["workspace:read"] },
    );
    for (const key of [service.key, "taskdesk_missing_key", undefined]) {
      for (const request of requests) {
        expect([401, 403]).toContain(
          (
            await app.request(request.path, {
              ...request,
              headers: {
                "content-type": "application/json",
                ...(key ? { "x-api-key": key } : {}),
              },
            })
          ).status,
        );
      }
    }
    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: admin.user.id,
      userId: admin.user.id,
      key: legacySha256ApiKeyHash(rawKey),
      name: "legal-hold session-only gate fixture",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ "instance:admin": true }),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const req of [
      app.request("/api/instance/legal-holds", {
        headers: { "x-api-key": rawKey },
      }),
      app.request("/api/instance/legal-holds", {
        method: "POST",
        headers: { "x-api-key": rawKey, "content-type": "application/json" },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: org.id,
          reason: "API key must fail",
        }),
      }),
      app.request(`/api/instance/legal-holds/${hold.id}/lift`, {
        method: "POST",
        headers: { "x-api-key": rawKey, "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    ]) {
      const res = await req;
      expect([401, 403]).toContain(res.status);
    }
  });
});
