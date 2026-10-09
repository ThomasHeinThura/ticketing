import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalInstanceAdminGrantBody,
  sha256,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../apps/api/src/utils/seed-internal-organisation";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

function agentRequest(
  app: ReturnType<typeof createApp>["app"],
  input: string,
  init?: RequestInit,
) {
  const request = withConfiguredAgentAuthority(input, init);
  return app.request(request.input, request.init);
}

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
});

async function seedUser(id: string, role: string | null = null) {
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: `User ${id}`,
      email: `${id}@example.test`,
      role,
    })
    .returning();
  if (!user) throw new Error("user fixture was not created");
  return user;
}

async function seedSession(userId: string) {
  const now = new Date();
  const id = `session-${userId}`;
  await db.insert(schema.sessionTable).values({
    id,
    token: `token-${userId}`,
    userId,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createGrantToken(
  app: ReturnType<typeof createApp>["app"],
  targetUserId: string,
) {
  const challengeResponse = await agentRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "instance_admin_grant",
        targetUserId,
      }),
    },
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const [challengeRow] = await db
    .select({
      operationKey: schema.stepUpConfirmationTable.operationKey,
      routeKey: schema.stepUpConfirmationTable.routeKey,
      expectedVersion: schema.stepUpConfirmationTable.expectedVersion,
      bodyHash: schema.stepUpConfirmationTable.bodyHash,
    })
    .from(schema.stepUpConfirmationTable)
    .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
  expect(challengeRow).toMatchObject({
    operationKey: "instance_admin_grant",
    routeKey: "POST /api/instance/users/{id}/grant-admin",
    expectedVersion: 1,
  });
  expect(
    challengeRow?.bodyHash?.equals(
      sha256(canonicalInstanceAdminGrantBody(targetUserId)),
    ),
  ).toBe(true);
  const proofResponse = await agentRequest(app, "/api/me/step-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "operation",
      operation: "instance_admin_grant",
      targetUserId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "password",
      password: "p4-test-password",
    }),
  });
  expect(proofResponse.status).toBe(200);
  return ((await proofResponse.json()) as { token: string }).token;
}

describe("God Mode Users API", () => {
  it("projects legacy deactivation rows through the canonical DTO without rewriting them", async () => {
    const admin = await seedUser("users-legacy-deactivation-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    const [adminPerson] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, admin.id));
    const sessionId = await seedSession(admin.id);
    const intendedTarget = await seedUser("users-legacy-deactivation-target");
    await ensureStaffPersonForUser(intendedTarget.id);
    const [intendedPerson] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, intendedTarget.id));
    const wrongTarget = await seedUser(
      "users-legacy-deactivation-wrong-target",
    );
    await ensureStaffPersonForUser(wrongTarget.id);
    const deniedTarget = await seedUser("users-legacy-deactivation-denied");
    await ensureStaffPersonForUser(deniedTarget.id);
    const [wrongPerson] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, wrongTarget.id));
    const [deniedPerson] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, deniedTarget.id));
    if (!adminPerson || !intendedPerson || !wrongPerson || !deniedPerson)
      throw new Error("legacy migration identities were not created");
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, wrongPerson.id));
    const now = new Date();
    const pendingId = "users-legacy-deactivation-pending";
    const deniedId = "users-legacy-deactivation-denied";
    const terminalId = "users-legacy-deactivation-terminal";
    const legacyPayload = {
      action: "user_deactivation",
      route_key: "POST /api/instance/users/{id}/deactivate",
      target_type: "person",
      target_ids: [intendedPerson.id],
      workspace_id: null,
      project_id: null,
      organisation_id: null,
      confirmation_required: "typed_name_step_up",
    };

    await db.insert(schema.pendingActionTable).values([
      {
        id: pendingId,
        requestedByPersonId: adminPerson.id,
        credentialType: "session",
        credentialId: sessionId,
        origin: "web",
        action: "user_deactivation",
        targetType: "person",
        targetIds: [intendedPerson.id],
        payload: legacyPayload,
        routeKey: legacyPayload.route_key,
        payloadHash: "a".repeat(64),
        payloadSummary: {
          personId: intendedPerson.id,
          email: intendedTarget.email,
        },
        confirmationRequired: "typed_name_step_up",
        state: "pending",
        traceId: "trace-users-legacy-pending",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: deniedId,
        requestedByPersonId: adminPerson.id,
        credentialType: "session",
        credentialId: sessionId,
        origin: "web",
        action: "user_deactivation",
        targetType: "person",
        targetIds: [deniedPerson.id],
        payload: { ...legacyPayload, target_ids: [deniedPerson.id] },
        routeKey: legacyPayload.route_key,
        payloadHash: "c".repeat(64),
        payloadSummary: {
          personId: deniedPerson.id,
          email: deniedTarget.email,
        },
        confirmationRequired: "typed_name_step_up",
        state: "pending",
        traceId: "trace-users-legacy-denied",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: terminalId,
        requestedByPersonId: adminPerson.id,
        credentialType: "session",
        credentialId: sessionId,
        origin: "web",
        action: "user_deactivation",
        targetType: "person",
        targetIds: [wrongPerson.id],
        payload: { ...legacyPayload, target_ids: [wrongPerson.id] },
        routeKey: legacyPayload.route_key,
        payloadHash: "b".repeat(64),
        payloadSummary: { personId: wrongPerson.id, email: wrongTarget.email },
        confirmationRequired: "typed_name_step_up",
        state: "executed",
        decidedByPersonId: adminPerson.id,
        decisionSessionId: sessionId,
        decidedAt: now,
        executedAt: now,
        stepUpTokenId: "users-legacy-deactivation-terminal-step-up",
        traceId: "trace-users-legacy-terminal",
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);
    const preserved = await db
      .select({
        id: schema.pendingActionTable.id,
        action: schema.pendingActionTable.action,
        state: schema.pendingActionTable.state,
        targetIds: schema.pendingActionTable.targetIds,
        payload: schema.pendingActionTable.payload,
        payloadHash: schema.pendingActionTable.payloadHash,
      })
      .from(schema.pendingActionTable)
      .where(
        inArray(schema.pendingActionTable.id, [
          pendingId,
          deniedId,
          terminalId,
        ]),
      );
    expect(preserved).toHaveLength(3);
    expect(preserved.find((row) => row.id === pendingId)).toMatchObject({
      action: "user_deactivation",
      state: "pending",
      targetIds: [intendedPerson.id],
      payload: legacyPayload,
      payloadHash: "a".repeat(64),
    });
    expect(preserved.find((row) => row.id === terminalId)).toMatchObject({
      action: "user_deactivation",
      state: "executed",
      targetIds: [wrongPerson.id],
      payload: { ...legacyPayload, target_ids: [wrongPerson.id] },
      payloadHash: "b".repeat(64),
    });
    expect(preserved.find((row) => row.id === deniedId)).toMatchObject({
      action: "user_deactivation",
      state: "pending",
      targetIds: [deniedPerson.id],
      payload: { ...legacyPayload, target_ids: [deniedPerson.id] },
      payloadHash: "c".repeat(64),
    });

    const legacyToken = createHash("sha256")
      .update("expired-legacy-proof")
      .digest("base64url");
    const deniedToken = createHash("sha256")
      .update("unused-legacy-deny-proof")
      .digest("base64url");
    const terminalToken = createHash("sha256")
      .update("consumed-legacy-proof")
      .digest("base64url");
    await db.insert(schema.stepUpConfirmationTable).values([
      {
        id: "users-legacy-deactivation-step-up",
        personId: adminPerson.id,
        sessionId,
        bindingKind: "pending_action",
        pendingActionId: pendingId,
        challengeNonceHash: createHash("sha256").update("nonce").digest(),
        state: "issued",
        tokenHash: createHash("sha256").update(legacyToken).digest(),
        authMethod: "password",
        authenticatedAt: new Date(now.getTime() - 120_000),
        issuedAt: new Date(now.getTime() - 120_000),
        challengeExpiresAt: new Date(now.getTime() - 120_000),
        tokenExpiresAt: new Date(now.getTime() - 60_000),
      },
      {
        id: "users-legacy-deactivation-terminal-step-up",
        personId: adminPerson.id,
        sessionId,
        bindingKind: "pending_action",
        pendingActionId: terminalId,
        challengeNonceHash: createHash("sha256")
          .update("nonce-terminal")
          .digest(),
        state: "consumed",
        tokenHash: createHash("sha256").update(terminalToken).digest(),
        authMethod: "password",
        authenticatedAt: new Date(now.getTime() - 120_000),
        issuedAt: new Date(now.getTime() - 120_000),
        consumedAt: new Date(now.getTime() - 60_000),
        challengeExpiresAt: new Date(now.getTime() - 120_000),
        tokenExpiresAt: new Date(now.getTime() - 60_000),
      },
      {
        id: "users-legacy-deactivation-deny-step-up",
        personId: adminPerson.id,
        sessionId,
        bindingKind: "pending_action",
        pendingActionId: deniedId,
        challengeNonceHash: createHash("sha256").update("nonce-deny").digest(),
        state: "issued",
        tokenHash: createHash("sha256").update(deniedToken).digest(),
        authMethod: "password",
        authenticatedAt: new Date(now.getTime() - 120_000),
        issuedAt: new Date(now.getTime() - 120_000),
        challengeExpiresAt: new Date(now.getTime() - 120_000),
        tokenExpiresAt: new Date(now.getTime() - 60_000),
      },
    ]);
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const response = await agentRequest(
      app,
      `/api/me/pending-actions/${pendingId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": legacyToken,
        },
        body: JSON.stringify({ typedName: "stale@example.test" }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("pending_action_kind_unsupported");
    const listed = await agentRequest(app, "/api/me/pending-actions");
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(listedBody.data).toContainEqual(
      expect.objectContaining({
        id: pendingId,
        action: "delete",
        targetType: "user",
        targetIds: [intendedTarget.id],
        approvalSupported: false,
        summary: {
          personId: intendedPerson.id,
          userId: intendedTarget.id,
          email: intendedTarget.email,
        },
        state: "pending",
      }),
    );
    expect(listedBody.data).toContainEqual(
      expect.objectContaining({
        id: deniedId,
        action: "delete",
        targetType: "user",
        targetIds: [deniedTarget.id],
        summary: {
          personId: deniedPerson.id,
          userId: deniedTarget.id,
          email: deniedTarget.email,
        },
        state: "pending",
      }),
    );
    const readable = await agentRequest(
      app,
      `/api/me/pending-actions/${pendingId}`,
    );
    expect(readable.status).toBe(200);
    expect(await readable.json()).toMatchObject({
      id: pendingId,
      action: "delete",
      targetType: "user",
      targetIds: [intendedTarget.id],
      approvalSupported: false,
      summary: {
        personId: intendedPerson.id,
        userId: intendedTarget.id,
        email: intendedTarget.email,
      },
      state: "pending",
    });
    const beforeUnresolvedCancel = await db
      .select({
        state: schema.pendingActionTable.state,
        targetIds: schema.pendingActionTable.targetIds,
        payload: schema.pendingActionTable.payload,
        payloadSummary: schema.pendingActionTable.payloadSummary,
        payloadHash: schema.pendingActionTable.payloadHash,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingId));
    const decisionAuditBefore = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, pendingId),
          eq(schema.auditLogTable.action, "pending_action.decided"),
        ),
      );
    const decisionEventsBefore = await db
      .select({ eventId: schema.outboxTable.eventId })
      .from(schema.outboxTable)
      .where(
        and(
          eq(schema.outboxTable.kind, "pending_action.decided"),
          sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${pendingId}`,
        ),
      );
    await db
      .update(schema.pendingActionTable)
      .set({
        targetIds: ["missing-legacy-person"],
        payload: { ...legacyPayload, target_ids: ["missing-legacy-person"] },
        payloadSummary: {
          personId: "missing-legacy-person",
          email: intendedTarget.email,
        },
      })
      .where(eq(schema.pendingActionTable.id, pendingId));
    const unresolvedCancel = await agentRequest(
      app,
      `/api/me/pending-actions/${pendingId}/cancel`,
      { method: "POST" },
    );
    expect(unresolvedCancel.status).toBe(409);
    expect(await unresolvedCancel.text()).toBe("pending_action_target_changed");
    expect(
      await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pendingId)),
    ).toEqual([{ state: "pending" }]);
    expect(
      await db
        .select({ state: schema.stepUpConfirmationTable.state })
        .from(schema.stepUpConfirmationTable)
        .where(
          eq(
            schema.stepUpConfirmationTable.id,
            "users-legacy-deactivation-step-up",
          ),
        ),
    ).toEqual([{ state: "issued" }]);
    expect(
      await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.entityId, pendingId),
            eq(schema.auditLogTable.action, "pending_action.decided"),
          ),
        ),
    ).toEqual(decisionAuditBefore);
    expect(
      await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(
          and(
            eq(schema.outboxTable.kind, "pending_action.decided"),
            sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${pendingId}`,
          ),
        ),
    ).toEqual(decisionEventsBefore);
    await db
      .update(schema.pendingActionTable)
      .set({
        targetIds: [intendedPerson.id],
        payload: legacyPayload,
        payloadSummary: {
          personId: intendedPerson.id,
          email: intendedTarget.email,
        },
      })
      .where(eq(schema.pendingActionTable.id, pendingId));
    expect(
      await db
        .select({
          state: schema.pendingActionTable.state,
          targetIds: schema.pendingActionTable.targetIds,
          payload: schema.pendingActionTable.payload,
          payloadSummary: schema.pendingActionTable.payloadSummary,
          payloadHash: schema.pendingActionTable.payloadHash,
        })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pendingId)),
    ).toEqual(beforeUnresolvedCancel);
    expect(
      await db
        .select({
          userId: schema.personTable.userId,
          active: schema.personTable.active,
        })
        .from(schema.personTable)
        .where(
          inArray(schema.personTable.userId, [
            intendedTarget.id,
            wrongTarget.id,
          ]),
        )
        .orderBy(schema.personTable.userId),
    ).toEqual([
      { userId: intendedTarget.id, active: true },
      { userId: wrongTarget.id, active: false },
    ]);
    expect(
      await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pendingId)),
    ).toEqual([{ state: "pending" }]);
    expect(
      await db
        .select({ state: schema.stepUpConfirmationTable.state })
        .from(schema.stepUpConfirmationTable)
        .where(
          eq(
            schema.stepUpConfirmationTable.id,
            "users-legacy-deactivation-step-up",
          ),
        ),
    ).toEqual([{ state: "issued" }]);
    expect(
      await db
        .select({ state: schema.stepUpConfirmationTable.state })
        .from(schema.stepUpConfirmationTable)
        .where(
          eq(
            schema.stepUpConfirmationTable.id,
            "users-legacy-deactivation-terminal-step-up",
          ),
        ),
    ).toEqual([{ state: "consumed" }]);
    const cancelled = await agentRequest(
      app,
      `/api/me/pending-actions/${pendingId}/cancel`,
      { method: "POST" },
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      id: pendingId,
      action: "delete",
      targetType: "user",
      targetIds: [intendedTarget.id],
      approvalSupported: false,
      summary: {
        personId: intendedPerson.id,
        userId: intendedTarget.id,
        email: intendedTarget.email,
      },
      state: "cancelled",
    });
    expect(
      await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pendingId)),
    ).toEqual([{ state: "cancelled" }]);
    expect(
      await db
        .select({ state: schema.stepUpConfirmationTable.state })
        .from(schema.stepUpConfirmationTable)
        .where(
          eq(
            schema.stepUpConfirmationTable.id,
            "users-legacy-deactivation-step-up",
          ),
        ),
    ).toEqual([{ state: "issued" }]);
    expect(
      await db
        .select({
          action: schema.pendingActionTable.action,
          targetType: schema.pendingActionTable.targetType,
          targetIds: schema.pendingActionTable.targetIds,
          payload: schema.pendingActionTable.payload,
          payloadHash: schema.pendingActionTable.payloadHash,
        })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pendingId)),
    ).toEqual([
      {
        action: "user_deactivation",
        targetType: "person",
        targetIds: [intendedPerson.id],
        payload: legacyPayload,
        payloadHash: "a".repeat(64),
      },
    ]);
    const beforeUnresolvedDeny = await db
      .select({
        state: schema.pendingActionTable.state,
        targetIds: schema.pendingActionTable.targetIds,
        payload: schema.pendingActionTable.payload,
        payloadSummary: schema.pendingActionTable.payloadSummary,
        payloadHash: schema.pendingActionTable.payloadHash,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, deniedId));
    const deniedAuditBefore = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, deniedId),
          eq(schema.auditLogTable.action, "pending_action.decided"),
        ),
      );
    const deniedEventsBefore = await db
      .select({ eventId: schema.outboxTable.eventId })
      .from(schema.outboxTable)
      .where(
        and(
          eq(schema.outboxTable.kind, "pending_action.decided"),
          sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${deniedId}`,
        ),
      );
    await db
      .update(schema.pendingActionTable)
      .set({
        targetIds: ["missing-legacy-person-for-deny"],
        payload: {
          ...legacyPayload,
          target_ids: ["missing-legacy-person-for-deny"],
        },
        payloadSummary: {
          personId: "missing-legacy-person-for-deny",
          email: deniedTarget.email,
        },
      })
      .where(eq(schema.pendingActionTable.id, deniedId));
    const unresolvedDeny = await agentRequest(
      app,
      `/api/me/pending-actions/${deniedId}/deny`,
      { method: "POST" },
    );
    expect(unresolvedDeny.status).toBe(409);
    expect(await unresolvedDeny.text()).toBe("pending_action_target_changed");
    expect(
      await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, deniedId)),
    ).toEqual([{ state: "pending" }]);
    expect(
      await db
        .select({ state: schema.stepUpConfirmationTable.state })
        .from(schema.stepUpConfirmationTable)
        .where(
          eq(
            schema.stepUpConfirmationTable.id,
            "users-legacy-deactivation-deny-step-up",
          ),
        ),
    ).toEqual([{ state: "issued" }]);
    expect(
      await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.entityId, deniedId),
            eq(schema.auditLogTable.action, "pending_action.decided"),
          ),
        ),
    ).toEqual(deniedAuditBefore);
    expect(
      await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(
          and(
            eq(schema.outboxTable.kind, "pending_action.decided"),
            sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${deniedId}`,
          ),
        ),
    ).toEqual(deniedEventsBefore);
    await db
      .update(schema.pendingActionTable)
      .set({
        targetIds: [deniedPerson.id],
        payload: { ...legacyPayload, target_ids: [deniedPerson.id] },
        payloadSummary: {
          personId: deniedPerson.id,
          email: deniedTarget.email,
        },
      })
      .where(eq(schema.pendingActionTable.id, deniedId));
    expect(
      await db
        .select({
          state: schema.pendingActionTable.state,
          targetIds: schema.pendingActionTable.targetIds,
          payload: schema.pendingActionTable.payload,
          payloadSummary: schema.pendingActionTable.payloadSummary,
          payloadHash: schema.pendingActionTable.payloadHash,
        })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, deniedId)),
    ).toEqual(beforeUnresolvedDeny);
    const denied = await agentRequest(
      app,
      `/api/me/pending-actions/${deniedId}/deny`,
      { method: "POST" },
    );
    expect(denied.status).toBe(200);
    expect(await denied.json()).toMatchObject({
      id: deniedId,
      action: "delete",
      targetType: "user",
      targetIds: [deniedTarget.id],
      summary: {
        personId: deniedPerson.id,
        userId: deniedTarget.id,
        email: deniedTarget.email,
      },
      state: "denied",
    });
    expect(
      await db
        .select({
          action: schema.pendingActionTable.action,
          targetType: schema.pendingActionTable.targetType,
        })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, deniedId)),
    ).toEqual([{ action: "user_deactivation", targetType: "person" }]);
    expect(
      await db
        .select({ state: schema.stepUpConfirmationTable.state })
        .from(schema.stepUpConfirmationTable)
        .where(
          eq(
            schema.stepUpConfirmationTable.id,
            "users-legacy-deactivation-deny-step-up",
          ),
        ),
    ).toEqual([{ state: "issued" }]);
  });

  it("returns an allowlisted stable cursor directory and refuses a cursor under changed filters", async () => {
    const admin = await seedUser("users-directory-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    await seedUser("users-directory-a");
    await seedUser("users-directory-b");
    const { app } = createApp();

    const first = await agentRequest(
      app,
      "/api/instance/users?limit=1&q=directory",
    );
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as {
      data: Array<Record<string, unknown>>;
      page: { nextCursor: string | null; hasMore: boolean };
    };
    expect(page1.data).toHaveLength(1);
    expect(page1.page.hasMore).toBe(true);
    expect(page1.page.nextCursor).toBeTruthy();
    const nextCursor = page1.page.nextCursor;
    if (!nextCursor) throw new Error("Expected another page");
    expect(Object.keys(page1.data[0] ?? {}).sort()).toEqual([
      "createdAt",
      "email",
      "emailVerified",
      "id",
      "isInstanceAdmin",
      "isSuspended",
      "locale",
      "name",
      "person",
      "suspensionExpiresAt",
      "twoFactorEnabled",
    ]);
    const second = await agentRequest(
      app,
      `/api/instance/users?limit=1&q=directory&cursor=${encodeURIComponent(nextCursor)}`,
    );
    expect(second.status).toBe(200);
    const page2 = (await second.json()) as { data: Array<{ id: string }> };
    expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);
    const changed = await agentRequest(
      app,
      `/api/instance/users?limit=1&q=other&cursor=${encodeURIComponent(nextCursor)}`,
    );
    expect(changed.status).toBe(400);
  });

  it("suspends with a bounded reason, revokes sessions and native keys, and never exposes the reason", async () => {
    const admin = await seedUser("users-suspend-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    const target = await seedUser("users-suspend-target");
    await seedSession(target.id);
    await db.insert(schema.apikeyTable).values({
      id: "users-suspend-key",
      referenceId: target.id,
      userId: target.id,
      key: createHash("sha256").update("fixture-key").digest("base64url"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = createApp();
    const oversizedReason = await agentRequest(
      app,
      `/api/instance/users/${target.id}/suspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "😀".repeat(501) }),
      },
    );
    expect(oversizedReason.status).toBe(400);
    const expired = await agentRequest(
      app,
      `/api/instance/users/${target.id}/suspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      },
    );
    expect(expired.status).toBe(400);
    expect(
      (
        await db
          .select({ banned: schema.userTable.banned })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.banned,
    ).toBe(false);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, target.id)),
    ).toHaveLength(1);
    const response = await agentRequest(
      app,
      `/api/instance/users/${target.id}/suspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "  security investigation  ",
          expiresAt: null,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suspended: true, expiresAt: null });
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, target.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.apikeyTable.id })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, target.id)),
    ).toHaveLength(0);
    const [stored] = await db
      .select({
        banned: schema.userTable.banned,
        banReason: schema.userTable.banReason,
        banExpires: schema.userTable.banExpires,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, target.id));
    expect(stored).toEqual({
      banned: true,
      banReason: "security investigation",
      banExpires: null,
    });
    const detail = await agentRequest(app, `/api/instance/users/${target.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.text()).not.toContain("security investigation");
    const [audit] = await db
      .select({
        action: schema.auditLogTable.action,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.user_suspended"));
    expect(audit?.after).toEqual({
      outcome: "suspended",
      finiteExpiry: false,
      revokedSessions: 1,
    });
  });

  it("unsuspends without restoring credentials and sign-out leaves API keys unchanged", async () => {
    const admin = await seedUser("users-session-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    const target = await seedUser("users-session-target");
    const originalSession = await seedSession(target.id);
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: "users-session-key",
      referenceId: target.id,
      userId: target.id,
      key: createHash("sha256").update("fixture-key2").digest("base64url"),
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.userTable)
      .set({
        banned: true,
        banReason: "expired reason",
        banExpires: new Date(now.getTime() - 1000),
      })
      .where(eq(schema.userTable.id, target.id));
    const { app } = createApp();
    const unsuspend = await agentRequest(
      app,
      `/api/instance/users/${target.id}/unsuspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(unsuspend.status).toBe(200);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, target.id)),
    ).toHaveLength(1);
    const signOut = await agentRequest(
      app,
      `/api/instance/users/${target.id}/sign-out`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(signOut.status).toBe(200);
    expect(await signOut.json()).toEqual({ revokedSessions: 1 });
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, originalSession)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.apikeyTable.id })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, target.id)),
    ).toHaveLength(1);
  });

  it("grants administrator with target/body/session-bound one-use proof and commits alerts atomically", async () => {
    const admin = await seedUser("users-grant-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    const actorSessionId = await seedSession(admin.id);
    await db.insert(schema.accountTable).values({
      id: "users-grant-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("p4-test-password", 4),
    });
    const target = await seedUser("users-grant-target");
    await ensureStaffPersonForUser(target.id);
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const token = await createGrantToken(app, target.id);
    const wrongTarget = await agentRequest(
      app,
      `/api/instance/users/${admin.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(wrongTarget.status).toBe(403);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBeNull();
    const grant = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(grant.status).toBe(200);
    expect(await grant.json()).toEqual({ outcome: "granted" });
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("admin");
    expect(
      await db
        .select({ side: schema.personTable.side })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, target.id)),
    ).toEqual([{ side: "staff" }]);
    expect(
      await db
        .select({ userId: schema.notificationTable.userId })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "security_alert")),
    ).toHaveLength(2);
    const replay = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(replay.status).toBe(403);
    expect(actorSessionId).toBe(`session-${admin.id}`);
  });

  it("refuses an admin grant if first-run setup is no longer complete", async () => {
    const admin = await seedUser("users-grant-setup-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    await seedSession(admin.id);
    await db.insert(schema.accountTable).values({
      id: "users-grant-setup-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("p4-test-password", 4),
    });
    const target = await seedUser("users-grant-setup-target");
    await ensureStaffPersonForUser(target.id);
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const token = await createGrantToken(app, target.id);
    await db
      .update(schema.instanceSettingTable)
      .set({ setupCompletedAt: null })
      .where(eq(schema.instanceSettingTable.id, "singleton"));

    const response = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Instance setup is incomplete");
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBeNull();
    expect(
      await db
        .select({ id: schema.notificationTable.id })
        .from(schema.notificationTable),
    ).toHaveLength(0);
  });

  it("rejects grants to unlinked and customer targets without changing authority", async () => {
    const admin = await seedUser("users-grant-negative-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    await seedSession(admin.id);
    await db.insert(schema.accountTable).values({
      id: "users-grant-negative-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("p4-test-password", 4),
    });
    const unlinkedTarget = await seedUser("users-grant-unlinked-target");
    const { app } = createApp();
    const unlinkedToken = await createGrantToken(app, unlinkedTarget.id);
    const unlinkedResult = await agentRequest(
      app,
      `/api/instance/users/${unlinkedTarget.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": unlinkedToken,
        },
        body: "{}",
      },
    );
    expect(unlinkedResult.status).toBe(409);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, unlinkedTarget.id))
      )[0]?.role,
    ).toBeNull();

    const target = await seedUser("users-grant-negative-target");
    const internalOrganisation = await ensureInternalOrganisation();
    await db.insert(schema.personTable).values({
      id: "users-grant-negative-person",
      userId: target.id,
      side: "customer",
      organisationId: internalOrganisation.id,
      active: true,
      isPlaceholder: false,
    });
    const token = await createGrantToken(app, target.id);
    const result = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(result.status).toBe(409);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBeNull();
  });

  it("executes deactivation only after current-email confirmation and action-bound step-up", async () => {
    const admin = await seedUser("users-deactivate-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    const adminSession = await seedSession(admin.id);
    await db.insert(schema.accountTable).values({
      id: "users-deactivate-admin-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("p4-test-password", 4),
    });
    const target = await seedUser("users-deactivate-target");
    await ensureStaffPersonForUser(target.id);
    const targetSession = await seedSession(target.id);
    const keyMaterial = "users-deactivate-native-key";
    await db.insert(schema.apikeyTable).values({
      id: "users-deactivate-api-key",
      referenceId: target.id,
      userId: target.id,
      key: createHash("sha256").update(keyMaterial).digest("base64url"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const request = await agentRequest(
      app,
      `/api/instance/users/${target.id}/deactivate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(request.status).toBe(202);
    const pending = (await request.json()) as {
      pendingActionId: string;
      action: string;
      summary: { personId: string; email: string };
      confirmation: string;
    };
    expect(pending.action).toBe("delete");
    expect(pending.confirmation).toBe("typed_name_step_up");
    const publicPending = await agentRequest(
      app,
      `/api/me/pending-actions/${pending.pendingActionId}`,
    );
    expect(publicPending.status).toBe(200);
    expect(await publicPending.json()).toMatchObject({
      action: "delete",
      targetType: "user",
      approvalSupported: true,
      state: "pending",
    });
    const [storedAction] = await db
      .select({
        action: schema.pendingActionTable.action,
        targetType: schema.pendingActionTable.targetType,
        targetIds: schema.pendingActionTable.targetIds,
        payload: schema.pendingActionTable.payload,
        payloadHash: schema.pendingActionTable.payloadHash,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(storedAction).toMatchObject({
      action: "delete",
      targetType: "user",
      targetIds: [target.id],
      payload: {
        action: "delete",
        target_type: "user",
        target_ids: [target.id],
        confirmation_required: "typed_name_step_up",
      },
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(pending.summary).toMatchObject({
      personId: expect.any(String),
      email: target.email,
    });
    expect(
      await db
        .select({ active: schema.personTable.active })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, target.id)),
    ).toEqual([{ active: true }]);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, targetSession)),
    ).toHaveLength(1);

    const challengeResponse = await agentRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "pending_action",
          pendingActionId: pending.pendingActionId,
        }),
      },
    );
    expect(challengeResponse.status).toBe(200);
    const challenge = (await challengeResponse.json()) as {
      challengeId: string;
      nonce: string;
    };
    const challengeRow = await db
      .select({
        bindingKind: schema.stepUpConfirmationTable.bindingKind,
        pendingActionId: schema.stepUpConfirmationTable.pendingActionId,
        operationKey: schema.stepUpConfirmationTable.operationKey,
        routeKey: schema.stepUpConfirmationTable.routeKey,
      })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
    expect(challengeRow).toEqual([
      {
        bindingKind: "pending_action",
        pendingActionId: pending.pendingActionId,
        operationKey: null,
        routeKey: null,
      },
    ]);
    const proofResponse = await agentRequest(app, "/api/me/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "pending_action",
        pendingActionId: pending.pendingActionId,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        method: "password",
        password: "p4-test-password",
      }),
    });
    expect(proofResponse.status).toBe(200);
    const { token } = (await proofResponse.json()) as { token: string };

    const mismatch = await agentRequest(
      app,
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ typedName: "wrong@example.test" }),
      },
    );
    expect(mismatch.status).toBe(400);
    expect(
      await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pending.pendingActionId)),
    ).toEqual([{ state: "pending" }]);

    const approved = await agentRequest(
      app,
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ typedName: target.email }),
      },
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({
      id: pending.pendingActionId,
      state: "executed",
    });
    expect(
      await db
        .select({ active: schema.personTable.active })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, target.id)),
    ).toEqual([{ active: false }]);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, targetSession)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ enabled: schema.apikeyTable.enabled })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, "users-deactivate-api-key")),
    ).toEqual([{ enabled: false }]);
    expect(
      await db
        .select({ action: schema.auditLogTable.action })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityId, pending.pendingActionId)),
    ).toEqual(
      expect.arrayContaining([
        { action: "pending_action.decided" },
        { action: "pending_action.executed" },
        { action: "auth.step_up_issued" },
      ]),
    );
    expect(
      await db
        .select({
          kind: schema.outboxTable.kind,
          workspaceId: schema.outboxTable.workspaceId,
        })
        .from(schema.outboxTable)
        .where(
          inArray(schema.outboxTable.kind, [
            "pending_action.requested",
            "pending_action.decided",
            "pending_action.executed",
            "identity.deprovisioned",
          ]),
        ),
    ).toEqual([
      { kind: "pending_action.requested", workspaceId: null },
      { kind: "pending_action.decided", workspaceId: null },
      { kind: "pending_action.executed", workspaceId: null },
      { kind: "identity.deprovisioned", workspaceId: null },
    ]);
    // Workspace consumers select by workspace_id. SQL equality does not match
    // NULL, so these instance lifecycle events cannot enter a workspace feed.
    expect(
      await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.workspaceId, "workspace-consumer-1")),
    ).toEqual([]);
    await expect(
      db.insert(schema.outboxTable).values({
        eventId: "instance-event-with-organisation-scope",
        kind: "pending_action.requested",
        payload: {},
        dedupeKey: null,
        workspaceId: null,
        organisationId: "org-out-of-scope",
        state: "pending",
        attempts: 0,
        lastError: null,
      }),
    ).rejects.toThrow();
    expect(adminSession).toBe(`session-${admin.id}`);
  });
});
