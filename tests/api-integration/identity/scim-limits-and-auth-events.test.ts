/**
 * IP-14 / IP-24 over the real SCIM router.
 *
 * WRITTEN, NOT YET RUN by the implementer: it needs the integration database, which the
 * implementer may not touch. The coordinator runs it; failures here are real findings.
 *
 * The anonymous failure counter is per process and keyed by client address, so the 429 case is
 * last in this file and nothing here relies on a clean counter afterwards.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { createApp } from "../../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "../helpers/database";

const KEY = "ab".repeat(32);

async function fixture(
  connectionId: string,
  token: string,
  flags: { connectionEnabled?: boolean; scimEnabled?: boolean } = {},
) {
  await ensureInternalOrganisation();
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    displayName: "SCIM limits fixture",
    issuer: "https://login.microsoftonline.com/tenant/v2.0",
    tenantId: "tenant",
    clientId: "client",
    clientSecret: encryptIdentityClientSecret(connectionId, "fixture"),
    redirectUri: "http://localhost:1337/api/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
    maxRoleRank: 10,
    enabled: flags.connectionEnabled ?? true,
  });
  await db.insert(schema.scimConnectionTable).values({
    identityConnectionId: connectionId,
    tokenHash: sha256(token),
    tokenPrefix: token.slice(0, 8),
    tokenCreatedAt: new Date(),
    allowedResources: ["users", "groups"],
    enabled: flags.scimEnabled ?? true,
  });
  return createApp().app;
}

const scimRequest = (
  app: Awaited<ReturnType<typeof fixture>>,
  token: string,
  init: { method?: string; body?: string } = {},
) =>
  app.request("/scim/v2/Users", {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/scim+json",
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });

describe("IP-14 / IP-24 SCIM limits and authentication-failure events", () => {
  beforeEach(async () => {
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", KEY);
    await resetTestDatabase();
  });

  it("rejects an oversized body with a SCIM 413 tooLarge before the handler runs", async () => {
    const token = "A".repeat(43);
    const app = await fixture("scim-limit-413", token);
    const response = await scimRequest(app, token, {
      method: "POST",
      body: JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024 + 10) }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(await response.json()).toMatchObject({
      status: "413",
      scimType: "tooLarge",
    });
    expect(await db.select().from(schema.externalIdentityTable)).toHaveLength(
      0,
    );
  });

  it("writes an auth.failed provisioning event, without any secret, when a disabled connection's token is used", async () => {
    const token = "B".repeat(43);
    const app = await fixture("scim-auth-failed", token, {
      connectionEnabled: false,
    });
    const response = await scimRequest(app, token);
    expect(response.status).toBe(401);
    const events = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(
        eq(
          schema.provisioningEventTable.identityConnectionId,
          "scim-auth-failed",
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "auth.failed",
      outcome: "failed",
      actorType: "scim",
      detail: { reason: "connection_disabled" },
    });
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(token.slice(0, 8));
    expect(serialised).not.toContain(sha256(token).toString("hex"));
  });

  it("answers an unknown token with 401 and writes no event (no connection to attribute it to)", async () => {
    const app = await fixture("scim-unknown-token", "C".repeat(43));
    const response = await scimRequest(app, "D".repeat(43));
    expect(response.status).toBe(401);
    expect(await db.select().from(schema.provisioningEventTable)).toHaveLength(
      0,
    );
  });

  it("limits failed authentication per client with a SCIM 429, then refuses before any lookup", async () => {
    const app = await fixture("scim-failure-429", "E".repeat(43));
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 30 && !limited; attempt += 1) {
      const response = await scimRequest(app, "F".repeat(43));
      if (response.status === 429) limited = response;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    expect(await limited?.json()).toMatchObject({ status: "429" });
  });
});
