import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../apps/api/src/audit/repository";
import { entityHistoryRow } from "../../apps/api/src/audit/settings-history";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { addCustomer, buildTenant } from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function expectClosedDenial(
  response: Response,
  status: 403 | 404,
  actorName: string,
) {
  if (response.status !== status) throw new Error("Unexpected denial status");
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.toLowerCase();
  const body = await response.text();
  if (contentType === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("Malformed JSON denial response");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      (parsed as Record<string, unknown>).message !==
        (status === 404 ? "Not Found" : "Forbidden") ||
      body.includes(actorName)
    )
      throw new Error("Unexpected JSON denial metadata");
  } else if (contentType === "text/plain") {
    if (
      body !==
      (status === 404 ? "History not found" : "Insufficient permissions")
    )
      throw new Error("Unexpected plain-text denial metadata");
  } else {
    throw new Error("Unexpected denial content type");
  }
}

it("accepts only closed JSON and plain-text denial formats", async () => {
  await expect(
    expectClosedDenial(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
      403,
      "Actor",
    ),
  ).resolves.toBeUndefined();
  await expect(
    expectClosedDenial(
      new Response("History not found", { status: 404 }),
      404,
      "Actor",
    ),
  ).resolves.toBeUndefined();
  await expect(
    expectClosedDenial(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
      404,
      "Actor",
    ),
  ).resolves.toBeUndefined();
  await expect(
    expectClosedDenial(
      new Response("History not found", { status: 404 }),
      403,
      "Actor",
    ),
  ).rejects.toThrow("Unexpected denial status");
  await expect(
    expectClosedDenial(
      new Response(
        JSON.stringify({ message: "Forbidden", rows: [{ actor: "Actor" }] }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
      403,
      "Actor",
    ),
  ).rejects.toThrow("Unexpected JSON denial metadata");
});

describe("P5 personal and service-key history on a fresh test database", () => {
  beforeEach(async () => resetTestDatabase());

  it("rechecks live service key, session, workspace membership and capability for rows and actor names", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    const sessionId = `p5-session-${randomUUID()}`;
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `p5-token-${randomUUID()}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const keyId = `p5-service-${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      name: "Synthetic service key",
      key: `synthetic-hash-${randomUUID()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(apiKeyExtensionTable).values({
      apikeyId: keyId,
      workspaceId: owner.workspace.id,
      personId: null,
      isMcp: false,
    });
    await appendAuditLog(db, {
      actorId: owner.user.id,
      actorType: "person",
      workspaceId: owner.workspace.id,
      action: "api_key.created",
      entityType: "api_key",
      entityId: keyId,
      after: { kind: "service" },
    });
    const identity = await resolveIdentity({
      userId: owner.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing staff identity");
    const input = {
      identity,
      entityType: "service_api_key" as const,
      entityId: keyId,
      sessionId,
      workspaceId: owner.workspace.id,
      projectId: null,
    };
    const visible = await listSettingsHistoryRows(input);
    expect(visible).toHaveLength(1);
    expect(
      entityHistoryRow(
        visible[0] as NonNullable<(typeof visible)[number]>,
        null,
        "service_api_key",
      ).changedFields,
    ).toEqual([]);
    expect(
      (await listSettingsHistoryActorNames(input, [owner.user.id])).get(
        owner.user.id,
      ),
    ).toBe(owner.user.name);
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, keyId));
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);

    const denied = async () => {
      expect(await listSettingsHistoryRows(input)).toEqual([]);
      expect(
        await listSettingsHistoryActorNames(input, [owner.user.id]),
      ).toEqual(new Map());
    };
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, owner.workspace.id),
          eq(schema.workspaceUserTable.userId, owner.user.id),
        ),
      );
    await denied();
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, owner.workspace.id),
          eq(schema.workspaceUserTable.userId, owner.user.id),
        ),
      );
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);
    await db
      .update(apiKeyExtensionTable)
      .set({ workspaceId: other.workspace.id })
      .where(eq(apiKeyExtensionTable.apikeyId, keyId));
    await denied();
    expect(
      await listSettingsHistoryRows({
        ...input,
        workspaceId: other.workspace.id,
      }),
    ).toEqual([]);
    await db
      .update(apiKeyExtensionTable)
      .set({ workspaceId: owner.workspace.id })
      .where(eq(apiKeyExtensionTable.apikeyId, keyId));
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.id, sessionId));
    await denied();
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `p5-token-${randomUUID()}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db.delete(schema.apikeyTable).where(eq(schema.apikeyTable.id, keyId));
    await denied();
  });

  it("serves closed service-key history through the staff route and denies revoked or foreign targets", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    const token = `token-${owner.user.id}`;
    await db.insert(schema.sessionTable).values({
      id: `session-${owner.user.id}`,
      token,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const keyId = `p5-service-${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      name: "Synthetic service key",
      key: `synthetic-hash-${randomUUID()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(apiKeyExtensionTable).values({
      apikeyId: keyId,
      workspaceId: owner.workspace.id,
      personId: null,
      isMcp: false,
    });
    await appendAuditLog(db, {
      actorId: owner.user.id,
      actorType: "person",
      workspaceId: owner.workspace.id,
      action: "api_key.created",
      entityType: "api_key",
      entityId: keyId,
      after: { kind: "service" },
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const path = `/api/audit?entity_type=service_api_key&entity_id=${encodeURIComponent(keyId)}`;
    const headers = {
      host: "localhost:1337",
      cookie: `__Host-tdk_agent_session=${token}`,
    };
    const visible = await app.request(path, { headers });
    expect(visible.status).toBe(200);
    expect(visible.headers.get("cache-control")).toBe("no-store");
    const body = await visible.json();
    expect(Object.keys(body).sort()).toEqual([
      "entityId",
      "entityType",
      "lastChanged",
      "rows",
    ]);
    expect(body.entityType).toBe("service_api_key");
    expect(body.entityId).toBe(keyId);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toEqual({
      at: expect.any(String),
      actor: { kind: "person", name: owner.user.name },
      action: "api_key.created",
      changedFields: [],
    });
    expect(body.lastChanged).toEqual({
      at: body.rows[0].at,
      actor: body.rows[0].actor,
    });

    const expectDenied = async (
      status: 403 | 404,
      requestHeaders = headers,
      requestPath = path,
    ) => {
      const response = await app.request(requestPath, {
        headers: requestHeaders,
      });
      await expectClosedDenial(response, status, owner.user.name);
    };
    await expectDenied(
      404,
      headers,
      `/api/audit?entity_type=service_api_key&entity_id=missing-${randomUUID()}`,
    );
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, owner.workspace.id),
          eq(schema.workspaceUserTable.userId, owner.user.id),
        ),
      );
    await expectDenied(403);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, owner.workspace.id),
          eq(schema.workspaceUserTable.userId, owner.user.id),
        ),
      );
    await db
      .update(apiKeyExtensionTable)
      .set({ workspaceId: other.workspace.id })
      .where(eq(apiKeyExtensionTable.apikeyId, keyId));
    await expectDenied(404);
    await db
      .update(apiKeyExtensionTable)
      .set({ workspaceId: owner.workspace.id })
      .where(eq(apiKeyExtensionTable.apikeyId, keyId));
    await expectDenied(404, {
      ...headers,
      host: "portal.localhost:5174",
    });
    await db.delete(schema.apikeyTable).where(eq(schema.apikeyTable.id, keyId));
    await expectDenied(404);
  });

  it("returns only closed self-authored security and personal-key metadata, including deleted-key history", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, user.id)),
      "P5 self person",
    );
    const sessionId = `session-${user.id}`;
    const token = `token-${user.id}`;
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token,
      userId: user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const personalKeyId = `p5-personal-${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      id: personalKeyId,
      name: "Synthetic personal key",
      key: `synthetic-hash-${randomUUID()}`,
      userId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(apiKeyExtensionTable).values({
      apikeyId: personalKeyId,
      personId: person.id,
      workspaceId: null,
      isMcp: false,
    });
    for (const action of [
      "auth.password_changed",
      "auth.mfa_enrolled",
    ] as const)
      await appendAuditLog(db, {
        actorId: user.id,
        actorType: "person",
        action,
        entityType: "person",
        entityId: user.id,
      });
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      action: "api_key.created",
      entityType: "api_key",
      entityId: personalKeyId,
      after: { kind: "personal" },
    });
    await db
      .delete(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, personalKeyId));
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: personalKeyId,
      after: { kind: "personal", deleted: true },
    });
    mockAuthenticatedSession(user);
    const { app } = createApp();
    const headers = {
      host: "localhost:1337",
      cookie: `__Host-tdk_agent_session=${token}`,
    };
    const security = await app.request(
      "/api/me/settings/history?section=security",
      {
        headers,
      },
    );
    expect(security.status).toBe(200);
    expect(security.headers.get("cache-control")).toBe("no-store");
    const securityBody = await security.json();
    expect(securityBody).toMatchObject({
      section: "security",
      rows: [
        { actor: "you", changedCategories: ["mfa"] },
        { actor: "you", changedCategories: ["password"] },
      ],
    });
    expect(Object.keys(securityBody.rows[0]).sort()).toEqual([
      "actor",
      "at",
      "changedCategories",
    ]);
    const keys = await app.request("/api/me/settings/history?section=apiKeys", {
      headers,
    });
    expect(keys.status).toBe(200);
    expect(keys.headers.get("cache-control")).toBe("no-store");
    const keyBody = await keys.json();
    expect(keyBody.rows).toHaveLength(2);
    expect(
      keyBody.rows.every(
        (row: { actor: string; changedCategories: string[] }) =>
          row.actor === "you" && row.changedCategories.join() === "personalKey",
      ),
    ).toBe(true);
    expect(Object.keys(keyBody.rows[0]).sort()).toEqual([
      "actor",
      "at",
      "changedCategories",
    ]);
    const customer = await addCustomer(await buildTenant("p5-self-history"));
    const customerToken = `token-${customer.user.id}`;
    await db.insert(schema.sessionTable).values({
      id: `session-${customer.user.id}`,
      token: customerToken,
      userId: customer.user.id,
      portal: "customer",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    for (const action of [
      "auth.password_changed",
      "auth.mfa_enrolled",
    ] as const)
      await appendAuditLog(db, {
        actorId: customer.user.id,
        actorType: "person",
        action,
        entityType: "person",
        entityId: customer.user.id,
      });
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const portal = await app.request(
      "/api/portal/account/settings-history?section=security",
      {
        headers: {
          host: "portal.localhost:5174",
          cookie: `__Host-tdk_portal_session=${customerToken}`,
        },
      },
    );
    expect(portal.status).toBe(200);
    const portalBody = await portal.json();
    expect(portalBody.rows).toHaveLength(1);
    expect(portalBody.rows[0]).toMatchObject({
      actor: "you",
      changedCategories: ["password"],
    });
    expect(Object.keys(portalBody.rows[0]).sort()).toEqual([
      "actor",
      "at",
      "changedCategories",
    ]);
    const portalKeys = await app.request(
      "/api/portal/account/settings-history?section=apiKeys",
      { headers: { host: "portal.localhost:5174" } },
    );
    expect(portalKeys.status).toBe(400);
  });
});
