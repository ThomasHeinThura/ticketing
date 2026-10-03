import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createPendingAction(
  userId: string,
  overrides: Partial<typeof schema.pendingActionTable.$inferInsert> = {},
) {
  const person = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "pending-action requester person",
  );
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.pendingActionTable)
      .values({
        id: `pa-${randomUUID()}`,
        requestedByPersonId: person.id,
        credentialType: "session",
        credentialId: null,
        origin: "web",
        action: "delete",
        targetType: "work_item",
        targetIds: ["wi-1"],
        targetVersions: null,
        payload: { privatePayload: "PRIVATE_PAYLOAD_MARKER" },
        routeKey: "INTERNAL_ROUTE_KEY",
        payloadHash: "a".repeat(64),
        payloadSummary: { target: "WLP-1" },
        workspaceId: null,
        projectId: null,
        organisationId: null,
        confirmationRequired: "click",
        confirmationSupplied: null,
        state: "pending",
        invalidationReason: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        decidedByPersonId: null,
        decisionSessionId: null,
        stepUpTokenId: "PRIVATE_STEP_UP_MARKER",
        executedAt: null,
        error: "PRIVATE_ERROR_MARKER",
        traceId: "PRIVATE_TRACE_MARKER",
        ...overrides,
      })
      .returning(),
    "pending action",
  );
}

async function createPersonFor(
  userId: string,
  organisationId: string,
): Promise<void> {
  await db.insert(schema.personTable).values({
    userId,
    organisationId,
    side: "staff",
  });
}

describe("GET /api/me/pending-actions", () => {
  it("returns only the caller's pending actions with stable pages, a safe DTO, and viewed audits", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    await createPersonFor(user.id, workspace.organisationId);
    await createPersonFor(other.user.id, other.workspace.organisationId);
    const key = requireRow(
      await db
        .insert(schema.apikeyTable)
        .values({
          id: `key-${randomUUID()}`,
          referenceId: user.id,
          userId: user.id,
          name: "ci-bot",
          key: `secret-${randomUUID()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "api key",
    );
    const stamp = new Date("2026-09-01T00:00:00.000Z");
    const older = await createPendingAction(user.id, {
      id: "pa-a",
      targetIds: ["wi-older"],
      createdAt: stamp,
    });
    const newest = await createPendingAction(user.id, {
      id: "pa-c",
      credentialType: "api_key",
      credentialId: key.id,
      origin: "api",
      targetIds: ["wi-newest"],
      createdAt: new Date(stamp.getTime() + 2_000),
    });
    const tied = await createPendingAction(user.id, {
      id: "pa-b",
      targetIds: ["wi-tied"],
      createdAt: stamp,
    });
    const foreign = await createPendingAction(other.user.id, {
      id: "pa-foreign",
    });
    await createPendingAction(user.id, {
      id: "pa-terminal-list",
      targetIds: ["wi-terminal"],
      state: "executed",
    });

    mockAuthenticatedSession(user);
    const { app } = createApp();
    const firstResponse = await app.request("/api/me/pending-actions?limit=2");
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      data: Array<Record<string, unknown>>;
      page: { nextCursor: string | null; hasMore: boolean };
      meta: { total: number };
    };
    expect(first.data.map((item) => item.id)).toEqual([newest.id, tied.id]);
    expect(first.data.map((item) => item.id)).not.toContain("pa-terminal-list");
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toEqual(expect.any(String));
    expect(first.meta.total).toBe(3);
    expect(first.data[0]).toMatchObject({ requestingKeyName: "ci-bot" });
    expect(Object.keys(first.data[0] ?? {}).sort()).toEqual(
      [
        "action",
        "confirmation",
        "createdAt",
        "decidedAt",
        "executedAt",
        "expiresAt",
        "id",
        "invalidationReason",
        "origin",
        "requestingKeyName",
        "state",
        "summary",
        "targetIds",
        "targetType",
      ].sort(),
    );
    const firstJson = JSON.stringify(first);
    for (const marker of [
      "PRIVATE_PAYLOAD_MARKER",
      "INTERNAL_ROUTE_KEY",
      "PRIVATE_STEP_UP_MARKER",
      "PRIVATE_TRACE_MARKER",
      "PRIVATE_ERROR_MARKER",
      key.id,
      foreign.id,
    ]) {
      expect(firstJson).not.toContain(marker);
    }

    const secondResponse = await app.request(
      `/api/me/pending-actions?limit=2&cursor=${encodeURIComponent(first.page.nextCursor ?? "")}`,
    );
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as {
      data: Array<{ id: string }>;
      page: { nextCursor: string | null; hasMore: boolean };
      meta: { total: number };
    };
    expect(second.data.map((item) => item.id)).toEqual([older.id]);
    expect(second.page).toEqual({ nextCursor: null, hasMore: false });
    expect(second.meta.total).toBe(3);

    const viewedRows = await db
      .select({ entityId: schema.auditLogTable.entityId })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.viewed"),
          eq(
            schema.auditLogTable.actorId,
            (
              await db
                .select({ id: schema.personTable.id })
                .from(schema.personTable)
                .where(eq(schema.personTable.userId, user.id))
                .limit(1)
            )[0]?.id ?? "",
          ),
        ),
      );
    expect(viewedRows.map((row) => row.entityId).sort()).toEqual(
      [newest.id, tied.id, older.id].sort(),
    );
  });

  it("rejects an explicitly empty cursor and limits above the collection maximum", async () => {
    const { user, workspace } = await createWorkspaceMember();
    await createPersonFor(user.id, workspace.organisationId);
    mockAuthenticatedSession(user);
    const { app } = createApp();

    expect((await app.request("/api/me/pending-actions?cursor=")).status).toBe(
      400,
    );
    expect(
      (await app.request("/api/me/pending-actions?limit=201")).status,
    ).toBe(400);
  });

  it("returns any own state for polling and hides another requester's id", async () => {
    const owner = await createWorkspaceMember();
    const caller = await createWorkspaceMember();
    await createPersonFor(owner.user.id, owner.workspace.organisationId);
    await createPersonFor(caller.user.id, caller.workspace.organisationId);
    const terminal = await createPendingAction(owner.user.id, {
      id: "pa-terminal",
      state: "executed",
      invalidationReason: null,
      decidedAt: new Date("2026-09-01T00:01:00.000Z"),
      executedAt: new Date("2026-09-01T00:02:00.000Z"),
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const ownResponse = await app.request(
      `/api/me/pending-actions/${terminal.id}`,
      { headers: { "x-request-id": "session-pending-action-read" } },
    );
    expect(ownResponse.status).toBe(200);
    expect(await ownResponse.json()).toMatchObject({
      id: terminal.id,
      state: "executed",
      decidedAt: "2026-09-01T00:01:00.000Z",
      executedAt: "2026-09-01T00:02:00.000Z",
      requestingKeyName: null,
    });

    mockAuthenticatedSession(caller.user);
    const foreignResponse = await app.request(
      `/api/me/pending-actions/${terminal.id}`,
    );
    expect(foreignResponse.status).toBe(404);

    const viewed = await db
      .select({
        actorId: schema.auditLogTable.actorId,
        actorType: schema.auditLogTable.actorType,
        apiKeyId: schema.auditLogTable.apiKeyId,
        traceId: schema.auditLogTable.traceId,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.viewed"),
          eq(schema.auditLogTable.entityId, terminal.id),
        ),
      );
    expect(viewed).toEqual([
      {
        actorId: terminal.requestedByPersonId,
        actorType: "person",
        apiKeyId: null,
        traceId: "session-pending-action-read",
      },
    ]);
  });

  it("attributes API-key list and detail reads to the current key and request trace", async () => {
    const { user, workspace } = await createWorkspaceMember();
    await createPersonFor(user.id, workspace.organisationId);
    const pending = await createPendingAction(user.id, {
      id: "pa-api-key-read",
    });
    const rawKey = `taskdesk_test_${randomUUID()}`;
    const key = requireRow(
      await db
        .insert(schema.apikeyTable)
        .values({
          referenceId: user.id,
          userId: user.id,
          key: hashApiKeyForTest(rawKey),
          name: "read-audit-test-key",
          start: rawKey.slice(0, 12),
          prefix: "taskdesk",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: schema.apikeyTable.id }),
      "API key",
    );
    const person = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, user.id))
        .limit(1),
      "viewing person",
    );
    const { app } = createApp();

    const listResponse = await app.request("/api/me/pending-actions", {
      headers: {
        "x-api-key": rawKey,
        "x-request-id": "api-key-pending-action-list",
      },
    });
    expect(listResponse.status).toBe(200);
    const listJson = await listResponse.text();
    expect(listJson).not.toContain(key.id);
    expect(listJson).not.toContain("apiKeyId");
    expect(listJson).not.toContain("traceId");

    const detailResponse = await app.request(
      `/api/me/pending-actions/${pending.id}`,
      {
        headers: {
          "x-api-key": rawKey,
          "x-request-id": "api-key-pending-action-detail",
        },
      },
    );
    expect(detailResponse.status).toBe(200);
    const detailJson = await detailResponse.text();
    expect(detailJson).not.toContain(key.id);
    expect(detailJson).not.toContain("apiKeyId");
    expect(detailJson).not.toContain("traceId");

    const viewed = await db
      .select({
        actorId: schema.auditLogTable.actorId,
        actorType: schema.auditLogTable.actorType,
        apiKeyId: schema.auditLogTable.apiKeyId,
        traceId: schema.auditLogTable.traceId,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.viewed"),
          eq(schema.auditLogTable.entityId, pending.id),
        ),
      )
      .orderBy(schema.auditLogTable.traceId);
    expect(viewed).toEqual([
      {
        actorId: person.id,
        actorType: "api_key",
        apiKeyId: key.id,
        traceId: "api-key-pending-action-detail",
      },
      {
        actorId: person.id,
        actorType: "api_key",
        apiKeyId: key.id,
        traceId: "api-key-pending-action-list",
      },
    ]);
  });

  it("rejects list and detail reads after a valid API-key owner's identity is revoked", async () => {
    const { app } = createApp();
    const scenarios = ["inactive", "banned"] as const;

    for (const lifecycle of scenarios) {
      const { user, workspace } = await createWorkspaceMember();
      await createPersonFor(user.id, workspace.organisationId);
      const pending = await createPendingAction(user.id, {
        id: `pa-owner-${lifecycle}`,
        payloadSummary: {
          target: `PRIVATE_${lifecycle.toUpperCase()}_SUMMARY`,
        },
      });
      const rawKey = `taskdesk_test_${randomUUID()}`;
      await db.insert(schema.apikeyTable).values({
        referenceId: user.id,
        userId: user.id,
        key: hashApiKeyForTest(rawKey),
        name: `owner-${lifecycle}-key`,
        start: rawKey.slice(0, 12),
        prefix: "taskdesk",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (lifecycle === "inactive") {
        await db
          .update(schema.personTable)
          .set({ active: false })
          .where(eq(schema.personTable.userId, user.id));
      } else {
        await db
          .update(schema.userTable)
          .set({ banned: true })
          .where(eq(schema.userTable.id, user.id));
      }

      const headers = { "x-api-key": rawKey };
      const listResponse = await app.request("/api/me/pending-actions", {
        headers,
      });
      expect(listResponse.status).toBe(401);
      expect(await listResponse.text()).not.toContain(
        `PRIVATE_${lifecycle.toUpperCase()}_SUMMARY`,
      );

      const detailResponse = await app.request(
        `/api/me/pending-actions/${pending.id}`,
        { headers },
      );
      expect(detailResponse.status).toBe(401);
      expect(await detailResponse.text()).not.toContain(
        `PRIVATE_${lifecycle.toUpperCase()}_SUMMARY`,
      );

      const viewed = await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "pending_action.viewed"),
            eq(schema.auditLogTable.entityId, pending.id),
          ),
        );
      expect(viewed).toEqual([]);
    }
  });

  it("does not return a summary when its viewed audit write fails", async () => {
    const { user, workspace } = await createWorkspaceMember();
    await createPersonFor(user.id, workspace.organisationId);
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, user.id));
    const pending = await createPendingAction(user.id, {
      id: "pa-audit-failure",
      payloadSummary: { secret: "SUMMARY_MUST_NOT_ESCAPE" },
    });
    mockAuthenticatedSession(user);
    const { app } = createApp();
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_pending_action_viewed_audit_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'pending_action.viewed' THEN
            RAISE EXCEPTION 'test viewed audit failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_pending_action_viewed_audit_insert
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION fail_pending_action_viewed_audit_insert()
      `),
    );

    try {
      const response = await app.request(
        `/api/me/pending-actions/${pending.id}`,
      );
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("SUMMARY_MUST_NOT_ESCAPE");
      const alerts = await db
        .select({ eventData: schema.notificationTable.eventData })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "audit_write_failed"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.eventData).toMatchObject({
        operation: "pending_action_self_read",
      });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_viewed_audit_insert ON audit_log",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_pending_action_viewed_audit_insert()",
        ),
      );
    }
  });
});
