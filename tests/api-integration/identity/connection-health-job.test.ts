/**
 * IP-25 job over the database: health_state / health_checked_at only, enabled connections only.
 *
 * WRITTEN, NOT YET RUN by the implementer (needs the integration database).
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { checkIdentityConnectionHealth } from "../../../apps/api/src/identity/connection-health";
import { resetTestDatabase } from "../helpers/database";

const TENANT = "11111111-2222-3333-4444-555555555555";

async function connection(
  id: string,
  enabled: boolean,
  tenantId: string | null,
) {
  await db.insert(schema.identityConnectionTable).values({
    id,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    displayName: id,
    issuer: `https://login.microsoftonline.com/${tenantId ?? "none"}/v2.0`,
    tenantId,
    clientId: "client",
    clientSecret: encryptIdentityClientSecret(id, "fixture"),
    redirectUri: "http://localhost:1337/api/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
    maxRoleRank: 10,
    enabled,
  });
}

describe("identity connection health job (IP-25)", () => {
  beforeEach(async () => {
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
    await resetTestDatabase();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flags an unreachable IdP, clears it on recovery, and leaves disabled connections and config_version alone", async () => {
    await connection("health-up", true, TENANT);
    await connection("health-down", true, TENANT);
    await connection("health-off", false, TENANT);
    let down = false;
    const probe = async () => {
      if (down) throw new Error("fetch failed");
      return {};
    };
    const first = await checkIdentityConnectionHealth(probe);
    expect(first).toMatchObject({ checked: 2, healthy: 2, degraded: 0 });
    down = true;
    const second = await checkIdentityConnectionHealth(probe);
    expect(second).toMatchObject({ checked: 2, degraded: 2, healthy: 0 });
    const rows = await db.select().from(schema.identityConnectionTable);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("health-up")?.healthState).toBe("degraded");
    expect(byId.get("health-up")?.healthCheckedAt).toBeInstanceOf(Date);
    expect(byId.get("health-off")).toMatchObject({
      healthState: "unknown",
      healthCheckedAt: null,
    });
    expect(rows.every((row) => row.configVersion === 1)).toBe(true);
    down = false;
    await checkIdentityConnectionHealth(probe);
    const [recovered] = await db
      .select({ state: schema.identityConnectionTable.healthState })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, "health-down"));
    expect(recovered?.state).toBe("healthy");
  });

  it("marks a connection without a tenant id invalid", async () => {
    await connection("health-no-tenant", true, null);
    expect(await checkIdentityConnectionHealth(async () => ({}))).toMatchObject(
      {
        invalid: 1,
      },
    );
  });
});
