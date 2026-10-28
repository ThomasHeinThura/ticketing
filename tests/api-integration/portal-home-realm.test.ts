import { count, eq } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp } from "../../apps/api/src/index";
import * as observabilityRuntime from "../../apps/api/src/instance/observability/runtime";
import { resetTestDatabase } from "./helpers/database";

vi.mock("../../apps/api/src/identity/oidc-provider", async (original) => {
  const actual =
    await original<
      typeof import("../../apps/api/src/identity/oidc-provider")
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
  };
});

const PORTAL_HOST = "portal.localhost";
const AGENT_HOST = "ticketing.localhost";
const ORG_ID = "home-realm-customer-org";
const CONNECTION_ID = "home-realm-customer-connection";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const ENCRYPTION_KEY = "d4".repeat(32);
const oldPortalUrl = process.env.TASKDESK_PORTAL_URL;
const oldAgentUrl = process.env.TASKDESK_AGENT_URL;
const oldEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;

async function countRows(table: AnyPgTable) {
  const [row] = await db.select({ count: count() }).from(table);
  return Number(row?.count ?? 0);
}

async function seedCustomerConnection(input: {
  id?: string;
  domain?: string;
  enabled?: boolean;
}) {
  const id = input.id ?? CONNECTION_ID;
  const domain = input.domain ?? "example.test";
  await db.insert(schema.organisationTable).values({
    id: input.id ? `${ORG_ID}-${input.id}` : ORG_ID,
    key: input.id ? `home-realm-${input.id}` : "home-realm-customer",
    name: "Home Realm Customer",
    isInternal: false,
    portalAccess: true,
    active: true,
  });
  await db.insert(schema.identityConnectionTable).values({
    id,
    providerType: "entra",
    portalScope: "customer",
    organisationId: input.id ? `${ORG_ID}-${input.id}` : ORG_ID,
    defaultWorkspaceId: null,
    displayName: "Home Realm Customer IdP",
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tenantId: TENANT_ID,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: encryptIdentityClientSecret(id, "test-only-secret"),
    redirectUri: `https://${PORTAL_HOST}/api/auth/identity/${id}/callback`,
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: [domain],
    jitPolicy: {
      enabled: true,
      default_role_id: null,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: null,
    enabled: input.enabled ?? true,
  });
}

beforeEach(async () => {
  await resetTestDatabase();
  process.env.TASKDESK_PORTAL_URL = `https://${PORTAL_HOST}`;
  process.env.TASKDESK_AGENT_URL = `https://${AGENT_HOST}`;
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  await seedCustomerConnection({});
});

describe("portal typed-domain home realm", () => {
  it("routes only a uniquely bound customer domain and performs no identity writes", async () => {
    const { app } = createApp();
    const logSpy = vi.spyOn(observabilityRuntime, "logTaskDesk");
    await db.insert(schema.userTable).values({
      id: "home-realm-existing-account",
      name: "Existing account",
      email: "private-local-part@example.test",
    });
    const before = {
      users: await countRows(schema.userTable),
      people: await countRows(schema.personTable),
      sessions: await countRows(schema.sessionTable),
      verification: await countRows(schema.verificationTable),
    };
    const response = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: PORTAL_HOST, "content-type": "application/json" },
        body: JSON.stringify({ email: "private-local-part@example.test" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: "sso" });
    const unregisteredAddress = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: PORTAL_HOST, "content-type": "application/json" },
        body: JSON.stringify({ email: "unknown-local-part@example.test" }),
      },
    );
    expect(await unregisteredAddress.json()).toEqual({ next: "sso" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-tdk_home_realm_continuation=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain(CONNECTION_ID);
    expect(cookie).not.toContain("example.test");
    expect(cookie).not.toContain("private-local-part");
    expect({
      users: await countRows(schema.userTable),
      people: await countRows(schema.personTable),
      sessions: await countRows(schema.sessionTable),
      verification: await countRows(schema.verificationTable),
    }).toEqual(before);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
      "private-local-part",
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
      "unknown-local-part",
    );
  });

  it("returns only the local-method shape for malformed, unbound, disabled, or ambiguous domains", async () => {
    const { app } = createApp();
    for (const email of [
      "bad-address",
      "user@unbound.test",
      "user@example.test.evil",
    ]) {
      const response = await app.request(
        `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
        {
          method: "POST",
          headers: { host: PORTAL_HOST, "content-type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ next: "local" });
    }

    await db
      .update(schema.identityConnectionTable)
      .set({ enabled: false })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    const disabled = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: PORTAL_HOST, "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.test" }),
      },
    );
    expect(await disabled.json()).toEqual({ next: "local" });

    await db
      .update(schema.identityConnectionTable)
      .set({ enabled: true })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    await seedCustomerConnection({
      id: "home-realm-second-connection",
      domain: "example.test",
    });
    const ambiguous = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: PORTAL_HOST, "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.test" }),
      },
    );
    expect(await ambiguous.json()).toEqual({ next: "local" });
  });

  it("rejects the route on the agent host and consumes the fixed start cookie", async () => {
    const { app } = createApp();
    const agentResponse = await app.request(
      `https://${AGENT_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: AGENT_HOST, "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.test" }),
      },
    );
    expect(agentResponse.status).toBe(404);

    const discovered = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: PORTAL_HOST, "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.test",
          invitationId: "invite-for-provider-return",
        }),
      },
    );
    const continuationCookie = discovered.headers
      .get("set-cookie")
      ?.split(";")[0];
    expect(continuationCookie).toContain("__Host-tdk_home_realm_continuation=");
    const started = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm/start`,
      {
        headers: {
          host: PORTAL_HOST,
          cookie: continuationCookie ?? "",
        },
        redirect: "manual",
      },
    );
    expect(started.status).toBe(302);
    expect(started.headers.get("location")).toContain(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?",
    );
    expect(started.headers.get("location")).toContain(
      "code_challenge_method=S256",
    );
    expect(started.headers.get("set-cookie")).toContain(
      "__Host-tdk_oidc_state=",
    );
    expect(started.headers.get("set-cookie")).toContain("Max-Age=0");
    const [flow] = await db.select().from(schema.verificationTable);
    expect(flow).toBeTruthy();
    expect(JSON.parse(flow?.value ?? "{}")).toMatchObject({
      invitationId: "invite-for-provider-return",
      connectionId: CONNECTION_ID,
      portal: "customer",
    });
  });

  it("rechecks the enabled customer domain binding before creating OIDC state", async () => {
    const { app } = createApp();
    const discovered = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: PORTAL_HOST, "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.test" }),
      },
    );
    const cookie = discovered.headers.get("set-cookie")?.split(";")[0] ?? "";
    await db
      .update(schema.identityConnectionTable)
      .set({ domainBindings: [] })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));

    const started = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm/start`,
      {
        headers: { host: PORTAL_HOST, cookie },
        redirect: "manual",
      },
    );
    expect(started.status).toBe(302);
    expect(started.headers.get("location")).toBe(
      "/sign-in?identity_error=sign_in_failed",
    );
    expect(started.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await db.select().from(schema.verificationTable)).toHaveLength(0);
  });

  it("does not accept an arbitrary connection id or domain at the fixed start route", async () => {
    const { app } = createApp();
    const discovered = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm`,
      {
        method: "POST",
        headers: { host: PORTAL_HOST, "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.test" }),
      },
    );
    const cookie = discovered.headers.get("set-cookie")?.split(";")[0] ?? "";
    const started = await app.request(
      `https://${PORTAL_HOST}/api/portal/sign-in/home-realm/start?connectionId=attacker&domain=other.test`,
      {
        headers: { host: PORTAL_HOST, cookie },
        redirect: "manual",
      },
    );

    expect(started.status).toBe(302);
    expect(started.headers.get("location")).toBe(
      "/sign-in?identity_error=sign_in_failed",
    );
    expect(await db.select().from(schema.verificationTable)).toHaveLength(0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (oldPortalUrl === undefined) delete process.env.TASKDESK_PORTAL_URL;
  else process.env.TASKDESK_PORTAL_URL = oldPortalUrl;
  if (oldAgentUrl === undefined) delete process.env.TASKDESK_AGENT_URL;
  else process.env.TASKDESK_AGENT_URL = oldAgentUrl;
  if (oldEncryptionKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = oldEncryptionKey;
});
