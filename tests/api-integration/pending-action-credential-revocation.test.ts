import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  auth,
  getConfiguredAgentOrigin,
  portalAuth,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as observability from "../../apps/api/src/instance/observability/runtime";
import { deleteExpiredSessions } from "../../apps/api/src/scheduler/session-cleanup";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import {
  addWorkspaceMemberNative,
  leaveWorkspaceNative,
} from "./helpers/workspace-membership-write-http";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const TEST_PASSWORD = "credential-revocation-fixture-password";
let signInCounter = 0;

const ACCOUNT_RACE_MEMBERSHIP_LOCK = 4_002;
const ACCOUNT_RACE_TRIGGER_LOCK = 4_006;

async function waitForBlockedCount(
  client: Client,
  blockerPid: number,
  expectedCount: number,
): Promise<number[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const result = await client.query<{ pid: number }>(
      `
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(pid))
        ORDER BY query_start, pid
      `,
      [blockerPid],
    );
    if (result.rows.length >= expectedCount) {
      return result.rows.map((row) => row.pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} database operations blocked by ${blockerPid}`,
  );
}

async function waitForBlockedByPid(
  client: Client,
  blockerPid: number,
): Promise<number> {
  const [pid] = await waitForBlockedCount(client, blockerPid, 1);
  if (pid === undefined)
    throw new Error(`No operation blocked by ${blockerPid}`);
  return pid;
}

async function waitForPidBlockedBy(
  client: Client,
  pid: number,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const result = await client.query<{ waiting: boolean }>(
      `
        SELECT $2 = ANY(pg_blocking_pids($1)) AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid = $1
      `,
      [pid, blockerPid],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Backend ${pid} did not block behind ${blockerPid}`);
}

async function waitForDeletedUser(userId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId));
    if (rows.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Account deletion did not remove user ${userId}`);
}

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
  credentialId: string | null;
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
  invalidationReason = "credential_revoked",
) {
  expect(decisions.events).toHaveLength(1);
  expect(decisions.events[0]).toMatchObject({
    workspaceId,
    organisationId: pending.organisationId,
    payload: {
      payload: {
        pendingActionId: pending.id,
        outcome: "invalidated",
        invalidationReason,
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
      invalidationReason,
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

  it("terminally invalidates a request when an expired API key is extended", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const key = await insertApiKey(setup.user.id);
    await db
      .update(schema.apikeyTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.apikeyTable.id, key.id));
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "api_key",
      credentialId: key.id,
    });

    await auth.api.updateApiKey({
      body: {
        keyId: key.id,
        userId: setup.user.id,
        expiresIn: 2 * 24 * 60 * 60,
      },
    });

    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
    );
    const restored = requireRow(
      await db
        .select({ expiresAt: schema.apikeyTable.expiresAt })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, key.id)),
      "extended API key",
    );
    expect(restored.expiresAt?.getTime()).toBeGreaterThan(Date.now());
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

  it("invalidates a pending action when account deletion follows natural session cleanup", async () => {
    const { app } = createApp();
    const setup = await setupCredentialOwner(app);
    const otherOwnerId = `cleaned-account-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const legacyPending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: null,
    });
    await ensureStaffPersonForUser(otherOwnerId);
    const otherPerson = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, otherOwnerId))
        .limit(1),
      "unrelated account-deletion requester person",
    );
    const unrelatedPending = await insertPendingAction({
      requesterPersonId: otherPerson.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: `unrelated-${randomUUID()}`,
    });
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sessionTable.id, setup.session.id));

    expect(await deleteExpiredSessions()).toBe(1);
    expect(await stateOf(pending.id)).toEqual({
      state: "pending",
      invalidationReason: null,
    });

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
    const replacementCookie = signIn.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-tdk_agent_session="))
      ?.split(";", 1)[0];
    expect(replacementCookie).toBeDefined();

    const response = await csrfRequest(
      app,
      "/api/auth/delete-user",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: TEST_PASSWORD }),
      },
      replacementCookie as string,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expectPersistedInvalidation(
      await decisionRows(pending.id),
      pending,
      setup.workspace.id,
      "capability_removed",
    );
    expect(await stateOf(legacyPending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expectPersistedInvalidation(
      await decisionRows(legacyPending.id),
      legacyPending,
      setup.workspace.id,
      "capability_removed",
    );
    expect(await stateOf(unrelatedPending.id)).toEqual({
      state: "pending",
      invalidationReason: null,
    });
    expect(await decisionRows(unrelatedPending.id)).toEqual({
      events: [],
      audits: [],
    });

    // Re-linking the surviving person to an auth principal cannot revive the
    // old decision; the state transition is terminal and pending-only.
    await db.insert(schema.userTable).values({
      id: setup.user.id,
      email: setup.user.email,
      emailVerified: true,
      name: setup.user.name,
    });
    await db
      .update(schema.personTable)
      .set({ userId: setup.user.id })
      .where(eq(schema.personTable.id, setup.person.id));
    expect(await stateOf(pending.id)).toEqual({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
  });

  it("rolls back residual account-deletion invalidation when its decision outbox insert fails", async () => {
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
    expect(await deleteExpiredSessions()).toBe(1);
    expect(await stateOf(pending.id)).toEqual({
      state: "pending",
      invalidationReason: null,
    });

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
    const replacementCookie = signIn.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-tdk_agent_session="))
      ?.split(";", 1)[0];
    expect(replacementCookie).toBeDefined();

    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_residual_account_decision_outbox()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'pending_action.decided' THEN
            RAISE EXCEPTION 'forced residual decision outbox failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_residual_account_decision_outbox
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_residual_account_decision_outbox()
      `),
    );

    try {
      const response = await csrfRequest(
        app,
        "/api/auth/delete-user",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: TEST_PASSWORD }),
        },
        replacementCookie as string,
      );
      expect(response.status, await response.clone().text()).not.toBe(200);
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
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, setup.user.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ userId: schema.personTable.userId })
          .from(schema.personTable)
          .where(eq(schema.personTable.id, setup.person.id)),
      ).toEqual([{ userId: setup.user.id }]);
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.userId, setup.user.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.id, setup.session.id)),
      ).toHaveLength(0);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_residual_account_decision_outbox ON outbox",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_residual_account_decision_outbox()",
        ),
      );
    }
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

  it("account deletion through HTTP terminally invalidates the original session action", async () => {
    const app = createApp().app;
    const setup = await setupCredentialOwner(app);
    const otherOwnerId = `account-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const expiredSession = requireRow(
      await db
        .insert(schema.sessionTable)
        .values({
          id: `expired-account-session-${randomUUID()}`,
          token: `expired-account-session-token-${randomUUID()}`,
          userId: setup.user.id,
          expiresAt: new Date(Date.now() - 60_000),
          createdAt: new Date(Date.now() - 120_000),
          updatedAt: new Date(Date.now() - 120_000),
        })
        .returning({ id: schema.sessionTable.id }),
      "expired original account session",
    );
    const expiredSessionAction = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: expiredSession.id,
    });
    const disabledKey = requireRow(
      await db
        .insert(schema.apikeyTable)
        .values({
          userId: setup.user.id,
          referenceId: setup.user.id,
          key: `disabled-account-key-${randomUUID()}`,
          name: "disabled account deletion fixture",
          enabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: schema.apikeyTable.id }),
      "disabled account API key",
    );
    const disabledKeyAction = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "api_key",
      credentialId: disabledKey.id,
    });
    const mismatchedReferenceKey = requireRow(
      await db
        .insert(schema.apikeyTable)
        .values({
          userId: setup.user.id,
          referenceId: `unrelated-reference-${randomUUID()}`,
          key: `mismatched-reference-account-key-${randomUUID()}`,
          name: "mismatched reference account deletion fixture",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: schema.apikeyTable.id }),
      "mismatched reference account API key",
    );
    const mismatchedReferenceAction = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "api_key",
      credentialId: mismatchedReferenceKey.id,
    });

    const response = await csrfRequest(
      app,
      "/api/auth/delete-user",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: TEST_PASSWORD }),
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
    for (const action of [
      expiredSessionAction,
      disabledKeyAction,
      mismatchedReferenceAction,
    ]) {
      expect(await stateOf(action.id)).toEqual({
        state: "invalidated",
        invalidationReason: "credential_revoked",
      });
      expectPersistedInvalidation(
        await decisionRows(action.id),
        action,
        setup.workspace.id,
      );
    }
    expect(
      await db
        .select({ id: schema.apikeyTable.id })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.userId, setup.user.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, expiredSession.id)),
    ).toHaveLength(0);
  });

  it("direct auth.api.deleteUser terminally invalidates the original session action", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const otherOwnerId = `direct-account-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });

    const result = await auth.api.deleteUser({
      body: { password: TEST_PASSWORD },
      headers: new Headers({ cookie: setup.cookie }),
    });

    expect(result).toMatchObject({ success: true, message: "User deleted" });
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

  it("POST token delegation consumes verification and deletes the account in the same transaction", async () => {
    const app = createApp().app;
    const setup = await setupCredentialOwner(app);
    const otherOwnerId = `token-account-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const token = `delete-${randomUUID()}`;
    await db.insert(schema.verificationTable).values({
      id: `verification-${randomUUID()}`,
      identifier: `delete-account-${token}`,
      value: setup.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await csrfRequest(
      app,
      "/api/auth/delete-user",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
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
    expect(
      await db
        .select({ id: schema.verificationTable.id })
        .from(schema.verificationTable)
        .where(
          eq(schema.verificationTable.identifier, `delete-account-${token}`),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, setup.user.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ userId: schema.personTable.userId })
        .from(schema.personTable)
        .where(eq(schema.personTable.id, setup.person.id)),
    ).toEqual([{ userId: null }]);
  });

  it("direct auth.api.deleteUserCallback consumes and deletes inside the same transaction", async () => {
    const setup = await setupCredentialOwner(createApp().app);
    const otherOwnerId = `direct-callback-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const token = `direct-callback-${randomUUID()}`;
    await db.insert(schema.verificationTable).values({
      id: `verification-${randomUUID()}`,
      identifier: `delete-account-${token}`,
      value: setup.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await auth.api.deleteUserCallback({
      query: { token },
      headers: new Headers({ cookie: setup.cookie }),
    });

    expect(result).toMatchObject({ success: true, message: "User deleted" });
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
        .select({ userId: schema.personTable.userId })
        .from(schema.personTable)
        .where(eq(schema.personTable.id, setup.person.id)),
    ).toEqual([{ userId: null }]);
  });

  it("GET delete-user callback preserves its redirect after the atomic deletion commits", async () => {
    const app = createApp().app;
    const setup = await setupCredentialOwner(app);
    const otherOwnerId = `get-callback-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const token = `get-callback-${randomUUID()}`;
    await db.insert(schema.verificationTable).values({
      id: `verification-${randomUUID()}`,
      identifier: `delete-account-${token}`,
      value: setup.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const callbackURL = "/account-removed";
    const origin = getConfiguredAgentOrigin();
    const response = await app.request(
      `${origin}/api/auth/delete-user/callback?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`,
      {
        headers: {
          cookie: setup.cookie,
          origin,
        },
      },
    );

    expect(response.status, await response.clone().text()).toBe(302);
    expect(response.headers.get("location")).toBe(callbackURL);
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
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, setup.user.id)),
    ).toHaveLength(0);
  });

  it("retries the whole account-delete request when a real member insert grows the closure", async () => {
    const app = createApp().app;
    const deleting = await setupCredentialOwner(app);
    const workspaceOwner = await setupCredentialOwner(app);
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspaceOwner.workspace.id,
      role: "member",
      permission: JSON.stringify({}),
      isSystem: false,
    });
    const pending = await insertPendingAction({
      requesterPersonId: deleting.person.id,
      workspaceId: deleting.workspace.id,
      organisationId: deleting.person.organisationId,
      credentialType: "session",
      credentialId: deleting.session.id,
    });
    const token = `account-closure-retry-${randomUUID()}`;
    const verificationIdentifier = `delete-account-${token}`;
    await db.insert(schema.verificationTable).values({
      id: `verification-${randomUUID()}`,
      identifier: verificationIdentifier,
      value: deleting.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const callbackURL = "/account-removed-after-retry";
    const origin = getConfiguredAgentOrigin();
    const triggerSuffix = randomUUID().replaceAll("-", "");
    const triggerName = `pause_account_member_insert_${triggerSuffix}`;
    const functionName = `${triggerName}_fn`;
    const barrierKey = `account_member_insert_${triggerSuffix}`;
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const retryBlockerClient = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    let barrierHeld = false;
    let retryMembershipLockHeld = false;
    let retryMembershipLockRequest: Promise<unknown> | undefined;
    let triggerCreated = false;
    let addRequest: Promise<Response> | undefined;
    let deleteRequest: Promise<Response> | undefined;

    await client.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [
        ACCOUNT_RACE_TRIGGER_LOCK,
        barrierKey,
      ]);
      barrierHeld = true;
      const { rows: barrierRows } = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const barrierPid = barrierRows[0]?.pid;
      if (barrierPid === undefined)
        throw new Error("Missing insert barrier PID");
      await client.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.user_id = '${deleting.user.id}'
             AND NEW.workspace_id = '${workspaceOwner.workspace.id}' THEN
            PERFORM pg_advisory_xact_lock(
              ${ACCOUNT_RACE_TRIGGER_LOCK}, hashtext('${barrierKey}')
            );
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER ${triggerName}
        AFTER INSERT ON workspace_member
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);
      triggerCreated = true;

      addRequest = addWorkspaceMemberNative(
        app,
        workspaceOwner.cookie,
        workspaceOwner.workspace.id,
        { userId: deleting.user.id, role: "member" },
      );
      const insertPid = await waitForBlockedByPid(client, barrierPid);
      deleteRequest = Promise.resolve(
        app.request(
          `${origin}/api/auth/delete-user/callback?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`,
          {
            headers: {
              cookie: deleting.cookie,
              origin,
            },
          },
        ),
      );
      await waitForBlockedByPid(client, insertPid);

      // Queue another backend behind the real add transaction's workspace
      // lock. When the insert commits, this backend wins before the account
      // retry, making the retry's expanded workspace closure observable.
      await retryBlockerClient.connect();
      const { rows: retryBlockerRows } = await retryBlockerClient.query<{
        pid: number;
      }>("SELECT pg_backend_pid() AS pid");
      const retryBlockerPid = retryBlockerRows[0]?.pid;
      if (retryBlockerPid === undefined)
        throw new Error("Missing retry workspace-lock blocker PID");
      retryMembershipLockRequest = retryBlockerClient.query(
        "SELECT pg_advisory_lock($1, hashtext($2))",
        [ACCOUNT_RACE_MEMBERSHIP_LOCK, workspaceOwner.workspace.id],
      );
      await waitForPidBlockedBy(client, retryBlockerPid, insertPid);
      retryMembershipLockHeld = true;

      await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
        ACCOUNT_RACE_TRIGGER_LOCK,
        barrierKey,
      ]);
      barrierHeld = false;
      await retryMembershipLockRequest;
      await waitForBlockedByPid(client, retryBlockerPid);
      expect(await stateOf(pending.id)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      expect(
        await db
          .select({ id: schema.verificationTable.id })
          .from(schema.verificationTable)
          .where(
            eq(schema.verificationTable.identifier, verificationIdentifier),
          ),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.id, deleting.session.id)),
      ).toHaveLength(1);
      expect(
        await auth.api.getSession({
          headers: new Headers({ cookie: deleting.cookie }),
        }),
      ).toMatchObject({ user: { id: deleting.user.id } });
      await retryBlockerClient.query(
        "SELECT pg_advisory_unlock($1, hashtext($2))",
        [ACCOUNT_RACE_MEMBERSHIP_LOCK, workspaceOwner.workspace.id],
      );
      retryMembershipLockHeld = false;
      if (!addRequest || !deleteRequest) {
        throw new Error("Account-deletion barrier requests were not started");
      }
      const [addResponse, deleteResponse] = await Promise.all([
        addRequest,
        deleteRequest,
      ]);
      expect(addResponse.status, await addResponse.clone().text()).toBe(200);
      expect(deleteResponse.status, await deleteResponse.clone().text()).toBe(
        302,
      );
      expect(deleteResponse.headers.get("location")).toBe(callbackURL);
      expect(await stateOf(pending.id)).toEqual({
        state: "invalidated",
        invalidationReason: "credential_revoked",
      });
      expectPersistedInvalidation(
        await decisionRows(pending.id),
        pending,
        deleting.workspace.id,
      );
      expect(
        await db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, deleting.user.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select({ id: schema.verificationTable.id })
          .from(schema.verificationTable)
          .where(
            eq(schema.verificationTable.identifier, verificationIdentifier),
          ),
      ).toHaveLength(0);
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.id, deleting.session.id)),
      ).toHaveLength(0);
      expect(
        await auth.api.getSession({
          headers: new Headers({ cookie: deleting.cookie }),
        }),
      ).toBeNull();
      expect(
        await db
          .select({ userId: schema.workspaceUserTable.userId })
          .from(schema.workspaceUserTable)
          .where(
            eq(
              schema.workspaceUserTable.workspaceId,
              workspaceOwner.workspace.id,
            ),
          ),
      ).toEqual([{ userId: workspaceOwner.user.id }]);
    } finally {
      if (barrierHeld) {
        await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
          ACCOUNT_RACE_TRIGGER_LOCK,
          barrierKey,
        ]);
      }
      if (retryMembershipLockHeld) {
        await retryBlockerClient.query(
          "SELECT pg_advisory_unlock($1, hashtext($2))",
          [ACCOUNT_RACE_MEMBERSHIP_LOCK, workspaceOwner.workspace.id],
        );
      }
      if (addRequest) await addRequest.catch(() => undefined);
      if (deleteRequest) await deleteRequest.catch(() => undefined);
      if (triggerCreated) {
        await client.query(
          `DROP TRIGGER IF EXISTS ${triggerName} ON workspace_member`,
        );
        await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }
      if (retryMembershipLockRequest) {
        await retryMembershipLockRequest.catch(() => undefined);
      }
      await retryBlockerClient.end();
      await client.end();
    }
  });

  it("account deletion wins before a blocked native member insertion", async () => {
    const app = createApp().app;
    const deleting = await setupCredentialOwner(app);
    const workspaceOwner = await setupCredentialOwner(app);
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspaceOwner.workspace.id,
      role: "member",
      permission: JSON.stringify({}),
      isSystem: false,
    });
    const pending = await insertPendingAction({
      requesterPersonId: deleting.person.id,
      workspaceId: deleting.workspace.id,
      organisationId: deleting.person.organisationId,
      credentialType: "session",
      credentialId: deleting.session.id,
    });
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    let barrierHeld = false;
    let addRequest: Promise<Response> | undefined;
    let deleteRequest: Promise<Response> | undefined;
    await client.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [
        ACCOUNT_RACE_MEMBERSHIP_LOCK,
        workspaceOwner.workspace.id,
      ]);
      barrierHeld = true;
      const { rows: barrierRows } = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const barrierPid = barrierRows[0]?.pid;
      if (barrierPid === undefined)
        throw new Error("Missing membership barrier PID");
      addRequest = addWorkspaceMemberNative(
        app,
        workspaceOwner.cookie,
        workspaceOwner.workspace.id,
        { userId: deleting.user.id, role: "member" },
      );
      await waitForBlockedByPid(client, barrierPid);
      deleteRequest = csrfRequest(
        app,
        "/api/auth/delete-user",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: TEST_PASSWORD }),
        },
        deleting.cookie,
      );
      const deleteResponse = await deleteRequest;
      expect(deleteResponse.status, await deleteResponse.clone().text()).toBe(
        200,
      );
      await waitForDeletedUser(deleting.user.id);
      await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
        ACCOUNT_RACE_MEMBERSHIP_LOCK,
        workspaceOwner.workspace.id,
      ]);
      barrierHeld = false;
      const addResponse = await addRequest;
      expect(addResponse.status, await addResponse.clone().text()).toBe(404);
      expect(await stateOf(pending.id)).toEqual({
        state: "invalidated",
        invalidationReason: "credential_revoked",
      });
      expect(
        await db
          .select({ userId: schema.workspaceUserTable.userId })
          .from(schema.workspaceUserTable)
          .where(
            and(
              eq(
                schema.workspaceUserTable.workspaceId,
                workspaceOwner.workspace.id,
              ),
              eq(schema.workspaceUserTable.userId, deleting.user.id),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      if (barrierHeld) {
        await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
          ACCOUNT_RACE_MEMBERSHIP_LOCK,
          workspaceOwner.workspace.id,
        ]);
      }
      if (addRequest) await addRequest.catch(() => undefined);
      if (deleteRequest) await deleteRequest.catch(() => undefined);
      await client.end();
    }
  });

  it.each([
    { first: "leave", expectedLeave: 200 },
    { first: "delete", expectedLeave: 404 },
  ] as const)(
    "serializes native leave and account deletion with $first acquiring the workspace lock first",
    async ({ first, expectedLeave }) => {
      const app = createApp().app;
      const deleting = await setupCredentialOwner(app);
      const otherOwnerId = `barrier-other-owner-${randomUUID()}`;
      await db.insert(schema.userTable).values({
        id: otherOwnerId,
        email: `${otherOwnerId}@example.test`,
        emailVerified: true,
        name: "Remaining Owner",
      });
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: deleting.workspace.id,
        userId: otherOwnerId,
        role: "owner",
        joinedAt: new Date(),
      });
      const client = new Client({
        connectionString: process.env.TASKDESK_DATABASE_URL,
      });
      let barrierHeld = false;
      let leaveRequest: Promise<Response> | undefined;
      let deleteRequest: Promise<Response> | undefined;
      await client.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [
          ACCOUNT_RACE_MEMBERSHIP_LOCK,
          deleting.workspace.id,
        ]);
        barrierHeld = true;
        const { rows: barrierRows } = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        const barrierPid = barrierRows[0]?.pid;
        if (barrierPid === undefined)
          throw new Error("Missing leave barrier PID");
        const firstRequest = () =>
          first === "leave"
            ? leaveWorkspaceNative(app, deleting.cookie, deleting.workspace.id)
            : csrfRequest(
                app,
                "/api/auth/delete-user",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ password: TEST_PASSWORD }),
                },
                deleting.cookie,
              );
        const secondRequest = () =>
          first === "leave"
            ? csrfRequest(
                app,
                "/api/auth/delete-user",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ password: TEST_PASSWORD }),
                },
                deleting.cookie,
              )
            : leaveWorkspaceNative(app, deleting.cookie, deleting.workspace.id);
        const firstPending = firstRequest();
        const firstBlockedPid = await waitForBlockedByPid(client, barrierPid);
        const secondPending = secondRequest();
        // Both routes acquire the pending-action lifecycle gate before the
        // workspace-membership lock. The first request therefore waits on
        // this test's membership barrier while holding the lifecycle gate;
        // the second request must wait behind that first transaction rather
        // than also appearing as a direct waiter on the external barrier.
        const secondBlockedPid = await waitForBlockedByPid(
          client,
          firstBlockedPid,
        );
        expect(secondBlockedPid).not.toBe(firstBlockedPid);
        await waitForPidBlockedBy(client, firstBlockedPid, barrierPid);
        if (first === "leave") leaveRequest = firstPending;
        else deleteRequest = firstPending;
        if (first === "leave") deleteRequest = secondPending;
        else leaveRequest = secondPending;
        await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
          ACCOUNT_RACE_MEMBERSHIP_LOCK,
          deleting.workspace.id,
        ]);
        barrierHeld = false;
        const [firstResponse, secondResponse] = await Promise.all([
          firstPending,
          secondPending,
        ]);
        const leaveResponse =
          first === "leave" ? firstResponse : secondResponse;
        const deleteResponse =
          first === "delete" ? firstResponse : secondResponse;
        expect(leaveResponse.status, await leaveResponse.clone().text()).toBe(
          expectedLeave,
        );
        expect(deleteResponse.status, await deleteResponse.clone().text()).toBe(
          200,
        );
        expect(
          await db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.id, deleting.user.id)),
        ).toHaveLength(0);
        expect(
          await db
            .select({ userId: schema.workspaceUserTable.userId })
            .from(schema.workspaceUserTable)
            .where(
              eq(schema.workspaceUserTable.workspaceId, deleting.workspace.id),
            ),
        ).toEqual([{ userId: otherOwnerId }]);
      } finally {
        if (barrierHeld) {
          await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
            ACCOUNT_RACE_MEMBERSHIP_LOCK,
            deleting.workspace.id,
          ]);
        }
        if (leaveRequest) await leaveRequest.catch(() => undefined);
        if (deleteRequest) await deleteRequest.catch(() => undefined);
        await client.end();
      }
    },
  );

  it("serializes account deletion with a concurrent native workspace leave", async () => {
    const app = createApp().app;
    const setup = await setupCredentialOwner(app);
    const otherOwnerId = `race-account-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });

    const [deleteResponse, leaveResponse] = await Promise.all([
      csrfRequest(
        app,
        "/api/auth/delete-user",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: TEST_PASSWORD }),
        },
        setup.cookie,
      ),
      leaveWorkspaceNative(app, setup.cookie, setup.workspace.id),
    ]);

    expect(deleteResponse.status, await deleteResponse.clone().text()).toBe(
      200,
    );
    expect([200, 401, 404]).toContain(leaveResponse.status);
    expect(leaveResponse.status).toBeLessThan(500);
    expect(
      await db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, setup.user.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ userId: schema.workspaceUserTable.userId })
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, setup.workspace.id)),
    ).toEqual([{ userId: otherOwnerId }]);
  });

  it("serializes two account deletions that share one workspace", async () => {
    const app = createApp().app;
    const first = await setupCredentialOwner(app);
    const second = await setupCredentialOwner(app);
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, second.workspace.id),
          eq(schema.workspaceUserTable.userId, second.user.id),
        ),
      );
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, second.workspace.id));
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: first.workspace.id,
      userId: second.user.id,
      role: "owner",
      joinedAt: new Date(),
    });

    const results = await Promise.all([
      auth.api.deleteUser({
        body: { password: TEST_PASSWORD },
        headers: new Headers({ cookie: first.cookie }),
      }),
      auth.api.deleteUser({
        body: { password: TEST_PASSWORD },
        headers: new Headers({ cookie: second.cookie }),
      }),
    ]);

    expect(results).toEqual([
      { success: true, message: "User deleted" },
      { success: true, message: "User deleted" },
    ]);
    expect(
      await db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(inArray(schema.userTable.id, [first.user.id, second.user.id])),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, first.workspace.id)),
    ).toHaveLength(0);
  });

  it("rolls back token consumption, membership cleanup, and PA invalidation when the outbox rejects account deletion", async () => {
    const app = createApp().app;
    const setup = await setupCredentialOwner(app);
    const otherOwnerId = `rollback-account-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const token = `rollback-delete-${randomUUID()}`;
    const verification = {
      id: `verification-${randomUUID()}`,
      identifier: `delete-account-${token}`,
      value: setup.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.verificationTable).values(verification);
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_account_delete_outbox_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced account-deletion outbox failure';
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_account_delete_outbox_insert
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_account_delete_outbox_insert()
      `),
    );

    try {
      const response = await csrfRequest(
        app,
        "/api/auth/delete-user",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        },
        setup.cookie,
      );

      expect(response.status, await response.clone().text()).not.toBe(200);
      expect(await stateOf(pending.id)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      expect(
        await db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, setup.user.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.id, setup.session.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ userId: schema.workspaceUserTable.userId })
          .from(schema.workspaceUserTable)
          .where(eq(schema.workspaceUserTable.userId, setup.user.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: schema.verificationTable.id })
          .from(schema.verificationTable)
          .where(eq(schema.verificationTable.id, verification.id)),
      ).toHaveLength(1);
      expect(await decisionRows(pending.id)).toEqual({
        events: [],
        audits: [],
      });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_account_delete_outbox_insert ON outbox",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS fail_account_delete_outbox_insert()"),
      );
    }
  });

  it("reports each residual-action audit failure after account deletion commits", async () => {
    const app = createApp().app;
    const setup = await setupCredentialOwner(app);
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, setup.user.id));
    const { user: retainedAdmin } = await createWorkspaceMember({
      role: "owner",
    });
    await ensureStaffPersonForUser(retainedAdmin.id);
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, retainedAdmin.id));

    const credentialBound = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const residual = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: null,
    });
    const token = `residual-audit-failure-${randomUUID()}`;
    await db.insert(schema.verificationTable).values({
      id: `verification-${randomUUID()}`,
      identifier: `delete-account-${token}`,
      value: setup.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const auditFailure = vi.spyOn(observability, "recordAuditWriteFailure");
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_account_residual_audit_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'pending_action.decided' THEN
            RAISE EXCEPTION 'forced account residual audit failure';
          END IF;
          RETURN NEW;
        END $$;
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_account_residual_audit_insert
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION fail_account_residual_audit_insert()
      `),
    );

    try {
      const response = await csrfRequest(
        app,
        "/api/auth/delete-user",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        },
        setup.cookie,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      await waitForDeletedUser(setup.user.id);
      expect(await stateOf(credentialBound.id)).toEqual({
        state: "invalidated",
        invalidationReason: "credential_revoked",
      });
      expect(await stateOf(residual.id)).toEqual({
        state: "invalidated",
        invalidationReason: "capability_removed",
      });
      expect((await decisionRows(credentialBound.id)).events).toHaveLength(1);
      expect((await decisionRows(residual.id)).events).toHaveLength(1);
      expect((await decisionRows(credentialBound.id)).audits).toHaveLength(0);
      expect((await decisionRows(residual.id)).audits).toHaveLength(0);
      expect(auditFailure.mock.calls).toEqual([
        ["pending_action_decision"],
        ["pending_action_decision"],
      ]);
      const notifications = await db
        .select({ eventData: schema.notificationTable.eventData })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "audit_write_failed"));
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.eventData).toMatchObject({
        operation: "pending_action_decision",
      });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_account_residual_audit_insert ON audit_log",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS fail_account_residual_audit_insert()"),
      );
      auditFailure.mockRestore();
    }
  });

  it("rolls back pre-delete cleanup and PA history when Better Auth user deletion fails late", async () => {
    const app = createApp().app;
    const setup = await setupCredentialOwner(app);
    const otherOwnerId = `late-failure-account-delete-other-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: otherOwnerId,
      email: `${otherOwnerId}@example.test`,
      emailVerified: true,
      name: "Remaining Owner",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: setup.workspace.id,
      userId: otherOwnerId,
      role: "owner",
      joinedAt: new Date(),
    });
    const pending = await insertPendingAction({
      requesterPersonId: setup.person.id,
      workspaceId: setup.workspace.id,
      organisationId: setup.workspace.organisationId,
      credentialType: "session",
      credentialId: setup.session.id,
    });
    const token = `late-failure-delete-${randomUUID()}`;
    const verification = {
      id: `verification-${randomUUID()}`,
      identifier: `delete-account-${token}`,
      value: setup.user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.verificationTable).values(verification);
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_account_delete_user_delete()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced late Better Auth user delete failure';
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_account_delete_user_delete
        BEFORE DELETE ON "user"
        FOR EACH ROW EXECUTE FUNCTION fail_account_delete_user_delete()
      `),
    );

    try {
      const response = await csrfRequest(
        app,
        "/api/auth/delete-user",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        },
        setup.cookie,
      );

      expect(response.status, await response.clone().text()).not.toBe(200);
      expect(await stateOf(pending.id)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      expect(
        await db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, setup.user.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.id, setup.session.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: schema.verificationTable.id })
          .from(schema.verificationTable)
          .where(eq(schema.verificationTable.id, verification.id)),
      ).toHaveLength(1);
      expect(await decisionRows(pending.id)).toEqual({
        events: [],
        audits: [],
      });
    } finally {
      await db.execute(
        sql.raw(
          'DROP TRIGGER IF EXISTS fail_account_delete_user_delete ON "user"',
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS fail_account_delete_user_delete()"),
      );
    }
  });
});
