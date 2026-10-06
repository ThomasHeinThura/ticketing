import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../../../apps/api/src/auth";
import { consumeOidcGroupMappingProof } from "../../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { projectMembershipKeys } from "../../../apps/api/src/identity/membership-projection";
import { oidcGroupMappingAdminRouter } from "../../../apps/api/src/identity/oidc-group-mapping-admin";
import { createApp } from "../../../apps/api/src/index";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "../helpers/auth";
import { csrfRequest } from "../helpers/csrf";
import { resetTestDatabase } from "../helpers/database";

const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

const ADMIN_ID = "oidc-group-mapping-admin";
const SECOND_ADMIN_ID = "oidc-group-mapping-admin-two";
const CONNECTION_ID = "oidc-group-mapping-connection";
const WORKSPACE_ID = "oidc-group-mapping-workspace";
const WORKSPACE_ROLE_ID = "oidc-group-mapping-role";
const DIRECT_ROLE_ID = "oidc-group-mapping-direct-role";
const OTHER_ROLE_ID = "oidc-group-mapping-other-role";
const OVER_CEILING_ROLE_ID = "oidc-group-mapping-over-ceiling-role";
const PASSWORD = "Oidc-group-mapping-password-83!";
const ENCRYPTION_KEY = "d4".repeat(32);
const GROUP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;
const originalPreviousEncryptionKey =
  process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;

async function setupAdmin(userId = ADMIN_ID, role = "admin") {
  const [admin] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      name: "OIDC Mapping Administrator",
      email: `${userId}@example.test`,
      role,
    })
    .returning();
  if (!admin) throw new Error("OIDC mapping administrator was not created");
  await ensureStaffPersonForUser(admin.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, admin.id))
    .limit(1);
  if (!person) throw new Error("OIDC mapping administrator person is missing");
  const now = new Date();
  mockAuthenticatedSession(admin);
  await db.insert(schema.sessionTable).values({
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.accountTable).values({
    id: `account-${userId}`,
    accountId: userId,
    providerId: "credential",
    userId,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return {
    admin,
    personId: person.id,
    sessionCookie: `__Host-tdk_agent_session=token-${userId}`,
  };
}

async function setupConnection() {
  const internal = await ensureInternalOrganisation();
  await db.insert(schema.workspaceTable).values({
    id: WORKSPACE_ID,
    organisationId: internal.id,
    name: "OIDC Mapping Workspace",
    slug: "oidc-mapping-workspace",
    createdAt: new Date(),
  });
  await db.insert(schema.roleTable).values([
    {
      id: WORKSPACE_ROLE_ID,
      scope: "workspace",
      workspaceId: WORKSPACE_ID,
      key: "oidc-mapping-role",
      name: "OIDC Mapping Role",
      rank: 2,
      capabilities: [],
    },
    {
      id: DIRECT_ROLE_ID,
      scope: "workspace",
      workspaceId: WORKSPACE_ID,
      key: "oidc-mapping-direct-role",
      name: "Direct Grant Role",
      rank: 1,
      capabilities: [],
    },
    {
      id: OTHER_ROLE_ID,
      scope: "workspace",
      workspaceId: WORKSPACE_ID,
      key: "oidc-mapping-other-role",
      name: "Other OIDC Mapping Role",
      rank: 3,
      capabilities: [],
    },
    {
      id: OVER_CEILING_ROLE_ID,
      scope: "workspace",
      workspaceId: WORKSPACE_ID,
      key: "oidc-mapping-over-ceiling-role",
      name: "Over Ceiling Role",
      rank: 9,
      capabilities: [],
    },
  ]);
  await db.insert(schema.identityConnectionTable).values({
    id: CONNECTION_ID,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: null,
    displayName: "OIDC Mapping Test Connection",
    issuer: "https://login.microsoftonline.com/tenant/v2.0",
    tenantId: "tenant",
    clientId: "oidc-mapping-test-client",
    clientSecret: encryptIdentityClientSecret(CONNECTION_ID, "test-secret"),
    redirectUri: "http://localhost:1337/api/auth/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: { enabled: false, required_entra_app_role: "TaskDesk.User" },
    maxRoleRank: 5,
    enabled: true,
  });
}

function createMappingApp() {
  const app = createApp().app;
  const routePath =
    "/api/instance/identity-connections/{id}/oidc-group-mappings";
  if (!app.routes.some((route) => route.path === routePath))
    app.route("/api/instance", oidcGroupMappingAdminRouter);
  return app;
}

async function issueProof(
  app: ReturnType<typeof createApp>["app"],
  sessionCookie: string,
  binding: Record<string, unknown>,
) {
  const challengeResponse = await csrfRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(binding),
    },
    sessionCookie,
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proofResponse = await csrfRequest(
    app,
    "/api/me/step-up",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...binding,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        method: "password",
        password: PASSWORD,
      }),
    },
    sessionCookie,
  );
  expect(proofResponse.status).toBe(200);
  return ((await proofResponse.json()) as { token: string }).token;
}

async function waitForBlockedPid(client: Client, blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ pid: number }>(
      `
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(pid))
        LIMIT 1
      `,
      [blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No PostgreSQL session blocked by pid ${blockerPid}`);
}

function createRequest(externalGroupId: string) {
  return {
    configVersion: 1,
    externalGroupId,
    roleId: WORKSPACE_ROLE_ID,
    scope: "workspace",
    scopeId: WORKSPACE_ID,
  };
}

async function createMapping(
  app: ReturnType<typeof createApp>["app"],
  sessionCookie: string,
  request: ReturnType<typeof createRequest>,
) {
  const binding = {
    kind: "operation",
    operation: "oidc_group_mapping_create",
    connectionId: CONNECTION_ID,
    request,
  };
  const token = await issueProof(app, sessionCookie, binding);
  return csrfRequest(
    app,
    `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-taskdesk-step-up-token": token,
      },
      body: JSON.stringify(request),
    },
    sessionCookie,
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalEncryptionKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = originalEncryptionKey;
  if (originalPreviousEncryptionKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  else
    process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS =
      originalPreviousEncryptionKey;
});

describe("IP-34 OIDC group mapping administration", () => {
  it("strictly validates targets, binds PA-15 to the exact body, and creates no grant before login", async () => {
    const { personId, sessionCookie } = await setupAdmin();
    await setupConnection();
    const app = createMappingApp();
    const request = createRequest(GROUP_A);
    const invalid = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": "unusable-step-up-token",
        },
        body: JSON.stringify({ ...request, organisationId: "attacker-choice" }),
      },
      sessionCookie,
    );
    expect(invalid.status).toBe(400);

    const tooPowerful = {
      ...request,
      roleId: OVER_CEILING_ROLE_ID,
    };
    const overCeilingChallenge = await csrfRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "oidc_group_mapping_create",
          connectionId: CONNECTION_ID,
          request: tooPowerful,
        }),
      },
      sessionCookie,
    );
    expect(overCeilingChallenge.status).toBe(422);

    const binding = {
      kind: "operation",
      operation: "oidc_group_mapping_create",
      connectionId: CONNECTION_ID,
      request,
    };
    const token = await issueProof(app, sessionCookie, binding);
    const path = `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`;
    const altered = await csrfRequest(
      app,
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({
          ...request,
          externalGroupNameSnapshot: "Changed after proof",
        }),
      },
      sessionCookie,
    );
    expect(altered.status).toBe(403);

    // A wrong body does not consume the proof: the exact authorized body can still commit.
    const exact = await csrfRequest(
      app,
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify(request),
      },
      sessionCookie,
    );
    expect(exact.status).toBe(201);
    const payload = (await exact.json()) as {
      configVersion: number;
      data: {
        externalGroupId: string;
        enabled: boolean;
        externalGroupNameSnapshot: string | null;
      };
    };
    expect(payload.configVersion).toBe(2);
    expect(payload.data).toMatchObject({
      externalGroupId: GROUP_A,
      enabled: true,
      externalGroupNameSnapshot: null,
    });
    const replay = await csrfRequest(
      app,
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify(request),
      },
      sessionCookie,
    );
    expect(replay.status).toBe(409);
    const replayConsume = await db.transaction((tx) =>
      consumeOidcGroupMappingProof(tx, {
        token,
        personId,
        sessionId: `session-${ADMIN_ID}`,
        connectionId: CONNECTION_ID,
        request: {
          ...request,
          externalGroupNameSnapshot: null,
          enabled: true,
        },
        operation: "oidc_group_mapping_create",
      }),
    );
    expect(replayConsume).toBeNull();

    const foreign = await csrfRequest(
      app,
      `${path}/foreign-mapping-id`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": "unusable-step-up-token",
        },
        body: JSON.stringify({ configVersion: 2, enabled: false }),
      },
      sessionCookie,
    );
    expect(foreign.status).toBe(404);

    const listed = await app.request(path, {
      method: "GET",
      headers: { cookie: sessionCookie },
    });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    const listBody = await listed.text();
    expect(listBody).toContain(GROUP_A);
    expect(listBody).not.toContain("test-secret");
    expect(listBody).not.toContain("clientSecret");

    const grants = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        eq(schema.membershipGrantTable.identityConnectionId, CONNECTION_ID),
      );
    expect(grants).toEqual([]);
  });

  it("refuses API-key and impersonation credentials on the admin routes", async () => {
    const { admin } = await setupAdmin();
    await setupConnection();
    const app = createMappingApp();
    const rawKey = `taskdesk_test_${randomUUID()}`;
    const hashedKey = createHash("sha256")
      .update(rawKey)
      .digest()
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: admin.id,
      userId: admin.id,
      key: hashedKey,
      name: "OIDC group mapping credential probe",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const apiKeyRead = await app.request(
      `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
      { headers: { "x-api-key": rawKey } },
    );
    expect(apiKeyRead.status).toBe(403);
    expect(await apiKeyRead.text()).toContain("session_required");
    const apiKeyWrite = await app.request(
      `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
      {
        method: "POST",
        headers: {
          "x-api-key": rawKey,
          "x-taskdesk-step-up-token": "unusable-step-up-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(createRequest(GROUP_A)),
      },
    );
    expect(apiKeyWrite.status).toBe(403);
    expect(await apiKeyWrite.text()).toContain("session_required");

    mockAuthenticatedSession(admin, { impersonatedBy: "acting-admin" });
    const impersonatedRead = await app.request(
      `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
    );
    expect(impersonatedRead.status).toBe(403);
    expect(await impersonatedRead.text()).toContain("session_required");

    const nonAdmin = await setupAdmin("oidc-group-mapping-non-admin", "member");
    mockAuthenticatedSession(nonAdmin.admin);
    const deniedAdminRead = await app.request(
      `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
    );
    expect(deniedAdminRead.status).toBe(403);
    const deniedChallenge = await csrfRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "oidc_group_mapping_create",
          connectionId: CONNECTION_ID,
          request: createRequest(GROUP_A),
        }),
      },
      nonAdmin.sessionCookie,
    );
    expect(deniedChallenge.status).toBe(403);
  });

  it("IP-22 retires only the changed mapping's OIDC grants and reprojects other sources", async () => {
    const { personId, sessionCookie } = await setupAdmin();
    await setupConnection();
    const app = createMappingApp();
    const created = await createMapping(
      app,
      sessionCookie,
      createRequest(GROUP_A),
    );
    expect(created.status).toBe(201);
    const payload = (await created.json()) as {
      data: { id: string };
      configVersion: number;
    };
    const mappingAId = payload.data.id;
    const mappingBId = "oidc-mapping-preserved-row";
    await db.insert(schema.oidcGroupMappingTable).values({
      id: mappingBId,
      identityConnectionId: CONNECTION_ID,
      externalGroupId: GROUP_B,
      roleId: OTHER_ROLE_ID,
      scope: "workspace",
      scopeId: WORKSPACE_ID,
      enabled: true,
    });
    const [identity] = await db
      .insert(schema.externalIdentityTable)
      .values({
        id: "oidc-mapping-test-external-identity",
        identityConnectionId: CONNECTION_ID,
        personId,
        userId: ADMIN_ID,
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        subject: "oidc-mapping-test-subject",
        userNameSnapshot: "mapping-test@example.test",
        emailSnapshot: "mapping-test@example.test",
        active: true,
        provisionedVia: "jit",
      })
      .returning({ id: schema.externalIdentityTable.id });
    if (!identity) throw new Error("OIDC identity fixture was not created");
    await db.insert(schema.membershipGrantTable).values([
      {
        id: "oidc-mapping-direct-grant",
        personId,
        scope: "workspace",
        scopeId: WORKSPACE_ID,
        roleId: DIRECT_ROLE_ID,
        sourceKind: "direct",
        directOrigin: "admin",
        grantedByPersonId: personId,
      },
      {
        id: "oidc-mapping-a-grant",
        personId,
        scope: "workspace",
        scopeId: WORKSPACE_ID,
        roleId: WORKSPACE_ROLE_ID,
        sourceKind: "oidc_group",
        externalIdentityId: identity.id,
        identityConnectionId: CONNECTION_ID,
        oidcGroupMappingId: mappingAId,
      },
      {
        id: "oidc-mapping-b-grant",
        personId,
        scope: "workspace",
        scopeId: WORKSPACE_ID,
        roleId: OTHER_ROLE_ID,
        sourceKind: "oidc_group",
        externalIdentityId: identity.id,
        identityConnectionId: CONNECTION_ID,
        oidcGroupMappingId: mappingBId,
      },
    ]);
    await db.transaction((tx) =>
      projectMembershipKeys(tx, [
        { personId, scope: "workspace", scopeId: WORKSPACE_ID },
      ]),
    );

    const patchRequest = { configVersion: 2, enabled: false };
    const binding = {
      kind: "operation",
      operation: "oidc_group_mapping_update",
      connectionId: CONNECTION_ID,
      mappingId: mappingAId,
      request: patchRequest,
    };
    const token = await issueProof(app, sessionCookie, binding);
    const updated = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings/${mappingAId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify(patchRequest),
      },
      sessionCookie,
    );
    expect(updated.status).toBe(200);
    const grants = await db
      .select({
        id: schema.membershipGrantTable.id,
        sourceKind: schema.membershipGrantTable.sourceKind,
        oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
        revokedAt: schema.membershipGrantTable.revokedAt,
        revocationReason: schema.membershipGrantTable.revocationReason,
      })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.personId, personId))
      .orderBy(schema.membershipGrantTable.id);
    expect(grants).toEqual([
      {
        id: "oidc-mapping-a-grant",
        sourceKind: "oidc_group",
        oidcGroupMappingId: mappingAId,
        revokedAt: expect.any(Date),
        revocationReason: "mapping_changed",
      },
      {
        id: "oidc-mapping-b-grant",
        sourceKind: "oidc_group",
        oidcGroupMappingId: mappingBId,
        revokedAt: null,
        revocationReason: null,
      },
      {
        id: "oidc-mapping-direct-grant",
        sourceKind: "direct",
        oidcGroupMappingId: null,
        revokedAt: null,
        revocationReason: null,
      },
    ]);
    const [membership] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, personId),
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, WORKSPACE_ID),
        ),
      );
    expect(membership?.roleId).toBe(DIRECT_ROLE_ID);
    const events = await db
      .select({ kind: schema.provisioningEventTable.kind })
      .from(schema.provisioningEventTable)
      .where(
        and(
          eq(schema.provisioningEventTable.identityConnectionId, CONNECTION_ID),
          eq(schema.provisioningEventTable.kind, "group.mapping_changed"),
          sql`${schema.provisioningEventTable.detail}->>'mappingId' = ${mappingAId}`,
        ),
      );
    expect(events).toHaveLength(2);
  });

  it("revalidates and updates both target anchors for a grant-empty mapping", async () => {
    const { sessionCookie } = await setupAdmin();
    await setupConnection();
    const internal = await ensureInternalOrganisation();
    const secondWorkspaceId = "oidc-group-mapping-second-workspace";
    const secondRoleId = "oidc-group-mapping-second-workspace-role";
    await db.insert(schema.workspaceTable).values({
      id: secondWorkspaceId,
      organisationId: internal.id,
      name: "OIDC Mapping Second Workspace",
      slug: "oidc-mapping-second-workspace",
      createdAt: new Date(),
    });
    await db.insert(schema.roleTable).values({
      id: secondRoleId,
      scope: "workspace",
      workspaceId: secondWorkspaceId,
      key: "oidc-mapping-second-role",
      name: "OIDC Mapping Second Role",
      rank: 2,
      capabilities: [],
    });
    const app = createMappingApp();
    const created = await createMapping(
      app,
      sessionCookie,
      createRequest(GROUP_A),
    );
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };
    const patchRequest = {
      configVersion: 2,
      scopeId: secondWorkspaceId,
      roleId: secondRoleId,
    };
    const binding = {
      kind: "operation",
      operation: "oidc_group_mapping_update",
      connectionId: CONNECTION_ID,
      mappingId: data.id,
      request: patchRequest,
    };
    const token = await issueProof(app, sessionCookie, binding);
    const updated = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings/${data.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify(patchRequest),
      },
      sessionCookie,
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      configVersion: 3,
      data: { scopeId: secondWorkspaceId, roleId: secondRoleId },
    });
    expect(
      await db
        .select({ id: schema.membershipGrantTable.id })
        .from(schema.membershipGrantTable)
        .where(
          eq(schema.membershipGrantTable.identityConnectionId, CONNECTION_ID),
        ),
    ).toEqual([]);
  });

  it("rechecks admin authority after waiting on the connection closure lock", async () => {
    const { admin, sessionCookie } = await setupAdmin();
    await setupConnection();
    const app = createMappingApp();
    const request = createRequest(GROUP_A);
    const token = await issueProof(app, sessionCookie, {
      kind: "operation",
      operation: "oidc_group_mapping_create",
      connectionId: CONNECTION_ID,
      request,
    });
    const blocker = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await blocker.connect();
    let transactionOpen = false;
    let mutation: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      transactionOpen = true;
      await blocker.query(
        "SELECT id FROM identity_connection WHERE id = $1 FOR UPDATE",
        [CONNECTION_ID],
      );
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = rows[0]?.pid;
      if (blockerPid === undefined)
        throw new Error("Could not read closure lock holder pid");

      mutation = csrfRequest(
        app,
        `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-taskdesk-step-up-token": token,
          },
          body: JSON.stringify(request),
        },
        sessionCookie,
      );
      await waitForBlockedPid(blocker, blockerPid);
      await db
        .update(schema.userTable)
        .set({ role: "member" })
        .where(eq(schema.userTable.id, admin.id));
      await blocker.query("COMMIT");
      transactionOpen = false;
      const response = await mutation;
      expect(response.status).toBe(403);
    } finally {
      if (transactionOpen) await blocker.query("ROLLBACK");
      await blocker.end();
      if (mutation) await mutation.catch(() => undefined);
    }

    const [connection] = await db
      .select({ configVersion: schema.identityConnectionTable.configVersion })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(connection?.configVersion).toBe(1);
    expect(
      await db
        .select({ id: schema.oidcGroupMappingTable.id })
        .from(schema.oidcGroupMappingTable)
        .where(
          eq(schema.oidcGroupMappingTable.identityConnectionId, CONNECTION_ID),
        ),
    ).toEqual([]);
    const tokenHash = createHash("sha256")
      .update(Buffer.from(token, "base64url"))
      .digest();
    const [proof] = await db
      .select({
        state: schema.stepUpConfirmationTable.state,
        consumedAt: schema.stepUpConfirmationTable.consumedAt,
      })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.tokenHash, tokenHash));
    expect(proof).toEqual({ state: "issued", consumedAt: null });
    expect(
      await db
        .select({ id: schema.provisioningEventTable.id })
        .from(schema.provisioningEventTable)
        .where(
          eq(schema.provisioningEventTable.identityConnectionId, CONNECTION_ID),
        ),
    ).toEqual([]);
  });

  it("IP-34 parent config CAS allows exactly one concurrent same-version create", async () => {
    const first = await setupAdmin();
    const second = await setupAdmin(SECOND_ADMIN_ID);
    await setupConnection();
    const now = new Date();
    vi.spyOn(auth.api, "getSession").mockImplementation(async (options) => {
      const cookie = new Headers(options?.headers).get("cookie") ?? "";
      const secondSession = cookie.includes(`token-${SECOND_ADMIN_ID}`);
      const selected = secondSession ? second : first;
      return {
        session: {
          id: `session-${selected.admin.id}`,
          token: `token-${selected.admin.id}`,
          userId: selected.admin.id,
          portal: "agent",
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: null,
        },
        user: { ...selected.admin, twoFactorEnabled: false },
      } as Awaited<ReturnType<typeof auth.api.getSession>>;
    });
    const app = createMappingApp();
    const requestB = createRequest(GROUP_B);
    const requestC = createRequest(GROUP_C);
    const tokenB = await issueProof(app, first.sessionCookie, {
      kind: "operation",
      operation: "oidc_group_mapping_create",
      connectionId: CONNECTION_ID,
      request: requestB,
    });
    const tokenC = await issueProof(app, second.sessionCookie, {
      kind: "operation",
      operation: "oidc_group_mapping_create",
      connectionId: CONNECTION_ID,
      request: requestC,
    });
    const create = (request: ReturnType<typeof createRequest>, token: string) =>
      csrfRequest(
        app,
        `/api/instance/identity-connections/${CONNECTION_ID}/oidc-group-mappings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-taskdesk-step-up-token": token,
          },
          body: JSON.stringify(request),
        },
        request === requestB ? first.sessionCookie : second.sessionCookie,
      );
    const responses = await Promise.all([
      create(requestB, tokenB),
      create(requestC, tokenC),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const [connection] = await db
      .select({ configVersion: schema.identityConnectionTable.configVersion })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(connection?.configVersion).toBe(2);
    const mappings = await db
      .select({ externalGroupId: schema.oidcGroupMappingTable.externalGroupId })
      .from(schema.oidcGroupMappingTable)
      .where(
        eq(schema.oidcGroupMappingTable.identityConnectionId, CONNECTION_ID),
      );
    expect(mappings).toHaveLength(1);
  });
});
