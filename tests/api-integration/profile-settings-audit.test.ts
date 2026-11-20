import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as auditWriter from "../../apps/api/src/audit/audit-writer";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { renderObservabilityMetrics } from "../../apps/api/src/instance/observability/runtime";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import { createImpersonatingAdmin } from "./helpers/impersonator";
import { nextClientIp, signUpUser } from "./helpers/organization-http";

type App = ReturnType<typeof createApp>["app"];

function updateProfile(
  app: App,
  body: Record<string, unknown>,
  cookie?: string,
  extraHeaders: Record<string, string> = {},
) {
  return app.request("/api/auth/update-user", {
    method: "POST",
    headers: {
      origin: getConfiguredAgentOrigin(),
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function profileRows(userId: string) {
  return db
    .select({
      actorId: schema.auditLogTable.actorId,
      entityType: schema.auditLogTable.entityType,
      entityId: schema.auditLogTable.entityId,
      workspaceId: schema.auditLogTable.workspaceId,
      projectId: schema.auditLogTable.projectId,
      before: schema.auditLogTable.before,
      after: schema.auditLogTable.after,
    })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "user.profile_updated"),
        eq(schema.auditLogTable.actorId, userId),
      ),
    );
}

async function storedProfile(userId: string) {
  const [row] = await db
    .select({
      name: schema.userTable.name,
      locale: schema.userTable.locale,
      image: schema.userTable.image,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  if (!row) throw new Error("Profile fixture user disappeared");
  return row;
}

async function mutationFailureCount() {
  const metrics = await renderObservabilityMetrics();
  const count = metrics.match(
    /^taskdesk_audit_write_failures_total\{operation="mutation"\} ([0-9]+)$/m,
  );
  return Number(count?.[1] ?? 0);
}

function hasPostgresSqlState(error: unknown, expected: string) {
  const seen = new Set<object>();
  let current = error;
  while (current !== null && typeof current === "object") {
    if (seen.has(current)) return false;
    seen.add(current);
    if ("code" in current && current.code === expected) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("actual Better Auth self-profile settings audit", () => {
  it("records effective closed fields once and exposes only the safe own-history projection", async () => {
    const { app } = createApp();
    const { user, cookie } = await signUpUser(app);
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));
    if (!person) throw new Error("Sign-up did not create a staff person");
    const body = {
      name: "Updated profile name",
      locale: "en-US",
      image: "https://private.example.test/avatar.png",
    };

    expect((await updateProfile(app, body, cookie)).status).toBe(200);
    expect(await storedProfile(user.id)).toMatchObject(body);
    const rows = await profileRows(user.id);
    expect(rows).toMatchObject([
      {
        actorId: user.id,
        entityType: "user_profile",
        entityId: person.id,
        workspaceId: null,
        projectId: null,
        before: null,
        after: { changedFields: ["name", "locale", "image"] },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(body.image);
    expect(JSON.stringify(rows)).not.toContain(body.name);

    expect((await updateProfile(app, body, cookie)).status).toBe(200);
    expect(await profileRows(user.id)).toHaveLength(1);

    const history = await app.request(
      "/api/me/settings/history?section=profile",
      { headers: { cookie } },
    );
    expect(history.status).toBe(200);
    expect(history.headers.get("cache-control")).toContain("no-store");
    const projection = await history.json();
    expect(projection).toMatchObject({
      section: "profile",
      lastChanged: { actor: "you" },
      rows: [{ actor: "you", changedFields: ["name", "locale", "image"] }],
    });
    expect(Object.keys(projection as Record<string, unknown>).sort()).toEqual([
      "lastChanged",
      "rows",
      "section",
    ]);
    expect(JSON.stringify(projection)).not.toContain(user.id);
    expect(JSON.stringify(projection)).not.toContain(body.image);
    expect(JSON.stringify(projection)).not.toContain(body.name);
  });

  it("keeps the edit on an audit append failure and notifies a current instance admin", async () => {
    const { app } = createApp();
    const { user, cookie } = await signUpUser(app);
    const adminId = `profile-audit-admin-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: adminId,
      name: "Profile audit administrator",
      email: `${adminId}@example.test`,
      role: "admin",
    });
    await ensureStaffPersonForUser(adminId);
    const beforeFailures = await mutationFailureCount();
    const originalAppend = auditWriter.appendAuditLog;
    let postgresDivisionByZeroObserved = false;
    const appendSpy = vi
      .spyOn(auditWriter, "appendAuditLog")
      .mockImplementation(async (tx, entry) => {
        if (entry.action === "user.profile_updated") {
          try {
            await tx.execute(sql`select 1 / 0`);
          } catch (error) {
            postgresDivisionByZeroObserved = hasPostgresSqlState(
              error,
              "22012",
            );
            throw error;
          }
          throw new Error("Expected PostgreSQL division-by-zero failure");
        }
        return originalAppend(tx, entry);
      });
    let response: Response;
    try {
      response = await updateProfile(
        app,
        { name: "Saved despite audit gap" },
        cookie,
      );
    } finally {
      appendSpy.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(postgresDivisionByZeroObserved).toBe(true);
    expect((await storedProfile(user.id)).name).toBe("Saved despite audit gap");
    expect(await profileRows(user.id)).toHaveLength(0);
    expect(await mutationFailureCount()).toBe(beforeFailures + 1);
    const alerts = await db
      .select({
        userId: schema.notificationTable.userId,
        eventData: schema.notificationTable.eventData,
      })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "audit_write_failed"));
    expect(alerts).toMatchObject([
      { userId: adminId, eventData: { operation: "mutation" } },
    ]);
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify(alerts)).not.toContain("division by zero");
    expect(JSON.stringify(alerts)).not.toContain("22012");
  });

  it("denies absent sessions, valid API keys, impersonation, and the portal host", async () => {
    const { app } = createApp();
    const { user, cookie } = await signUpUser(app);
    const initial = await storedProfile(user.id);
    expect((await updateProfile(app, { name: "No session" })).status).toBe(401);

    const rawKey = `taskdesk_test_${randomUUID()}`;
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: user.id,
      userId: user.id,
      key: createHash("sha256").update(rawKey).digest("base64url"),
      name: "profile session-only denial",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ user: ["update"] }),
      createdAt: now,
      updatedAt: now,
    });
    const keyResponse = await updateProfile(
      app,
      { name: "Key attempt" },
      undefined,
      { authorization: `Bearer ${rawKey}` },
    );
    expect([401, 403, 404]).toContain(keyResponse.status);
    const keyHistory = await app.request(
      "/api/me/settings/history?section=profile",
      { headers: { authorization: `Bearer ${rawKey}` } },
    );
    expect([401, 403, 404]).toContain(keyHistory.status);

    const customerOrigin = getConfiguredCustomerOrigin();
    const wrongHost = await app.request(
      `${customerOrigin}/api/auth/update-user`,
      {
        method: "POST",
        headers: {
          host: new URL(customerOrigin).host,
          origin: customerOrigin,
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Wrong host" }),
      },
    );
    expect(wrongHost.status).toBe(404);

    const impersonatorId = await createImpersonatingAdmin();
    await db
      .update(schema.sessionTable)
      .set({ impersonatedBy: impersonatorId })
      .where(eq(schema.sessionTable.userId, user.id));
    const impersonated = await updateProfile(
      app,
      { name: "Impersonation attempt" },
      cookie,
    );
    expect(impersonated.status).toBe(403);
    expect(await storedProfile(user.id)).toEqual(initial);
    expect(await profileRows(user.id)).toHaveLength(0);
  });

  it("serializes simultaneous distinct edits to one stored user", async () => {
    const { app } = createApp();
    const { user, cookie } = await signUpUser(app);
    const responses = await Promise.all([
      updateProfile(app, { name: "Concurrent first" }, cookie),
      updateProfile(app, { name: "Concurrent second" }, cookie),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(["Concurrent first", "Concurrent second"]).toContain(
      (await storedProfile(user.id)).name,
    );
    const rows = await profileRows(user.id);
    expect(rows).toHaveLength(2);
    expect(rows.map(({ after }) => after)).toEqual([
      { changedFields: ["name"] },
      { changedFields: ["name"] },
    ]);
    expect(JSON.stringify(rows)).not.toContain("Concurrent first");
    expect(JSON.stringify(rows)).not.toContain("Concurrent second");

    const duplicateResponses = await Promise.all([
      updateProfile(app, { name: "Concurrent shared" }, cookie),
      updateProfile(app, { name: "Concurrent shared" }, cookie),
    ]);
    expect(duplicateResponses.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect((await storedProfile(user.id)).name).toBe("Concurrent shared");
    expect(await profileRows(user.id)).toHaveLength(3);
  });
});
