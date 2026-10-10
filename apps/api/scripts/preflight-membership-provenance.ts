import { chmod, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config } from "dotenv-mono";
import { Pool } from "pg";
import { resolveDatabaseConfig } from "../src/database/resolve-database-url";
import {
  classifyLegacyMemberships,
  type LegacyMembershipRow,
  type ScimMembershipEvidence,
} from "../src/identity/membership-provenance-preflight";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const output = argument("--output");
  if (!output) {
    throw new Error(
      "Usage: pnpm --filter @taskdesk/api exec tsx scripts/preflight-membership-provenance.ts --output <private-file>",
    );
  }
  config();
  const database = resolveDatabaseConfig();
  if (database.source !== "TASKDESK_DATABASE_URL") {
    throw new Error(
      "Set TASKDESK_DATABASE_URL explicitly; the provenance preflight refuses database fallbacks",
    );
  }

  const pool = new Pool({
    connectionString: database.connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let rows: ReturnType<typeof classifyLegacyMemberships>;
  try {
    client = await pool.connect();
    // Once the 0090 grant tables exist, only memberships that no active grant projects
    // still need classification; the migration runner applies the same predicate.
    const grantTable = await client.query<{ present: boolean }>(
      `select to_regclass('public.membership_grant') is not null as present`,
    );
    const membershipResult = await client.query<{
      id: string;
      person_id: string;
      scope: string;
      scope_id: string;
      role_id: string;
      sees_all: boolean;
      derived_from: string | null;
    }>(
      grantTable.rows[0]?.present
        ? `select membership.id, membership.person_id, membership.scope,
                  membership.scope_id, membership.role_id, membership.sees_all,
                  membership.derived_from
             from public.membership membership
            where not exists (
              select 1 from public.membership_grant grant_row
               where grant_row.membership_id = membership.id
                 and grant_row.person_id = membership.person_id
                 and grant_row.scope = membership.scope
                 and grant_row.scope_id = membership.scope_id
                 and grant_row.role_id = membership.role_id
                 and grant_row.sees_all = membership.sees_all
                 and grant_row.revoked_at is null
            )
            order by membership.id`
        : `select id, person_id, scope, scope_id, role_id, sees_all, derived_from
             from public.membership order by id`,
    );
    const memberships: LegacyMembershipRow[] = membershipResult.rows.map(
      (row) => ({
        id: row.id,
        personId: row.person_id,
        scope: row.scope,
        scopeId: row.scope_id,
        roleId: row.role_id,
        seesAll: row.sees_all,
        derivedFrom: row.derived_from,
      }),
    );
    const tableResult = await client.query<{ present: boolean }>(
      `select to_regclass('public.scim_group_member') is not null as present`,
    );
    let scimEvidence: ScimMembershipEvidence[] = [];
    if (tableResult.rows[0]?.present) {
      const result = await client.query<{
        member_id: string;
        membership_id: string | null;
        grant_id: string;
        external_identity_id: string;
        person_id: string;
        connection_id: string;
        mapping_id: string;
        scope: string;
        scope_id: string;
        role_id: string;
      }>(`select gm.id as member_id, gm.membership_id,
                 grant_row.id as grant_id, external_identity.id as external_identity_id,
                 external_identity.person_id, connection.id as connection_id,
                 mapping.id as mapping_id, grant_row.scope, grant_row.scope_id, grant_row.role_id
          from public.scim_group_member gm
          join public.membership_grant grant_row
            on grant_row.id = gm.membership_grant_id
           and grant_row.source_kind = 'scim_group'
           and grant_row.scim_group_mapping_id = gm.scim_group_mapping_id
           and grant_row.revoked_at is null
          join public.external_identity external_identity
            on external_identity.id = gm.external_identity_id
           and external_identity.person_id = grant_row.person_id
           and external_identity.identity_connection_id = grant_row.identity_connection_id
           and external_identity.active = true
          join public.scim_group_mapping mapping
            on mapping.id = gm.scim_group_mapping_id
           and mapping.scim_connection_id = grant_row.identity_connection_id
           and mapping.scope = grant_row.scope
           and mapping.scope_id = grant_row.scope_id
           and mapping.role_id = grant_row.role_id
          join public.scim_connection scim
            on scim.identity_connection_id = mapping.scim_connection_id
           and scim.enabled = true
          join public.identity_connection connection
            on connection.id = external_identity.identity_connection_id
           and connection.enabled = true
          where gm.revoked_at is null`);
      scimEvidence = result.rows.map((row) => ({
        memberId: row.member_id,
        membershipId: row.membership_id,
        grantId: row.grant_id,
        externalIdentityId: row.external_identity_id,
        personId: row.person_id,
        connectionId: row.connection_id,
        mappingId: row.mapping_id,
        scope: row.scope,
        scopeId: row.scope_id,
        roleId: row.role_id,
        active: true,
      }));
    }
    rows = classifyLegacyMemberships(memberships, scimEvidence);
  } finally {
    client?.release();
    await pool.end();
  }
  const unresolvedCount = rows.filter(
    (row) => row.classification.sourceKind === "unresolved",
  ).length;
  const report = {
    format: "taskdesk-membership-provenance-preflight/v1",
    generatedAt: new Date().toISOString(),
    database: {
      host: database.host,
      port: database.port,
      database: database.database,
    },
    membershipCount: rows.length,
    unresolvedCount,
    allRowsSelfProving: unresolvedCount === 0,
    rows,
  };

  const destination = resolve(output);
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(destination, 0o600);
  console.log(
    JSON.stringify({
      membershipCount: rows.length,
      unresolvedCount,
      allRowsSelfProving: report.allRowsSelfProving,
      report: destination,
      reportDirectory: dirname(destination),
    }),
  );
  process.exitCode = unresolvedCount === 0 ? 0 : 2;
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  console.error(`Membership provenance preflight failed (${name})`);
  process.exitCode = 1;
});
