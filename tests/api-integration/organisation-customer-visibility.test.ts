import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

function request(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  init?: RequestInit,
) {
  const r = withConfiguredAgentAuthority(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return app.request(r.input, r.init);
}

async function seedAdmin() {
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const [admin] = await db
    .insert(schema.userTable)
    .values({
      id: "organisation-visibility-admin",
      name: "Visibility Admin",
      email: "organisation-visibility-admin@example.test",
      role: "admin",
    })
    .returning();
  if (!admin) throw new Error("admin fixture missing");
  await ensureStaffPersonForUser(admin.id);
  return admin;
}

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("God Mode organisation customer visibility (CP-16)", () => {
  it("round-trips the default with optimistic concurrency and transactional audit", async () => {
    const admin = await seedAdmin();
    mockAuthenticatedSession(admin);
    const [organisation] = await db
      .insert(schema.organisationTable)
      .values({
        id: "visibility-live-org",
        key: "VIS",
        name: "Visibility Customer",
      })
      .returning();
    if (!organisation) throw new Error("organisation fixture missing");
    const { app } = createApp();
    const basePath = `/api/instance/organisations/${organisation.id}/customer-visibility`;

    const read = await request(app, basePath);
    expect(read.status).toBe(200);
    const initial = (await read.json()) as {
      data: { defaultCustomerVisibility: string; updatedAt: string };
    };
    expect(initial.data.defaultCustomerVisibility).toBe("organisation");

    const save = await request(app, basePath, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: initial.data.updatedAt,
        defaultCustomerVisibility: "private",
      }),
    });
    expect(save.status).toBe(200);
    const saved = (await save.json()) as {
      data: { defaultCustomerVisibility: string; updatedAt: string };
    };
    expect(saved.data.defaultCustomerVisibility).toBe("private");
    expect(new Date(saved.data.updatedAt).getTime()).toBeGreaterThan(
      new Date(initial.data.updatedAt).getTime(),
    );

    const noOp = await request(app, basePath, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: saved.data.updatedAt,
        defaultCustomerVisibility: "private",
      }),
    });
    expect(noOp.status).toBe(200);
    expect(await noOp.json()).toMatchObject({
      data: {
        defaultCustomerVisibility: "private",
        updatedAt: saved.data.updatedAt,
      },
    });

    const stale = await request(app, basePath, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: initial.data.updatedAt,
        defaultCustomerVisibility: "organisation",
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ message: "version_conflict" });

    const [stored] = await db
      .select({ value: schema.organisationTable.defaultCustomerVisibility })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.id, organisation.id));
    expect(stored?.value).toBe("private");
    const auditRows = await db
      .select({
        action: schema.auditLogTable.action,
        entityType: schema.auditLogTable.entityType,
        entityId: schema.auditLogTable.entityId,
        organisationId: schema.auditLogTable.organisationId,
        before: schema.auditLogTable.before,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "instance.settings_changed"),
          eq(schema.auditLogTable.entityId, organisation.id),
        ),
      );
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0];
    expect(audit).toMatchObject({
      action: "instance.settings_changed",
      entityType: "organisation",
      entityId: organisation.id,
      organisationId: organisation.id,
      before: null,
      after: { changedKeys: ["defaultCustomerVisibility"] },
    });
    expect(JSON.stringify(audit)).not.toContain("private");
  });

  it("does not expose internal, inactive, soft-deleted, or unknown organisations", async () => {
    const admin = await seedAdmin();
    mockAuthenticatedSession(admin);
    const [inactive] = await db
      .insert(schema.organisationTable)
      .values({
        id: "visibility-inactive-org",
        key: "VISOFF",
        name: "Suspended Visibility Customer",
        active: false,
      })
      .returning();
    const [deleted] = await db
      .insert(schema.organisationTable)
      .values({
        id: "visibility-deleted-org",
        key: "VISDEL",
        name: "Deleted Visibility Customer",
        deletedAt: new Date(),
      })
      .returning();
    if (!inactive || !deleted) throw new Error("organisation fixtures missing");
    const [internal] = await db
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true))
      .limit(1);
    if (!internal) throw new Error("internal organisation fixture missing");
    const { app } = createApp();

    for (const id of [inactive.id, deleted.id, internal.id, "missing-org"]) {
      const response = await request(
        app,
        `/api/instance/organisations/${id}/customer-visibility`,
      );
      expect(response.status).toBe(404);
    }
  });

  it("refuses values outside the closed CP-16 visibility set", async () => {
    const admin = await seedAdmin();
    mockAuthenticatedSession(admin);
    const [organisation] = await db
      .insert(schema.organisationTable)
      .values({
        id: "visibility-validation-org",
        key: "VISVALID",
        name: "Visibility Validation Customer",
      })
      .returning();
    if (!organisation) throw new Error("organisation fixture missing");
    const { app } = createApp();
    const basePath = `/api/instance/organisations/${organisation.id}/customer-visibility`;
    const read = await request(app, basePath);
    const initial = (await read.json()) as { data: { updatedAt: string } };
    const invalid = await request(app, basePath, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: initial.data.updatedAt,
        defaultCustomerVisibility: "public",
      }),
    });
    expect(invalid.status).toBe(400);
  });

  it("refuses an instance administrator API key because the setting is browser-session-only", async () => {
    const admin = await seedAdmin();
    const rawKey = `taskdesk_visibility_${randomUUID()}`;
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: admin.id,
      userId: admin.id,
      key: hashApiKeyForTest(rawKey),
      name: "visibility test key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const response = await app.request(
      "/api/instance/organisations/any-org/customer-visibility",
      { headers: { "x-api-key": rawKey } },
    );

    expect(response.status).toBe(403);
    expect((await response.text()).toLowerCase()).toContain("session_required");
  });
});
