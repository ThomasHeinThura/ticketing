import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, desc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  auth,
  portalAuth,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const TEST_PASSWORD = "credential-revocation-fixture-password";
let signInCounter = 0;

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

async function setupCredentialOwner(app: ReturnType<typeof createApp>["app"]) {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `account-${randomUUID()}`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(TEST_PASSWORD, 4),
  });
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(++signInCounter % 250) + 1}`,
    },
    body: JSON.stringify({ email: user.email, password: TEST_PASSWORD }),
  });
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1),
    "credential revocation requester",
  );
  const session = requireRow(
    await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id))
      .orderBy(desc(schema.sessionTable.createdAt))
      .limit(1),
    "credential revocation session",
  );
  return {
    user,
    workspace,
    person,
    session,
    cookie: cookie as string,
  };
}

async function insertPendingAction(input: {
  requesterPersonId: string;
  workspaceId: string;
  organisationId: string;
  credentialType: "session" | "api_key";
  credentialId: string;
}) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.pendingActionTable)
      .values({
        id: `pa-${randomUUID()}`,
        requestedByPersonId: input.requesterPersonId,
        credentialType: input.credentialType,
        credentialId: input.credentialId,
        origin: "web",
        action: "delete",
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
    "credential-bound pending action",
  );
}

async function insertApiKey(userId: string) {
  return requireRow(
    await db
      .insert(schema.apikeyTable)
      .values({
        referenceId: userId,
        userId,
        key: `hash-${randomUUID()}`,
        name: "credential revocation fixture",
        start: "taskdesk_test",
        prefix: "taskdesk",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.apikeyTable.id }),
    "credential-bound API key",
  );
}

async function stateOf(id: string) {
  return requireRow(
    await db
      .select({
        state: schema.pendingActionTable.state,
        invalidationReason: schema.pendingActionTable.invalidationReason,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, id)),
    "pending-action state",
  );
}

async function decisionRows(id: string) {
  const events = await db
    .select({
      id: schema.outboxTable.eventId,
      workspaceId: schema.outboxTable.workspaceId,
      organisationId: schema.outboxTable.organisationId,
      payload: schema.outboxTable.payload,
    })
    .from(schema.outboxTable)
    .where(
      and(
        eq(schema.outboxTable.kind, "pending_action.decided"),
        sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${id}`,
      ),
    );
  const audits = await db
    .select({
      id: schema.auditLogTable.id,
      traceId: schema.auditLogTable.traceId,
      workspaceId: schema.auditLogTable.workspaceId,
      organisationId: schema.auditLogTable.organisationId,
      entityId: schema.auditLogTable.entityId,
      after: schema.auditLogTable.after,
    })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "pending_action.decided"),
        eq(schema.auditLogTable.entityId, id),
      ),
    );
  return { events, audits };
}

function expectPersistedInvalidation(
  decisions: Awaited<ReturnType<typeof decisionRows>>,
  pending: Awaited<ReturnType<typeof insertPendingAction>>,
  workspaceId: string,
) {
  expect(decisions.events).toHaveLength(1);
  expect(decisions.events[0]).toMatchObject({
    workspaceId,
    organisationId: pending.organisationId,
    payload: {
      payload: {
        pendingActionId: pending.id,
        outcome: "invalidated",
        invalidationReason: "credential_revoked",
      },
    },
  });
  expect(decisions.audits).toHaveLength(1);
  expect(decisions.audits[0]).toMatchObject({
    traceId: pending.traceId,
    workspaceId,
    organisationId: pending.organisationId,
    entityId: pending.id,
    after: {
      state: "invalidated",
      invalidationReason: "credential_revoked",
    },
  });
}

describe("PA-9 explicit credential revocation", () => {
  it("invalidates a key-bound request on direct server API-key deletion", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const key = await insertApiKey(setup.user.id);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "api_key",
      credentialId: key.id,
    });

    const response = await auth.api.deleteApiKey({
      headers: new Headers({ cookie: setup.cookie }),
      body: { keyId: key.id },
    });

    expect(response.success).toBe(true);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
  });

  it("invalidates a session-bound request on direct server sign-out", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });

    const response = await auth.api.signOut({
      headers: new Headers({ cookie: setup.cookie }),
    });

    expect(response.success).toBe(true);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
  });

  it("invalidates the exact session on a direct server revokeSession call", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });

    const response = await auth.api.revokeSession({
      headers: new Headers({ cookie: setup.cookie }),
      body: { token: setup.session.token },
    });

    expect(response.status).toBe(true);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
  });

  it("invalidates sessions on a direct server revokeSessions call", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });

    const response = await auth.api.revokeSessions({
      headers: new Headers({ cookie: setup.cookie }),
    });

    expect(response.status).toBe(true);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
  });

  it("invalidates other sessions on a direct server revokeOtherSessions call", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const other = requireRow(
      await db
        .insert(schema.sessionTable)
        .values({
          id: `session-${randomUUID()}`,
          token: `token-${randomUUID()}`,
          userId: setup.user.id,
          portal: "agent",
          expiresAt: new Date(Date.now() + 60 * 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "other direct-revocation session",
    );
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: other.id,
    });

    const response = await auth.api.revokeOtherSessions({
      headers: new Headers({ cookie: setup.cookie }),
    });

    expect(response.status).toBe(true);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, setup.session.id)),
    ).toHaveLength(1);
  });

  it("invalidates deleted originals during direct changePassword revocation", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const other = requireRow(
      await db
        .insert(schema.sessionTable)
        .values({
          id: `session-${randomUUID()}`,
          token: `token-${randomUUID()}`,
          userId: setup.user.id,
          portal: "agent",
          expiresAt: new Date(Date.now() + 60 * 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "other change-password session",
    );
    const currentPending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const otherPending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: other.id,
    });

    const response = await auth.api.changePassword({
      headers: new Headers({ cookie: setup.cookie }),
      body: {
        currentPassword: TEST_PASSWORD,
        newPassword: "ChangedValidPassword-42!",
        revokeOtherSessions: true,
      },
    });

    expect(response.user.id).toBe(setup.user.id);
    expect(await stateOf(currentPending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expect(await stateOf(otherPending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(currentPending.id),
      currentPending,
      setup.workspace.id,
    );
    expectPersistedInvalidation(
      await decisionRows(otherPending.id),
      otherPending,
      setup.workspace.id,
    );
  });

  it("invalidates originals through the configured HTTP change-password path", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const response = await csrfRequest(
      app,
      "/api/auth/change-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: "ChangedValidPassword-42!",
          revokeOtherSessions: true,
        }),
      },
      setup.cookie,
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
  });

  it("applies the credential wrapper to both portals after auth runtime refresh", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const agentPending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    expect(await reloadAuthConfiguration()).toBe(true);
    const agentSignOut = await auth.api.signOut({
      headers: new Headers({ cookie: setup.cookie }),
    });
    expect(agentSignOut.success).toBe(true);
    expect(await stateOf(agentPending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });

    const portalSetup = await setupCredentialOwner(app);
    await db
      .update(schema.sessionTable)
      .set({ portal: "customer" })
      .where(eq(schema.sessionTable.id, portalSetup.session.id));
    const portalCookie = portalSetup.cookie.replace(
      "__Host-tdk_agent_session=",
      "__Host-tdk_portal_session=",
    );
    const portalPending = await insertPendingAction({
      requesterPersonId: portalSetup.person.id,
      workspaceId: portalSetup.workspace.id,
      organisationId: portalSetup.workspace.organisationId,
      credentialType: "session",
      credentialId: portalSetup.session.id,
    });
    const portalSignOut = await portalAuth.api.signOut({
      headers: new Headers({ cookie: portalCookie }),
    });
    expect(portalSignOut.success).toBe(true);
    expect(await stateOf(portalPending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
  });

  it("preserves the current session and action when changePassword does not revoke others", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });

    const response = await auth.api.changePassword({
      headers: new Headers({ cookie: setup.cookie }),
      body: {
        currentPassword: TEST_PASSWORD,
        newPassword: "ChangedValidPassword-42!",
      },
    });

    expect(response.user.id).toBe(setup.user.id);
    expect(await stateOf(pending.id)).toEqual({
      state: "pending",
      invalidationReason: null,
    });
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, setup.session.id)),
    ).toHaveLength(1);
  });

  it("keeps sessions and pending actions on password reset with session revocation disabled", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const token = `reset-${randomUUID()}`;
    await db.insert(schema.verificationTable).values({
      id: `verification-${randomUUID()}`,
      identifier: `reset-password:${token}`,
      value: setup.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await auth.api.resetPassword({
      body: { token, newPassword: "ChangedValidPassword-42!" },
    });

    expect(response.status).toBe(true);
    expect(await stateOf(pending.id)).toEqual({
      state: "pending",
      invalidationReason: null,
    });
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, setup.session.id)),
    ).toHaveLength(1);
  });

  it("terminally invalidates an API-key-bound request when its owner deletes the key", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const key = await insertApiKey(setup.user.id);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "api_key",
      credentialId: key.id,
    });
    const response = await csrfRequest(
      app,
      "/api/auth/api-key/delete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyId: key.id }),
      },
      setup.cookie,
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
  });

  it("terminally invalidates an API-key-bound request when its owner disables the key", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const key = await insertApiKey(setup.user.id);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "api_key",
      credentialId: key.id,
    });
    const response = await csrfRequest(
      app,
      "/api/auth/api-key/update",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyId: key.id, enabled: false }),
      },
      setup.cookie,
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    const disabled = requireRow(
      await db
        .select({ enabled: schema.apikeyTable.enabled })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, key.id)),
      "disabled API key",
    );
    expect(disabled.enabled).toBe(false);
  });

  it("terminally invalidates a request bound to the exact live session on sign-out", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const response = await csrfRequest(
      app,
      "/api/auth/sign-out",
      { method: "POST" },
      setup.cookie,
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
  });

  it("invalidates every live session-bound request when the requester revokes all sessions", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const secondSession = requireRow(
      await db
        .insert(schema.sessionTable)
        .values({
          id: `session-${randomUUID()}`,
          token: `token-${randomUUID()}`,
          userId: setup.user.id,
          portal: "agent",
          expiresAt: new Date(Date.now() + 60 * 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "second credential revocation session",
    );
    const firstPending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const secondPending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: secondSession.id,
    });
    const response = await csrfRequest(
      app,
      "/api/auth/revoke-sessions",
      { method: "POST" },
      setup.cookie,
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await stateOf(firstPending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expect(await stateOf(secondPending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(firstPending.id),
      firstPending,
      setup.workspace.id,
    );
    expectPersistedInvalidation(
      await decisionRows(secondPending.id),
      secondPending,
      setup.workspace.id,
    );
  });

  it("does not invalidate an expired session credential during natural expiry cleanup", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sessionTable.id, setup.session.id));
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });

    await app.request("/api/auth/get-session", {
      headers: {
        cookie: setup.cookie,
      },
    });

    expect(await stateOf(pending.id)).toEqual({
      state: "pending",
      invalidationReason: null,
    });
    expect(await decisionRows(pending.id)).toEqual({ events: [], audits: [] });
  });

  it("terminally invalidates a naturally expired original session on later explicit bulk revocation", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sessionTable.id, setup.session.id));

    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${(++signInCounter % 250) + 1}`,
      },
      body: JSON.stringify({
        email: setup.user.email,
        password: TEST_PASSWORD,
      }),
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const currentCookie = signIn.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-tdk_agent_session="))
      ?.split(";", 1)[0];
    expect(currentCookie).toBeDefined();

    const response = await csrfRequest(
      app,
      "/api/auth/revoke-sessions",
      { method: "POST" },
      currentCookie as string,
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, setup.session.id)),
    ).toHaveLength(0);
  });

  it("returns unavailable and rolls back a swallowed sign-out transaction failure", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_credential_revocation_outbox_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'pending_action.decided' THEN
            RAISE EXCEPTION 'test credential revocation outbox failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_credential_revocation_outbox_insert
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_credential_revocation_outbox_insert()
      `),
    );

    try {
      const response = await csrfRequest(
        app,
        "/api/auth/sign-out",
        { method: "POST" },
        setup.cookie,
      );

      expect(response.status, await response.clone().text()).toBe(503);
      expect(await stateOf(pending.id)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      expect(await decisionRows(pending.id)).toEqual({
        events: [],
        audits: [],
      });
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.id, setup.session.id)),
      ).toHaveLength(1);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_credential_revocation_outbox_insert ON outbox",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_credential_revocation_outbox_insert()",
        ),
      );
    }
  });

  it("rejects direct server sign-out when the adapter swallows a failed deletion", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_direct_credential_outbox_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'pending_action.decided' THEN
            RAISE EXCEPTION 'test direct credential outbox failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_direct_credential_outbox_insert
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_direct_credential_outbox_insert()
      `),
    );

    try {
      await expect(
        auth.api.signOut({
          headers: new Headers({ cookie: setup.cookie }),
        }),
      ).rejects.toThrow();
      expect(await stateOf(pending.id)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.id, setup.session.id)),
      ).toHaveLength(1);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_direct_credential_outbox_insert ON outbox",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_direct_credential_outbox_insert()",
        ),
      );
    }
  });
});
