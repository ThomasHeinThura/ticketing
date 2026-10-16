import { BUILT_IN_ROLES, defaultRolePayloads } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { identityAccountId } from "../../../apps/api/src/identity/oidc-login";
import { validateEntraIdToken } from "../../../apps/api/src/identity/oidc-token";
import { createApp } from "../../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "../helpers/csrf";
import { resetTestDatabase } from "../helpers/database";

vi.mock("../../../apps/api/src/identity/oidc-provider", async (original) => {
  const actual =
    await original<
      typeof import("../../../apps/api/src/identity/oidc-provider")
    >();
  return {
    ...actual,
    loadEntraDiscovery: vi.fn(async (tenantId: string) => ({
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorizationEndpoint:
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenEndpoint:
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    })),
    exchangeEntraCode: vi.fn(async () => ({ idToken: "opaque-test-id-token" })),
    loadEntraJwks: vi.fn(async () => ({ keys: [] })),
  };
});

vi.mock("../../../apps/api/src/identity/oidc-token", async (original) => {
  const actual =
    await original<
      typeof import("../../../apps/api/src/identity/oidc-token")
    >();
  return {
    ...actual,
    validateEntraIdToken: vi.fn(
      (
        _token: string,
        _jwks: unknown,
        expectation: { issuer: string; tenantId: string },
      ) => ({
        ok: true as const,
        claims: {
          iss: expectation.issuer,
          tid: expectation.tenantId,
          oid: "jit-first-login-subject",
          email: "jit-first-login@example.test",
          email_verified: true,
          name: "JIT First Login",
          acct: 0,
          roles: ["TaskDesk.User"],
        },
      }),
    ),
  };
});

const ENCRYPTION_KEY = "e5".repeat(32);
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const SUBJECT = "jit-first-login-subject";
const WORKSPACE_ID = "jit-login-workspace";
const AGENT_ROLE_ID = "jit-login-agent-role";
const CUSTOMER_ORG_ID = "jit-login-customer-org";
const CUSTOMER_ROLE_ID = "jit-login-customer-role";
const PORTAL_HOST = "portal.localhost:5174";

function resetEntraTokenValidatorMock() {
  vi.mocked(validateEntraIdToken).mockImplementation(
    (_token, _jwks, expectation) => ({
      ok: true,
      claims: {
        iss: expectation.issuer,
        tid: expectation.tenantId,
        oid: SUBJECT,
        email: "jit-first-login@example.test",
        email_verified: true,
        name: "JIT First Login",
        acct: 0,
        roles: ["TaskDesk.User"],
      },
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  // The setup's restoreAllMocks does not reset this module-level vi.fn implementation.
  resetEntraTokenValidatorMock();
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
});

async function creator(organisationId: string, suffix = "") {
  const id = suffix ? `jit-login-creator-${suffix}` : "jit-login-creator";
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: "Creator",
      email: suffix
        ? `jit-creator-${suffix}@example.test`
        : "jit-creator@example.test",
    })
    .returning();
  const [person] = await db
    .insert(schema.personTable)
    .values({ userId: user?.id, organisationId, side: "staff" })
    .returning();
  if (!person) throw new Error("creator fixture missing");
  return person.id;
}

async function seedAgent(connectionId: string) {
  const internal = await ensureInternalOrganisation();
  await db.insert(schema.workspaceTable).values({
    id: WORKSPACE_ID,
    organisationId: internal.id,
    name: "JIT Workspace",
    slug: "jit-login-workspace",
    createdAt: new Date(),
  });
  await db.insert(schema.roleTable).values({
    id: AGENT_ROLE_ID,
    scope: "workspace",
    workspaceId: WORKSPACE_ID,
    key: "jit-login-member",
    name: "JIT Member",
    rank: 2,
    capabilities: [],
  });
  const createdBy = await creator(internal.id);
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: WORKSPACE_ID,
    displayName: "JIT agent",
    issuer: ISSUER,
    tenantId: TENANT_ID,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: encryptIdentityClientSecret(connectionId, "stored-secret"),
    redirectUri: `http://localhost:1337/api/auth/identity/${connectionId}/callback`,
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: [],
    jitPolicy: {
      enabled: true,
      default_role_id: AGENT_ROLE_ID,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: 5,
    enabled: true,
    createdBy,
    updatedBy: createdBy,
  });
  return {
    scope: "workspace" as const,
    scopeId: WORKSPACE_ID,
    roleId: AGENT_ROLE_ID,
  };
}

async function ensureCanonicalCustomerRole() {
  const matches = await db
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, BUILT_IN_ROLES.customer.scope),
        eq(schema.roleTable.key, BUILT_IN_ROLES.customer.key),
        isNull(schema.roleTable.workspaceId),
      ),
    )
    .limit(2);
  if (matches.length > 1)
    throw new Error("customer built-in role is ambiguous");
  const current = matches[0];
  if (current) {
    if (
      current.scope !== BUILT_IN_ROLES.customer.scope ||
      current.workspaceId !== null ||
      current.key !== BUILT_IN_ROLES.customer.key ||
      current.rank !== BUILT_IN_ROLES.customer.rank ||
      JSON.stringify(current.capabilities) !==
        JSON.stringify(BUILT_IN_ROLES.customer.capabilities) ||
      current.isSystem !== true ||
      current.isEditable !== false
    )
      throw new Error("existing customer built-in role is not canonical");
    return current.id;
  }
  const [created] = await db
    .insert(schema.roleTable)
    .values({
      id: CUSTOMER_ROLE_ID,
      scope: BUILT_IN_ROLES.customer.scope,
      workspaceId: null,
      key: BUILT_IN_ROLES.customer.key,
      name: "Customer",
      rank: BUILT_IN_ROLES.customer.rank,
      capabilities: [...BUILT_IN_ROLES.customer.capabilities],
      isSystem: true,
      isEditable: false,
    })
    .returning();
  if (!created) throw new Error("customer built-in role insert failed");
  return created.id;
}

async function seedCustomer(connectionId: string, suffix?: string) {
  const organisationId = suffix
    ? `${CUSTOMER_ORG_ID}-${suffix}`
    : CUSTOMER_ORG_ID;
  const roleId = await ensureCanonicalCustomerRole();
  const internal = await ensureInternalOrganisation();
  await db.insert(schema.organisationTable).values({
    id: organisationId,
    key: `jit-login-customer${suffix ? `-${suffix}` : ""}`,
    name: "JIT Customer",
    isInternal: false,
    portalAccess: true,
  });
  const createdBy = await creator(internal.id, suffix ?? "");
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "customer",
    organisationId,
    defaultWorkspaceId: null,
    displayName: "JIT customer",
    issuer: ISSUER,
    tenantId: TENANT_ID,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: encryptIdentityClientSecret(connectionId, "stored-secret"),
    redirectUri: `http://${PORTAL_HOST}/api/auth/identity/${connectionId}/callback`,
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: [],
    jitPolicy: {
      enabled: true,
      default_role_id: roleId,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: null,
    enabled: true,
    createdBy,
    updatedBy: createdBy,
  });
  return {
    scope: "organisation" as const,
    scopeId: organisationId,
    roleId,
  };
}

async function signIn(connectionId: string, portal: "agent" | "customer") {
  const app = createApp().app;
  const base = portal === "agent" ? "" : `http://${PORTAL_HOST}`;
  const headers: Record<string, string> =
    portal === "agent" ? {} : { host: PORTAL_HOST };
  const start = await app.request(
    `${base}/api/auth/identity/${connectionId}/start`,
    { method: "GET", headers, redirect: "manual" },
  );
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  const stateCookie = start.headers
    .get("set-cookie")
    ?.match(/(?:^|;\s*)tdk_oidc_state=([^;]+)/u)?.[1];
  expect(state).toBeTruthy();
  return app.request(
    `${base}/api/auth/identity/${connectionId}/callback?code=single-use-test-code&state=${encodeURIComponent(state ?? "")}`,
    {
      method: "GET",
      headers: { ...headers, cookie: `tdk_oidc_state=${stateCookie}` },
      redirect: "manual",
    },
  );
}

async function expectJitIdentity(
  connectionId: string,
  portal: "agent" | "customer",
  target: {
    scope: "workspace" | "organisation";
    scopeId: string;
    roleId: string;
  },
  expectedSubject = SUBJECT,
) {
  const [identity] = await db
    .select()
    .from(schema.externalIdentityTable)
    .where(eq(schema.externalIdentityTable.identityConnectionId, connectionId));
  expect(identity).toMatchObject({
    issuer: ISSUER,
    subject: expectedSubject,
    provisionedVia: "jit",
    active: true,
  });
  const [person] = await db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.id, identity?.personId ?? ""));
  expect(person).toMatchObject({
    side: portal === "agent" ? "staff" : "customer",
    active: true,
    isPlaceholder: false,
    userId: identity?.userId,
  });
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.userId, identity?.userId ?? ""));
  expect(account?.providerId).toBe(`taskdesk-entra:${connectionId}`);
  expect(account?.accountId).toBe(identityAccountId(ISSUER, expectedSubject));
  expect(account?.accountId).not.toContain("\u0000");
  const [grant] = await db
    .select()
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, identity?.personId ?? ""),
        eq(schema.membershipGrantTable.sourceKind, "jit_default"),
      ),
    );
  expect(grant).toMatchObject({
    scope: target.scope,
    scopeId: target.scopeId,
    roleId: target.roleId,
    seesAll: false,
    revokedAt: null,
  });
  const [membership] = await db
    .select()
    .from(schema.membershipTable)
    .where(eq(schema.membershipTable.personId, identity?.personId ?? ""));
  expect(membership).toMatchObject({
    scope: target.scope,
    scopeId: target.scopeId,
    roleId: target.roleId,
    seesAll: false,
  });
  const sessions = await db
    .select({
      source: schema.sessionTable.identityConnectionId,
      portal: schema.sessionTable.portal,
    })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, identity?.userId ?? ""));
  expect(sessions).toEqual([{ source: connectionId, portal }]);
}

describe("OIDC JIT first login (IP-9, IP-10)", () => {
  it("creates the user, person, account, identity and default grant for an agent", async () => {
    const target = await seedAgent("jit-agent-connection");
    const response = await signIn("jit-agent-connection", "agent");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/agent");
    await expectJitIdentity("jit-agent-connection", "agent", target);
  });

  it("creates the user, person, account, identity and customer grant for a customer", async () => {
    const target = await seedCustomer("jit-customer-connection");
    const response = await signIn("jit-customer-connection", "customer");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    await expectJitIdentity("jit-customer-connection", "customer", target);
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("__Host-tdk_portal_session=")),
    ).toBe(true);
  });

  it("refuses JIT customer admission when its configured customer role is tampered", async () => {
    const attemptConnectionId = "jit-tampered-customer-role-connection";
    const attemptedSubject = "jit-tampered-customer-subject";
    const unrelatedTarget = await seedCustomer(
      "jit-unrelated-customer-session-connection",
    );
    const unrelatedResponse = await signIn(
      "jit-unrelated-customer-session-connection",
      "customer",
    );
    expect(unrelatedResponse.status).toBe(302);
    await expectJitIdentity(
      "jit-unrelated-customer-session-connection",
      "customer",
      unrelatedTarget,
    );
    const unrelatedIdentity = await db.query.externalIdentityTable.findFirst({
      where: eq(
        schema.externalIdentityTable.identityConnectionId,
        "jit-unrelated-customer-session-connection",
      ),
    });
    expect(unrelatedIdentity?.userId).toBeTruthy();

    const target = await seedCustomer(attemptConnectionId, "tampered");
    // The built-in customer role is global for (scope, null workspace, key), so both
    // connections intentionally share it. The unrelated session below is only checked for
    // persistence after tampering; this does not claim the now-tampered role remains usable.
    expect(target.roleId).toBe(unrelatedTarget.roleId);
    vi.mocked(validateEntraIdToken).mockImplementation(
      (_token, _jwks, expectation) => ({
        ok: true,
        claims: {
          iss: expectation.issuer,
          tid: expectation.tenantId,
          oid: attemptedSubject,
          email: "jit-tampered-customer@example.test",
          email_verified: true,
          name: "Tampered Customer",
          acct: 0,
          roles: ["TaskDesk.User"],
        },
      }),
    );
    const initialResponse = await signIn(attemptConnectionId, "customer");
    expect(initialResponse.status).toBe(302);
    await expectJitIdentity(
      attemptConnectionId,
      "customer",
      target,
      attemptedSubject,
    );
    const attemptedIdentity = await db.query.externalIdentityTable.findFirst({
      where: and(
        eq(
          schema.externalIdentityTable.identityConnectionId,
          attemptConnectionId,
        ),
        eq(schema.externalIdentityTable.subject, attemptedSubject),
      ),
    });
    expect(attemptedIdentity?.userId).toBeTruthy();
    expect(attemptedIdentity?.userId).not.toBe(unrelatedIdentity?.userId);
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, attemptedIdentity?.userId ?? ""));
    expect(
      await db.query.sessionTable.findFirst({
        where: eq(schema.sessionTable.userId, attemptedIdentity?.userId ?? ""),
      }),
    ).toBeUndefined();

    await db
      .update(schema.roleTable)
      .set({
        rank: 0,
        capabilities: [],
        isSystem: false,
        isEditable: true,
      })
      .where(eq(schema.roleTable.id, target.roleId));
    expect(
      await db.query.roleTable.findFirst({
        where: eq(schema.roleTable.id, target.roleId),
      }),
    ).toMatchObject({
      rank: 0,
      capabilities: [],
      isSystem: false,
      isEditable: true,
    });
    vi.mocked(validateEntraIdToken).mockClear();

    const response = await signIn(attemptConnectionId, "customer");
    expect(response.headers.get("location")).toContain("identity_error");
    expect(validateEntraIdToken).toHaveBeenCalled();
    expect(
      await db.query.roleTable.findFirst({
        where: eq(schema.roleTable.id, target.roleId),
      }),
    ).toMatchObject({
      rank: 0,
      capabilities: [],
      isSystem: false,
      isEditable: true,
    });
    expect(
      await db.query.externalIdentityTable.findFirst({
        where: and(
          eq(
            schema.externalIdentityTable.identityConnectionId,
            attemptConnectionId,
          ),
          eq(schema.externalIdentityTable.subject, attemptedSubject),
        ),
      }),
    ).toMatchObject({
      userId: attemptedIdentity?.userId,
      subject: attemptedSubject,
    });
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("__Host-tdk_portal_session=")),
    ).toBe(false);
    expect(
      await db.query.sessionTable.findFirst({
        where: and(
          eq(schema.sessionTable.portal, "customer"),
          eq(schema.sessionTable.userId, attemptedIdentity?.userId ?? ""),
        ),
      }),
    ).toBeUndefined();
    expect(
      await db.query.sessionTable.findFirst({
        where: and(
          eq(schema.sessionTable.portal, "customer"),
          eq(schema.sessionTable.userId, unrelatedIdentity?.userId ?? ""),
        ),
      }),
    ).toMatchObject({
      userId: unrelatedIdentity?.userId,
      portal: "customer",
    });
    const [targetPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, attemptedIdentity?.userId ?? ""));
    const [unrelatedPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, unrelatedIdentity?.userId ?? ""));
    const [retiredTargetGrant] = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, targetPerson?.id ?? ""),
          eq(schema.membershipGrantTable.sourceKind, "jit_default"),
        ),
      );
    expect(retiredTargetGrant).toMatchObject({
      roleId: target.roleId,
      revokedAt: expect.any(Date),
      revocationReason: "mapping_changed",
    });
    const [unrelatedGrant] = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, unrelatedPerson?.id ?? ""),
          eq(schema.membershipGrantTable.sourceKind, "jit_default"),
        ),
      );
    expect(unrelatedGrant).toMatchObject({
      roleId: unrelatedTarget.roleId,
      revokedAt: null,
    });
  });

  it("resets the OIDC validator's default principal between tests", () => {
    expect(
      validateEntraIdToken("opaque-test-id-token", null, {
        issuer: ISSUER,
        tenantId: TENANT_ID,
        clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        nonce: "fixture-nonce",
      }),
    ).toMatchObject({
      ok: true,
      claims: {
        oid: SUBJECT,
        email: "jit-first-login@example.test",
        roles: ["TaskDesk.User"],
      },
    });
  });

  it("denies mixed native/projected view admission and retires the OIDC grant on failed admission", async () => {
    const connectionId = "jit-admission-retention-connection";
    const target = await seedAgent(connectionId);
    await db
      .update(schema.roleTable)
      .set({ capabilities: [...BUILT_IN_ROLES.manager.capabilities] })
      .where(eq(schema.roleTable.id, AGENT_ROLE_ID));
    const admitted = await signIn(connectionId, "agent");
    expect(admitted.status).toBe(302);
    await expectJitIdentity(connectionId, "agent", target);
    const sessionCookie = admitted.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-tdk_agent_session="))
      ?.split(";", 1)[0];
    expect(sessionCookie).toBeTruthy();

    const [identity] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
      );
    expect(identity?.userId).toBeTruthy();
    expect(identity?.personId).toBeTruthy();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: WORKSPACE_ID,
      role: "member",
      permission: JSON.stringify(defaultRolePayloads.member),
      isSystem: true,
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: WORKSPACE_ID,
      userId: identity?.userId ?? "missing-oidc-user",
      role: "member",
      joinedAt: new Date(),
    });
    const viewOwner = await db.query.personTable.findFirst({
      where: eq(schema.personTable.userId, "jit-login-creator"),
    });
    expect(viewOwner?.id).toBeTruthy();
    await db.insert(schema.savedViewTable).values({
      id: "oidc-admission-retention-view",
      workspaceId: WORKSPACE_ID,
      createdBy: viewOwner?.id ?? "missing-view-owner",
      name: "OIDC admission retention",
      scope: "workspace",
      scopeId: WORKSPACE_ID,
      visibility: "private",
      query: { entity: "work_item" },
      layout: "list",
    });

    const { app } = createApp();
    const deleteResponse = await csrfRequest(
      app,
      "/api/views/oidc-admission-retention-view",
      { method: "DELETE" },
      sessionCookie ?? "",
    );
    expect(deleteResponse.status, await deleteResponse.clone().text()).toBe(
      403,
    );
    expect(await db.query.pendingActionTable.findFirst()).toBeUndefined();
    expect(
      await db.query.outboxTable.findFirst({
        where: eq(schema.outboxTable.kind, "pending_action.requested"),
      }),
    ).toBeUndefined();
    expect(
      await db.query.auditLogTable.findFirst({
        where: eq(schema.auditLogTable.action, "pending_action.requested"),
      }),
    ).toBeUndefined();
    const originalSession = await db.query.sessionTable.findFirst({
      where: eq(schema.sessionTable.userId, identity?.userId ?? ""),
    });
    expect(originalSession?.id).toBeTruthy();
    const viewRow = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, "oidc-admission-retention-view"),
    });
    expect(viewRow?.createdBy).toBe(viewOwner?.id);

    vi.mocked(validateEntraIdToken).mockImplementation(
      (_token, _jwks, expectation) => ({
        ok: true,
        claims: {
          iss: expectation.issuer,
          tid: expectation.tenantId,
          oid: SUBJECT,
          email: "jit-first-login@example.test",
          email_verified: true,
          name: "JIT First Login",
          acct: 0,
          roles: [],
        },
      }),
    );
    const refused = await signIn(connectionId, "agent");
    expect(refused.headers.get("location")).toContain("identity_error");

    const [admissionFailure] = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(
        and(
          eq(schema.provisioningEventTable.identityConnectionId, connectionId),
          eq(schema.provisioningEventTable.kind, "auth.failed"),
        ),
      );
    expect(admissionFailure?.detail).toMatchObject({
      reason: "admission_failed",
    });
    const [grant] = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, identity?.personId ?? ""),
          eq(schema.membershipGrantTable.sourceKind, "jit_default"),
        ),
      );
    expect(grant).toMatchObject({
      revocationReason: "admission_failed",
      revokedAt: expect.any(Date),
    });
    const [identityAfterFailure] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
      );
    expect(identityAfterFailure).toMatchObject({
      id: identity?.id,
      userId: identity?.userId,
      issuer: ISSUER,
      subject: SUBJECT,
    });
    const [accountAfterFailure] = await db
      .select()
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, identity?.userId ?? ""));
    expect(accountAfterFailure?.accountId).toBe(
      identityAccountId(ISSUER, SUBJECT),
    );
    expect(
      await db.query.workspaceUserTable.findFirst({
        where: and(
          eq(schema.workspaceUserTable.workspaceId, WORKSPACE_ID),
          eq(schema.workspaceUserTable.userId, identity?.userId ?? ""),
        ),
      }),
    ).toMatchObject({ role: "member" });
    expect(
      await db.query.sessionTable.findFirst({
        where: eq(schema.sessionTable.id, originalSession?.id ?? ""),
      }),
    ).toBeDefined();
    expect(await db.query.pendingActionTable.findFirst()).toBeUndefined();
    expect(
      await db.query.outboxTable.findFirst({
        where: eq(schema.outboxTable.kind, "pending_action.decided"),
      }),
    ).toBeUndefined();
    expect(
      await db.query.auditLogTable.findFirst({
        where: eq(schema.auditLogTable.action, "pending_action.decided"),
      }),
    ).toBeUndefined();

    vi.mocked(validateEntraIdToken).mockImplementation(
      (_token, _jwks, expectation) => ({
        ok: true,
        claims: {
          iss: expectation.issuer,
          tid: expectation.tenantId,
          oid: SUBJECT,
          email: "jit-first-login@example.test",
          email_verified: true,
          name: "JIT First Login",
          acct: 0,
          roles: ["TaskDesk.User"],
        },
      }),
    );
    const restored = await signIn(connectionId, "agent");
    expect(restored.status).toBe(302);
    expect(await db.query.pendingActionTable.findFirst()).toBeUndefined();
  });
});

async function addAgentConnection(
  connectionId: string,
  options: { jit: boolean },
) {
  const tenantId = TENANT_ID;
  const [creatorPerson] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, "jit-login-creator"));
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: WORKSPACE_ID,
    displayName: connectionId,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    tenantId,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: encryptIdentityClientSecret(connectionId, "stored-secret"),
    redirectUri: `http://localhost:1337/api/auth/identity/${connectionId}/callback`,
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: [],
    jitPolicy: {
      enabled: options.jit,
      default_role_id: options.jit ? AGENT_ROLE_ID : null,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: 5,
    enabled: true,
    createdBy: creatorPerson?.id,
    updatedBy: creatorPerson?.id,
  });
}

/** What SCIM `POST /Users` leaves behind: a placeholder person and a user-less identity. */
async function scimIdentity(input: {
  connectionId: string;
  organisationId: string;
  side: "staff" | "customer";
  subject?: string;
  issuer?: string;
  email?: string;
  active?: boolean;
}) {
  const [person] = await db
    .insert(schema.personTable)
    .values({
      organisationId: input.organisationId,
      side: input.side,
      active: input.active ?? true,
      isPlaceholder: true,
      userId: null,
    })
    .returning();
  if (!person) throw new Error("SCIM person fixture missing");
  const [identity] = await db
    .insert(schema.externalIdentityTable)
    .values({
      identityConnectionId: input.connectionId,
      personId: person.id,
      userId: null,
      issuer: input.issuer ?? ISSUER,
      subject: input.subject ?? SUBJECT,
      userNameSnapshot: input.email ?? "scim-user@example.test",
      emailSnapshot: input.email ?? "scim-user@example.test",
      active: input.active ?? true,
      provisionedVia: "scim",
    })
    .returning();
  if (!identity) throw new Error("SCIM identity fixture missing");
  return { person, identity };
}

const loginEmail = "jit-first-login@example.test";

async function personById(id: string) {
  const [row] = await db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.id, id));
  return row;
}

describe("first OIDC login of a SCIM-provisioned identity (IP-19, IP-30)", () => {
  it("links the user-less identity by exact connection and subject, clears the placeholder, then logs in normally (agent)", async () => {
    await seedAgent("scim-agent-connection");
    const internal = await ensureInternalOrganisation();
    const { person, identity } = await scimIdentity({
      connectionId: "scim-agent-connection",
      organisationId: internal.id,
      side: "staff",
    });

    const first = await signIn("scim-agent-connection", "agent");
    expect(first.headers.get("location")).toContain("/agent");

    const [linkedIdentity] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, identity.id));
    expect(linkedIdentity?.userId).toBeTruthy();
    const linkedPerson = await personById(person.id);
    expect(linkedPerson).toMatchObject({
      userId: linkedIdentity?.userId,
      isPlaceholder: false,
      active: true,
    });
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, linkedIdentity?.userId ?? ""));
    expect(user?.email).toBe(loginEmail);
    const accounts = await db
      .select()
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, user?.id ?? ""));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.accountId).toBe(identityAccountId(ISSUER, SUBJECT));
    expect(accounts[0]?.providerId).toBe(
      "taskdesk-entra:scim-agent-connection",
    );
    // No second person or identity was created for this subject.
    expect(
      await db
        .select()
        .from(schema.externalIdentityTable)
        .where(eq(schema.externalIdentityTable.subject, SUBJECT)),
    ).toHaveLength(1);

    const second = await signIn("scim-agent-connection", "agent");
    expect(second.headers.get("location")).toContain("/agent");
    expect(await db.select().from(schema.userTable)).toHaveLength(
      2, // the fixture creator plus the linked user
    );
    expect(
      await db
        .select()
        .from(schema.accountTable)
        .where(eq(schema.accountTable.userId, user?.id ?? "")),
    ).toHaveLength(1);
  });

  it("does not link or claim anything when the same subject exists only on a different connection", async () => {
    await seedAgent("scim-owner-connection");
    await addAgentConnection("scim-other-connection", { jit: false });
    const internal = await ensureInternalOrganisation();
    const { person, identity } = await scimIdentity({
      connectionId: "scim-owner-connection",
      organisationId: internal.id,
      side: "staff",
    });

    const refused = await signIn("scim-other-connection", "agent");
    expect(refused.headers.get("location")).toContain("identity_error");
    const untouched = await personById(person.id);
    expect(untouched).toMatchObject({ userId: null, isPlaceholder: true });
    const [stillUnlinked] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, identity.id));
    expect(stillUnlinked?.userId).toBeNull();
    expect(await db.select().from(schema.userTable)).toHaveLength(1);
  });

  it("never claims a placeholder by email without a subject match", async () => {
    await seedAgent("scim-email-connection");
    const internal = await ensureInternalOrganisation();
    const { person, identity } = await scimIdentity({
      connectionId: "scim-email-connection",
      organisationId: internal.id,
      side: "staff",
      subject: "a-different-subject",
      email: loginEmail,
    });

    // JIT is enabled on this connection: the login becomes a separate JIT identity and the
    // placeholder that merely shares the address stays unclaimed.
    const response = await signIn("scim-email-connection", "agent");
    expect(response.headers.get("location")).toContain("/agent");
    const untouched = await personById(person.id);
    expect(untouched).toMatchObject({ userId: null, isPlaceholder: true });
    const [unlinked] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, identity.id));
    expect(unlinked?.userId).toBeNull();
    const jit = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.subject, SUBJECT));
    expect(jit).toHaveLength(1);
    expect(jit[0]?.personId).not.toBe(person.id);
    expect(jit[0]?.provisionedVia).toBe("jit");
  });

  it("refuses an email-only match when JIT is disabled", async () => {
    await seedAgent("scim-email-nojit-connection");
    await db
      .update(schema.identityConnectionTable)
      .set({
        jitPolicy: {
          enabled: false,
          default_role_id: null,
          required_entra_app_role: "TaskDesk.User",
        },
      })
      .where(
        eq(schema.identityConnectionTable.id, "scim-email-nojit-connection"),
      );
    const internal = await ensureInternalOrganisation();
    const { person } = await scimIdentity({
      connectionId: "scim-email-nojit-connection",
      organisationId: internal.id,
      side: "staff",
      subject: "a-different-subject",
      email: loginEmail,
    });
    const response = await signIn("scim-email-nojit-connection", "agent");
    expect(response.headers.get("location")).toContain("identity_error");
    expect(await personById(person.id)).toMatchObject({
      userId: null,
      isPlaceholder: true,
    });
    expect(await db.select().from(schema.userTable)).toHaveLength(1);
  });

  it("cannot activate a deprovisioned or inactive SCIM identity by logging in", async () => {
    await seedAgent("scim-inactive-connection");
    const internal = await ensureInternalOrganisation();
    const deprovisioned = await scimIdentity({
      connectionId: "scim-inactive-connection",
      organisationId: internal.id,
      side: "staff",
      active: false,
    });
    const refused = await signIn("scim-inactive-connection", "agent");
    expect(refused.headers.get("location")).toContain("identity_error");
    expect(await personById(deprovisioned.person.id)).toMatchObject({
      userId: null,
      isPlaceholder: true,
      active: false,
    });
    expect(await db.select().from(schema.userTable)).toHaveLength(1);

    // An active identity whose person was deactivated is refused the same way.
    await db
      .update(schema.externalIdentityTable)
      .set({ active: true })
      .where(eq(schema.externalIdentityTable.id, deprovisioned.identity.id));
    const stillRefused = await signIn("scim-inactive-connection", "agent");
    expect(stillRefused.headers.get("location")).toContain("identity_error");
    expect(await db.select().from(schema.userTable)).toHaveLength(1);
  });

  it("links a SCIM-provisioned customer identity through the customer portal", async () => {
    await seedCustomer("scim-customer-connection");
    const { person, identity } = await scimIdentity({
      connectionId: "scim-customer-connection",
      organisationId: CUSTOMER_ORG_ID,
      side: "customer",
    });
    const response = await signIn("scim-customer-connection", "customer");
    expect(response.headers.get("location")).toBe("/");
    const [linked] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, identity.id));
    expect(linked?.userId).toBeTruthy();
    expect(await personById(person.id)).toMatchObject({
      userId: linked?.userId,
      isPlaceholder: false,
      side: "customer",
      organisationId: CUSTOMER_ORG_ID,
    });
  });

  it("refuses a customer identity whose person belongs to another organisation", async () => {
    await seedCustomer("scim-customer-mismatch-connection");
    const internal = await ensureInternalOrganisation();
    const { person } = await scimIdentity({
      connectionId: "scim-customer-mismatch-connection",
      organisationId: internal.id,
      side: "staff",
    });
    const response = await signIn(
      "scim-customer-mismatch-connection",
      "customer",
    );
    expect(response.headers.get("location")).toContain("identity_error");
    expect(await personById(person.id)).toMatchObject({
      userId: null,
      isPlaceholder: true,
    });
  });
});
