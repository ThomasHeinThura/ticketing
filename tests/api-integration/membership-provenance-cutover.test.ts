import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { schema } from "../../apps/api/src/database";
import { migrateWithMembershipProvenanceCutover } from "../../apps/api/src/database/migrate-membership-provenance";
import { classifyLegacyMemberships } from "../../apps/api/src/identity/membership-provenance-preflight";

const migrationDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/api/drizzle",
);
const cutoverIndex = 87;
const scratchDatabases: Array<{ adminUrl: string; name: string }> = [];

async function createScratchDatabase(baseUrl: string) {
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  const name = `membership_cutover_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const databaseUrl = new URL(baseUrl);
  databaseUrl.pathname = `/${name}`;
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 3 });
  scratchDatabases.push({ adminUrl: adminUrl.toString(), name });
  return { pool, database: drizzle(pool, { schema }) };
}

afterAll(async () => {
  for (const scratch of scratchDatabases) {
    const admin = new Client({ connectionString: scratch.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `drop database if exists "${scratch.name}" with (force)`,
      );
    } finally {
      await admin.end();
    }
  }
});

describe("membership provenance cutover", () => {
  it("blocks unresolved migration before DDL, then atomically applies approved direct provenance", async () => {
    const baseUrl = process.env.TASKDESK_DATABASE_URL;
    if (!baseUrl) throw new Error("CI Testcontainers database is required");
    const { pool, database } = await createScratchDatabase(baseUrl);
    const temp = await mkdtemp(resolve(tmpdir(), "taskdesk-provenance-"));
    const migrationInternals = database as unknown as {
      dialect: {
        migrate(
          migrations: ReturnType<typeof readMigrationFiles>,
          session: unknown,
          config: { migrationsFolder: string },
        ): Promise<void>;
      };
      session: unknown;
    };
    try {
      const migrations = readMigrationFiles({
        migrationsFolder: migrationDirectory,
      });
      await migrationInternals.dialect.migrate(
        migrations.slice(0, cutoverIndex),
        migrationInternals.session,
        { migrationsFolder: migrationDirectory },
      );

      await pool.query(
        `insert into public.organisation (id, key, name, is_internal)
         values ('prov-org', 'prov-org', 'Provenance test', false)`,
      );
      await pool.query(
        `insert into public."user" (id, name, email, role)
         values ('prov-user', 'Owner', 'prov-owner@example.invalid', 'admin')`,
      );
      await pool.query(
        `insert into public.person (id, user_id, organisation_id, side, active)
         values ('prov-person', 'prov-user', 'prov-org', 'staff', true)`,
      );
      await pool.query(
        `insert into public.role (id, scope, workspace_id, key, name, rank)
         values ('prov-role', 'organisation', null, 'prov-role', 'Provenance role', 1)`,
      );
      await pool.query(
        `insert into public.membership
           (id, person_id, scope, scope_id, role_id, sees_all, derived_from)
         values ('prov-membership', 'prov-person', 'organisation', 'prov-org', 'prov-role', false, null)`,
      );

      const options = {
        database,
        pool,
        migrationsFolder: migrationDirectory,
      };
      await expect(
        migrateWithMembershipProvenanceCutover(options),
      ).rejects.toThrow("complete owner reconciliation file");
      const rolledBack = await pool.query<{ exists: boolean }>(
        `select to_regclass('public.membership_grant') is not null as exists`,
      );
      expect(rolledBack.rows[0]?.exists).toBe(false);
      const boundary = await pool.query<{ created_at: string }>(
        "select created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1",
      );
      expect(Number(boundary.rows[0]?.created_at)).toBe(
        JSON.parse(
          await (await import("node:fs/promises")).readFile(
            resolve(migrationDirectory, "meta/_journal.json"),
            "utf8",
          ),
        ).entries[cutoverIndex - 1].when,
      );

      const inventory = classifyLegacyMemberships(
        [
          {
            id: "prov-membership",
            personId: "prov-person",
            scope: "organisation",
            scopeId: "prov-org",
            roleId: "prov-role",
            seesAll: false,
            derivedFrom: null,
          },
        ],
        [],
      );
      const recordPath = resolve(temp, "owner-reconciliation.json");
      await writeFile(
        recordPath,
        `${JSON.stringify({
          format: "taskdesk-membership-provenance-reconciliation/v1",
          approval: {
            approverPersonId: "prov-person",
            approvalReference: "isolated-test-owner-record",
          },
          decisions: [
            {
              membershipId: "prov-membership",
              rowDigest: inventory[0]?.rowDigest,
              evidenceReferences: ["isolated-test-evidence"],
              rationale: "The owner confirms this direct administrative grant.",
              grants: [
                {
                  sourceKind: "direct",
                  roleId: "prov-role",
                  scope: "organisation",
                  scopeId: "prov-org",
                  seesAll: false,
                  directOrigin: "admin",
                  grantedByPersonId: "prov-person",
                },
              ],
            },
          ],
        })}\n`,
        { mode: 0o600 },
      );
      await migrateWithMembershipProvenanceCutover({
        ...options,
        args: ["--membership-provenance-reconciliation", recordPath],
      });

      const result = await pool.query<{
        source_kind: string;
        direct_origin: string;
        grant_count: string;
      }>(
        `select source_kind, direct_origin,
                count(*) over ()::text as grant_count
           from public.membership_grant
          where membership_id = 'prov-membership' and revoked_at is null`,
      );
      expect(result.rows).toEqual([
        { source_kind: "direct", direct_origin: "admin", grant_count: "1" },
      ]);
      const uniqueIndex = await pool.query<{ exists: boolean }>(
        `select to_regclass('public.membership_person_scope_scope_id_unique') is not null as exists`,
      );
      expect(uniqueIndex.rows[0]?.exists).toBe(true);
    } finally {
      await pool.end();
      await rm(temp, { recursive: true, force: true });
    }
  }, 120_000);
});
