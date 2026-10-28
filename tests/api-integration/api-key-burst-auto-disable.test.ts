import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consumeApiKeyRateLimit } from "../../apps/api/src/api-key/rate-limit-store";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  apiKeyExtensionTable,
  apiKeyRateLimitCounterTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { listVisibleNotificationRows } from "../../apps/api/src/notification/inbox.repository";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const NOTIFICATION_FAIL_FUNCTION = "td_api_key_burst_notification_fail";

async function armNotificationFailure() {
  await db.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION ${NOTIFICATION_FAIL_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        IF NEW.kind = 'api_key.auto_disabled' THEN
          RAISE EXCEPTION 'api-key burst notification probe';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${NOTIFICATION_FAIL_FUNCTION}
      BEFORE INSERT ON "notification"
      FOR EACH ROW EXECUTE FUNCTION ${NOTIFICATION_FAIL_FUNCTION}();
    `),
  );
}

async function disarmNotificationFailure() {
  await db.execute(
    sql.raw(
      `DROP TRIGGER IF EXISTS ${NOTIFICATION_FAIL_FUNCTION} ON "notification"`,
    ),
  );
  await db.execute(
    sql.raw(`DROP FUNCTION IF EXISTS ${NOTIFICATION_FAIL_FUNCTION}()`),
  );
}

async function makeMcpKey() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const key = await createPersonalApiKey(
    { userId: owner.user.id },
    {
      name: "MCP burst test key",
      isMcp: true,
      rateLimitPerMinute: 20,
    },
  );
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id))
      .limit(1),
    "MCP key owner person",
  );
  return { owner, key, person };
}

async function insertKeyBoundPendingAction(input: {
  keyId: string;
  personId: string;
  workspaceId: string;
  organisationId: string;
}) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.pendingActionTable)
      .values({
        id: `pa-${randomUUID()}`,
        requestedByPersonId: input.personId,
        credentialType: "api_key",
        credentialId: input.keyId,
        origin: "mcp",
        action: "mcp_destructive",
        targetType: "work_item",
        targetIds: [`WI-${randomUUID()}`],
        targetVersions: null,
        payload: { action: "delete" },
        routeKey: "DELETE /api/work-items/{key}",
        payloadHash: "a".repeat(64),
        payloadSummary: { key: "redacted" },
        workspaceId: input.workspaceId,
        projectId: null,
        organisationId: input.organisationId,
        confirmationRequired: "click",
        state: "pending",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        traceId: `trace-${randomUUID()}`,
      })
      .returning(),
    "MCP key-bound pending action",
  );
}

async function setThreshold(threshold: number, writeCeiling = 1) {
  await db
    .insert(schema.instanceSettingTable)
    .values({
      id: "singleton",
      setupCompletedAt: new Date(),
      mcpWriteCeilingPerMinute: writeCeiling,
      apiKeyBurstThreshold: threshold,
    })
    .onConflictDoUpdate({
      target: schema.instanceSettingTable.id,
      set: {
        mcpWriteCeilingPerMinute: writeCeiling,
        apiKeyBurstThreshold: threshold,
      },
    });
}

async function counter(keyId: string, bucket: string) {
  const [row] = await db
    .select()
    .from(apiKeyRateLimitCounterTable)
    .where(
      and(
        eq(apiKeyRateLimitCounterTable.apiKeyId, keyId),
        eq(apiKeyRateLimitCounterTable.bucket, bucket),
      ),
    );
  return row;
}

beforeEach(async () => {
  await resetTestDatabase();
  await disarmNotificationFailure();
});

afterEach(async () => {
  await disarmNotificationFailure();
});

describe("MCP API-key burst auto-disable (MC-22)", () => {
  it("counts rate-limited writes, invalidates key-bound actions, and notifies only the owner", async () => {
    const { owner, key, person } = await makeMcpKey();
    const pending = await insertKeyBoundPendingAction({
      keyId: key.id,
      personId: person.id,
      workspaceId: owner.workspace.id,
      organisationId: owner.workspace.organisationId,
    });
    await setThreshold(2, 1);
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: "feature.mcp", enabled: true })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: true },
      });

    const outsider = await createWorkspaceMember({ role: "admin" });
    const { app } = createApp();
    const request = () =>
      app.request("/api/work-items/bulk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key.key,
        },
        body: "{}",
      });
    mockAnonymousSession();

    expect((await request()).status).not.toBe(429);
    const refused = await request();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await counter(key.id, "mcp_burst"))?.requestCount).toBe(2);
    expect((await counter(key.id, "total"))?.requestCount).toBe(1);
    expect((await counter(key.id, "mcp_write"))?.requestCount).toBe(1);
    expect((await counter(key.id, "mcp_bulk"))?.requestCount).toBe(1);

    const crossed = await request();
    expect(crossed.status).toBe(401);
    expect((await counter(key.id, "mcp_burst"))?.requestCount).toBe(3);
    expect((await counter(key.id, "total"))?.requestCount).toBe(1);
    expect((await counter(key.id, "mcp_write"))?.requestCount).toBe(1);
    expect((await counter(key.id, "mcp_bulk"))?.requestCount).toBe(1);

    const [baseKey] = await db
      .select()
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, key.id));
    const [extension] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(baseKey?.enabled).toBe(false);
    expect(extension?.disabledReason).toBe("mcp_burst_threshold_exceeded");
    expect(extension?.disabledAt).not.toBeNull();

    const [action] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.id));
    expect(action).toMatchObject({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });

    const disabledEvents = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "api_key.auto_disabled"));
    expect(disabledEvents).toHaveLength(1);
    expect(disabledEvents[0]?.payload).toMatchObject({
      kind: "api_key.auto_disabled",
      payload: {
        key: key.id,
        apiKeyId: key.id,
        reason: "mcp_burst_threshold_exceeded",
      },
    });
    expect(JSON.stringify(disabledEvents[0]?.payload)).not.toContain(key.key);

    mockAuthenticatedSession(owner.user);
    const ownerResponse = await app.request("/api/notification");
    expect(ownerResponse.status).toBe(200);
    const ownerInbox = (await ownerResponse.json()) as Array<{
      kind: string | null;
      resourceId: string | null;
      deepLink: { type: string; id: string } | null;
    }>;
    expect(
      ownerInbox.filter(
        (notification) =>
          notification.kind === "api_key.auto_disabled" &&
          notification.resourceId === key.id,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "api_key.auto_disabled",
        resourceId: key.id,
        deepLink: { type: "api_key", id: key.id },
      }),
    ]);

    mockAuthenticatedSession(outsider.user);
    const outsiderResponse = await app.request("/api/notification");
    expect(outsiderResponse.status).toBe(200);
    const outsiderApiKeyNotifications = (
      (await outsiderResponse.json()) as Array<{
        kind: string | null;
        resourceId: string | null;
      }>
    ).filter(
      (notification) =>
        notification.kind === "api_key.auto_disabled" &&
        notification.resourceId === key.id,
    );
    expect(outsiderApiKeyNotifications).toHaveLength(0);

    const outsiderInbox = await listVisibleNotificationRows({
      userId: outsider.user.id,
      credentialCanReadTask: false,
    });
    expect(
      outsiderInbox.some(
        ({ notification }) => notification.resourceId === key.id,
      ),
    ).toBe(false);
  });

  it("serializes concurrent crossings and writes one disable event", async () => {
    const { key } = await makeMcpKey();
    const input = {
      apiKeyId: key.id,
      isMcp: true,
      keyLimitPerMinute: 100,
      mcpWriteCeilingPerMinute: 100,
      apiKeyBurstThreshold: 1,
      requestClass: "write" as const,
    };

    expect((await consumeApiKeyRateLimit(input)).allowed).toBe(true);
    const crossings = await Promise.all(
      Array.from({ length: 8 }, () => consumeApiKeyRateLimit(input)),
    );
    expect(
      crossings.filter((result) => !result.allowed && "disabled" in result),
    ).toHaveLength(8);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "api_key.auto_disabled")),
    ).toHaveLength(1);
  });

  it("rolls back the burst count, key disable, pending-action changes, outbox, and inbox together", async () => {
    const { owner, key, person } = await makeMcpKey();
    const pending = await insertKeyBoundPendingAction({
      keyId: key.id,
      personId: person.id,
      workspaceId: owner.workspace.id,
      organisationId: owner.workspace.organisationId,
    });
    const input = {
      apiKeyId: key.id,
      isMcp: true,
      keyLimitPerMinute: 100,
      mcpWriteCeilingPerMinute: 100,
      apiKeyBurstThreshold: 1,
      requestClass: "write" as const,
    };
    expect((await consumeApiKeyRateLimit(input)).allowed).toBe(true);
    await armNotificationFailure();

    await expect(consumeApiKeyRateLimit(input)).rejects.toThrow();
    expect((await counter(key.id, "mcp_burst"))?.requestCount).toBe(1);
    const [baseKey] = await db
      .select()
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, key.id));
    expect(baseKey?.enabled).toBe(true);
    const [action] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.id));
    expect(action?.state).toBe("pending");
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "api_key.auto_disabled")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.kind, "api_key.auto_disabled")),
    ).toHaveLength(0);
  });
});
