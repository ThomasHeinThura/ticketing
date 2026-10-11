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
