import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfiguredAgentOrigin } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { IdentityGrantClosureChangedError } from "../../apps/api/src/identity/errors";
import { createApp } from "../../apps/api/src/index";
import { identityConnectionDeletionTarget } from "../../apps/api/src/pending-action/identity-connection-deletion-target";
import { expirePendingActions } from "../../apps/api/src/scheduler/pending-action-expire";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  ensureAgentSession,
  type PendingDeletionBody,
  stepUpProof,
} from "./helpers/pending-deletion";

const ADMIN_ID = "connection-delete-admin";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const CONNECTION_ID = "connection-delete-target";

async function setup() {
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  const [admin] = await db
    .insert(schema.userTable)
    .values({
      id: ADMIN_ID,
      name: "Identity Delete Admin",
      email: "identity-delete-admin@example.test",
      role: "admin",
    })
    .returning();
  if (!admin) throw new Error("Identity delete admin fixture was not created");
  await ensureStaffPersonForUser(admin.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, admin.id))
    .limit(1);
  if (!person) throw new Error("Identity delete person fixture is missing");
  await db.insert(schema.sessionTable).values({
    id: `session-${admin.id}`,
    token: `token-${admin.id}`,
    userId: admin.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  mockAuthenticatedSession(admin);
  const app = createApp().app;
  await db.insert(schema.identityConnectionTable).values({
    id: CONNECTION_ID,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: null,
    displayName: "Identity connection for deletion",
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tenantId: TENANT_ID,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: Buffer.from("encrypted-delete-test-secret"),
    redirectUri: "https://ticketing.localhost/api/auth/identity/callback",
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: ["delete.example.test"],
    jitPolicy: {
      enabled: false,
      default_role_id: null,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: 10,
    enabled: true,
    createdBy: person.id,
    updatedBy: person.id,
  });
  await db.insert(schema.externalIdentityTable).values({
    identityConnectionId: CONNECTION_ID,
    personId: person.id,
    userId: admin.id,
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    subject: "subject-kept-after-deletion",
    userNameSnapshot: "Identity Delete Admin",
    emailSnapshot: admin.email,
    active: true,
    provisionedVia: "jit",
  });
  await db.insert(schema.scimConnectionTable).values({
    identityConnectionId: CONNECTION_ID,
    tokenHash: Buffer.alloc(32, 7),
    tokenPrefix: "scim_test",
    tokenCreatedAt: new Date(),
    enabled: true,
  });
  await db.insert(schema.sessionTable).values({
    id: "session-from-identity-connection",
    token: "session-from-identity-connection-token",
    userId: admin.id,
    portal: "agent",
    identityConnectionId: CONNECTION_ID,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { admin, person, app };
}

async function requestDeletion(app: ReturnType<typeof createApp>["app"]) {
  const cookie = `__Host-tdk_agent_session=token-${ADMIN_ID}`;
  const response = await csrfRequest(
    app,
    `${getConfiguredAgentOrigin()}/api/instance/identity-connections/${CONNECTION_ID}`,
    { method: "DELETE", headers: { cookie } },
    cookie,
  );
  return response;
}

async function proveAndApprove(
  app: ReturnType<typeof createApp>["app"],
  pending: PendingDeletionBody,
  typedName: string,
) {
  const token = await stepUpProof(app, ADMIN_ID, pending.pendingActionId);
  return app.request(
    `/api/me/pending-actions/${pending.pendingActionId}/approve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-taskdesk-step-up-token": token,
      },
      body: JSON.stringify({ typedName }),
    },
  );
}

describe("identity connection deletion pending action", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("retries a changed grant closure before committing exactly one request", async () => {
    const { app } = await setup();
    const original = identityConnectionDeletionTarget.load;
    const load = vi
      .spyOn(identityConnectionDeletionTarget, "load")
      .mockRejectedValueOnce(new IdentityGrantClosureChangedError())
      .mockImplementation(original);
    try {
      expect((await requestDeletion(app)).status).toBe(202);
      expect(load.mock.calls.length).toBeGreaterThan(1);
      const actions = await db.select().from(schema.pendingActionTable);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.state).toBe("pending");
    } finally {
      load.mockRestore();
    }
  });

  it("does not retry a committed deletion when a follow-up raises a grant-closure error", async () => {
    const { app } = await setup();
    const pending = (await (
      await requestDeletion(app)
    ).json()) as PendingDeletionBody;
    const original = identityConnectionDeletionTarget.execute;
    const execute = vi
      .spyOn(identityConnectionDeletionTarget, "execute")
      .mockImplementation(async (...args) => {
        const effect = await original(...args);
        return {
          ...effect,
          afterCommit: async () => {
            throw new IdentityGrantClosureChangedError();
          },
        };
      });
    try {
      const response = await proveAndApprove(
        app,
        pending,
        "Identity connection for deletion",
      );
      expect(response.status).toBe(500);
      expect(execute).toHaveBeenCalledTimes(1);
      const [action] = await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
      expect(action?.state).toBe("executed");
      const [connection] = await db
        .select()
        .from(schema.identityConnectionTable)
        .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
      expect(connection?.deletedAt).toBeInstanceOf(Date);
    } finally {
      execute.mockRestore();
    }
  });

  it("requires exact current name and step-up, then tombstones while preserving identity history", async () => {
    const { admin, app } = await setup();
    await ensureAgentSession(admin.id);

    const request = await requestDeletion(app);
    expect(request.status, await request.clone().text()).toBe(202);
    const pending = (await request.json()) as PendingDeletionBody;
    expect(pending).toMatchObject({
      action: "delete",
      confirmation: "typed_name_step_up",
      summary: {
        name: "Identity connection for deletion",
        portalScope: "agent",
      },
    });
    const [before] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID))
      .limit(1);
    expect(before?.deletedAt).toBeNull();
    expect(before?.enabled).toBe(true);

    const wrongName = await proveAndApprove(
      app,
      pending,
      "not the exact connection name",
    );
    expect(wrongName.status, await wrongName.clone().text()).toBe(400);

    const approved = await proveAndApprove(
      app,
      pending,
      "Identity connection for deletion",
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await approved.json()).toMatchObject({ state: "executed" });

    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID))
      .limit(1);
    expect(connection?.deletedAt).toBeInstanceOf(Date);
    expect(connection?.enabled).toBe(false);
    expect(connection?.clientSecret).toHaveLength(0);
    expect(connection?.configVersion).toBe((before?.configVersion ?? 0) + 1);

    const [scim] = await db
      .select()
      .from(schema.scimConnectionTable)
      .where(eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID))
      .limit(1);
    expect(scim).toMatchObject({
      enabled: false,
      tokenHash: null,
      tokenPrefix: null,
    });

    const [externalIdentity] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(
        eq(schema.externalIdentityTable.identityConnectionId, CONNECTION_ID),
      )
      .limit(1);
    expect(externalIdentity).toMatchObject({
      active: true,
      deactivatedAt: null,
      subject: "subject-kept-after-deletion",
      emailSnapshot: "identity-delete-admin@example.test",
    });
    expect(externalIdentity?.orphanedAt).toBeInstanceOf(Date);
    const [provisioningEvent] = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(
        eq(schema.provisioningEventTable.identityConnectionId, CONNECTION_ID),
      )
      .limit(1);
    expect(provisioningEvent).toMatchObject({
      kind: "connection.changed",
      outcome: "succeeded",
      detail: {
        change: "deleted",
        configVersion: (before?.configVersion ?? 0) + 1,
      },
    });
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.identityConnectionId, CONNECTION_ID)),
    ).toHaveLength(0);
    expect(await db.select().from(schema.identityConnectionTable)).toHaveLength(
      1,
    );
  });

  it("leaves connection and linked identities unchanged until pending approval executes", async () => {
    const { admin, app } = await setup();
    await ensureAgentSession(admin.id);
    const request = await requestDeletion(app);
    expect(request.status, await request.clone().text()).toBe(202);
    const pending = (await request.json()) as PendingDeletionBody;

    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID))
      .limit(1);
    const [externalIdentity] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(
        eq(schema.externalIdentityTable.identityConnectionId, CONNECTION_ID),
      )
      .limit(1);
    expect(connection).toMatchObject({ enabled: true, deletedAt: null });
    expect(externalIdentity).toMatchObject({ active: true, orphanedAt: null });
    expect(pending.pendingActionId).toEqual(expect.any(String));
    const detail = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}`,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      targetType: "identity_connection",
      confirmation: "typed_name_step_up",
    });
  });

  it("refuses approval without a pending-action-bound proof", async () => {
    const { app } = await setup();
    const pending = (await (
      await requestDeletion(app)
    ).json()) as PendingDeletionBody;
    const response = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typedName: "Identity connection for deletion" }),
      },
    );
    expect(response.status).toBe(403);
    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(connection).toMatchObject({ enabled: true, deletedAt: null });
  });

  it("rechecks the current connection version after proof issuance", async () => {
    const { admin, app } = await setup();
    const pending = (await (
      await requestDeletion(app)
    ).json()) as PendingDeletionBody;
    const token = await stepUpProof(app, admin.id, pending.pendingActionId);
    await db
      .update(schema.identityConnectionTable)
      .set({ displayName: "Changed connection", configVersion: 2 })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    const response = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ typedName: "Identity connection for deletion" }),
      },
    );
    expect(response.status).toBe(409);
    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(connection).toMatchObject({ enabled: true, deletedAt: null });
  });

  it("rejects a requester whose administrator authority has been removed", async () => {
    const { admin, app } = await setup();
    const pending = (await (
      await requestDeletion(app)
    ).json()) as PendingDeletionBody;
    const token = await stepUpProof(app, admin.id, pending.pendingActionId);
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, admin.id));
    const response = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ typedName: "Identity connection for deletion" }),
      },
    );
    expect(response.status).toBe(404); // PA-6 step 2: the approver lost authority
    const [action] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(action).toMatchObject({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(connection?.deletedAt).toBeNull();
  });

  it("allows cancellation without retiring the connection", async () => {
    const { app } = await setup();
    const pending = (await (
      await requestDeletion(app)
    ).json()) as PendingDeletionBody;
    const response = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/cancel`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "cancelled" });
    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(connection?.deletedAt).toBeNull();
  });

  it("expires the exact instance-scoped deletion through the ordinary expiry job", async () => {
    const { app } = await setup();
    const pending = (await (
      await requestDeletion(app)
    ).json()) as PendingDeletionBody;
    await db
      .update(schema.pendingActionTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    const result = await expirePendingActions();
    expect(result).toMatchObject({ expired: 1, degraded: false });
    const [action] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(action?.state).toBe("expired");
    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(connection?.deletedAt).toBeNull();
  });
});
