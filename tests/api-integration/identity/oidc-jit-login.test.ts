import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { identityAccountId } from "../../../apps/api/src/identity/oidc-login";
import { createApp } from "../../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";
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

beforeEach(async () => {
  vi.clearAllMocks();
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
});

async function creator(organisationId: string) {
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: "jit-login-creator",
      name: "Creator",
      email: "jit-creator@example.test",
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

async function seedCustomer(connectionId: string) {
  const internal = await ensureInternalOrganisation();
  await db.insert(schema.organisationTable).values({
    id: CUSTOMER_ORG_ID,
    key: "jit-login-customer",
    name: "JIT Customer",
    isInternal: false,
    portalAccess: true,
  });
  await db.insert(schema.roleTable).values({
    id: CUSTOMER_ROLE_ID,
    scope: "organisation",
    workspaceId: null,
    key: "customer",
    name: "Customer",
    rank: 0,
    capabilities: [],
  });
  const createdBy = await creator(internal.id);
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "customer",
    organisationId: CUSTOMER_ORG_ID,
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
      default_role_id: CUSTOMER_ROLE_ID,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: null,
    enabled: true,
    createdBy,
    updatedBy: createdBy,
  });
  return {
    scope: "organisation" as const,
    scopeId: CUSTOMER_ORG_ID,
    roleId: CUSTOMER_ROLE_ID,
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
) {
  const [identity] = await db
    .select()
    .from(schema.externalIdentityTable)
    .where(eq(schema.externalIdentityTable.identityConnectionId, connectionId));
  expect(identity).toMatchObject({
    issuer: ISSUER,
    subject: SUBJECT,
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
  expect(account?.accountId).toBe(identityAccountId(ISSUER, SUBJECT));
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
  });
});
