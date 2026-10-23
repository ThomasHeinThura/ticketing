import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "../database";
import { loadEntraDiscovery } from "./oidc-provider";

/**
 * `IP-25` (`plugin-health`, every 10 minutes): ping each enabled identity connection's OIDC
 * discovery document and record the result on the connection so God Mode can flag an
 * unreachable IdP.
 *
 * - discovery loads and validates -> `healthy`
 * - the IdP is unreachable, slow, or answers with an error status -> `degraded`
 * - the stored configuration cannot name a valid discovery document (no tenant, a malformed
 *   tenant id, or a document whose issuer/endpoints do not match) -> `invalid`
 *
 * Only `health_state` and `health_checked_at` are written. `config_version` is never advanced
 * (it is the administrators' CAS), no session is touched, and no secret is read: the probe uses
 * only the tenant id and the shared discovery loader, which pins Microsoft hosts, refuses
 * redirects and bounds time and size.
 */
export type ConnectionHealth = "healthy" | "degraded" | "invalid";

export const IDENTITY_HEALTH_MAX_CONNECTIONS = 200;
const CONCURRENCY = 5;

export function healthForDiscoveryResult(error: unknown): ConnectionHealth {
  if (error === null) return "healthy";
  return error instanceof Error &&
    error.message === "Identity provider configuration is invalid"
    ? "invalid"
    : "degraded";
}

export type DiscoveryProbe = (tenantId: string) => Promise<unknown>;

export async function probeConnectionHealth(
  tenantId: string | null,
  probe: DiscoveryProbe = (tenant) => loadEntraDiscovery(tenant),
): Promise<ConnectionHealth> {
  if (!tenantId) return "invalid";
  try {
    await probe(tenantId);
    return healthForDiscoveryResult(null);
  } catch (error) {
    return healthForDiscoveryResult(error);
  }
}

export type IdentityHealthOutcome = {
  checked: number;
  healthy: number;
  degraded: number;
  invalid: number;
};

export async function checkIdentityConnectionHealth(
  probe?: DiscoveryProbe,
): Promise<IdentityHealthOutcome> {
  const connections = await db
    .select({
      id: schema.identityConnectionTable.id,
      tenantId: schema.identityConnectionTable.tenantId,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.enabled, true))
    .limit(IDENTITY_HEALTH_MAX_CONNECTIONS);
  const outcome: IdentityHealthOutcome = {
    checked: 0,
    healthy: 0,
    degraded: 0,
    invalid: 0,
  };
  for (let index = 0; index < connections.length; index += CONCURRENCY) {
    const batch = connections.slice(index, index + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (connection) => ({
        id: connection.id,
        health: await probeConnectionHealth(connection.tenantId, probe),
      })),
    );
    for (const health of ["healthy", "degraded", "invalid"] as const) {
      const ids = results
        .filter((result) => result.health === health)
        .map((result) => result.id);
      if (ids.length === 0) continue;
      // `enabled` is re-asserted so a connection disabled mid-run is not touched.
      await db
        .update(schema.identityConnectionTable)
        .set({ healthState: health, healthCheckedAt: new Date() })
        .where(
          and(
            inArray(schema.identityConnectionTable.id, ids),
            eq(schema.identityConnectionTable.enabled, true),
          ),
        );
      outcome[health] += ids.length;
    }
    outcome.checked += batch.length;
  }
  return outcome;
}
