/**
 * Migration 0145 `canonical_workspace_roles` -- custom-role capabilities move to the canonical
 * `role` table (owner decision, 23 Oct).
 *
 * Runs against its OWN dedicated database (never the shared `*_test` target):
 *   1. migrate to exactly the migration before 0145 using a temp folder of unmodified copies;
 *   2. seed pre-existing legacy rows with RAW SQL: genuine default rows (one narrowed), a custom
 *      role, malformed payloads, a squatter named like a built-in, an empty workspace, and the
 *      `owner`/`admin` reach carriers 0123 created, with a grant pointing at the admin carrier;
 *   3. apply 0145 by running its shipped statements on one connection (it uses temp tables);
 *   4. assert ids, capabilities, flags, the cascade, and that `workspace_role` is untouched;
 *   5. apply it a second time and assert nothing changed.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_ROLES, defaultRolePayloads } from "@taskdesk/permissions";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const drizzleFolder = resolve(currentDir, "../../apps/api/drizzle");
const MIGRATION_TAG = "0145_canonical_workspace_roles";

function requireDatabaseUrl(): string {
  const url = process.env.TASKDESK_DATABASE_URL;
  if (!url) {
    throw new Error("TASKDESK_DATABASE_URL must be defined for this test");
  }
  return url;
}

function withDatabaseName(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Every journal entry except 0145 itself, unmodified, in a temp folder. */
function buildPre0145Folder(): string {
  const journal = JSON.parse(
    readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  const entries = journal.entries.filter((e) => e.tag !== MIGRATION_TAG);
  if (entries.length === journal.entries.length) {
    throw new Error(`${MIGRATION_TAG} not in journal`);
  }
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-pre-0145-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
  );
  for (const e of entries) {
    writeFileSync(
      join(dir, `${e.tag}.sql`),
      readFileSync(join(drizzleFolder, `${e.tag}.sql`)),
    );
  }
  return dir;
}

const sorted = (values: readonly string[]) => [...values].sort();

describe("migration 0145_canonical_workspace_roles", () => {
  const baseUrl = requireDatabaseUrl();
  const parentName = new URL(baseUrl).pathname.replace(/^\//, "");
  const dbName = `m0145_roles_${randomUUID().replaceAll("-", "_")}`;
  const dbUrl = withDatabaseName(baseUrl, dbName);
  let folder: string;
  let pool: Pool;

  beforeAll(async () => {
    if (!parentName.endsWith("_test")) {
      throw new Error(
        `Refusing to run against non-test database ${parentName}`,
      );
    }
    const admin = new Client({
      connectionString: withDatabaseName(baseUrl, "postgres"),
    });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`);
    } finally {
      await admin.end();
    }
    folder = buildPre0145Folder();
    pool = new Pool({ connectionString: dbUrl });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (folder) rmSync(folder, { recursive: true, force: true });
    const admin = new Client({
      connectionString: withDatabaseName(baseUrl, "postgres"),
    });
    await admin.connect();
    try {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [dbName],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)}`);
    } finally {
      await admin.end();
    }
  });

  async function applyMigration() {
    const sqlText = readFileSync(
      join(drizzleFolder, `${MIGRATION_TAG}.sql`),
      "utf8",
    );
    // One connection and one transaction, exactly as the migrator runs it: the migration
    // keeps its working tables as TEMP tables.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of sqlText.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await client.query(trimmed);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function snapshot() {
    const roles = await pool.query(
      `select id, workspace_id, key, name, rank, capabilities, is_system, is_editable
         from role where scope = 'workspace' order by workspace_id, key`,
    );
    const legacy = await pool.query(
      "select id, workspace_id, role, permission, is_system from workspace_role order by id",
    );
    const grants = await pool.query(
      "select id, role_id from membership_grant order by id",
    );
    const memberships = await pool.query(
      "select id, role_id from membership order by id",
    );
    return {
      roles: roles.rows,
      legacy: legacy.rows,
      grants: grants.rows,
      memberships: memberships.rows,
    };
  }

  it("seeds the six built-ins, migrates every legacy row with its id, keeps narrowing, and is idempotent", async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const org = (
      await pool.query("select id from organisation where is_internal = true")
    ).rows[0].id as string;

    for (const ws of ["wsA", "wsB"]) {
      await pool.query(
        "insert into workspace (id, name, slug, organisation_id, created_at) values ($1, $1, $1, $2, now())",
        [ws, org],
      );
    }

    // A member role an administrator narrowed: no `work_item:update`, no label writes.
    const narrowedMember = {
      ...defaultRolePayloads.member,
      work_item: ["create", "read"],
      label: ["read"],
    };
    await pool.query(
      `insert into workspace_role (id, workspace_id, role, permission, is_system, created_at, updated_at)
       values ('wrViewerA', 'wsA', 'viewer', $1, true, now(), now()),
              ('wrMemberA', 'wsA', 'member', $2, true, now(), now()),
              ('wrAdminA', 'wsA', 'admin', $3, true, now(), now()),
              ('wrLeadA', 'wsA', 'support-lead', $4, false, now(), now()),
              ('wrBrokenA', 'wsA', 'broken', 'not-json', false, now(), now()),
              ('wrArrayA', 'wsA', 'arrayish', '[1,2]', false, now(), now()),
              ('wrSquatA', 'wsA', 'manager', $5, false, now(), now()),
              ('wrCustomerA', 'wsA', 'customer', '{}', false, now(), now())`,
      [
        JSON.stringify(defaultRolePayloads.viewer),
        JSON.stringify(narrowedMember),
        JSON.stringify(defaultRolePayloads.admin),
        JSON.stringify({
          work_item: ["read", "update"],
          label: ["create"],
          team: ["create"],
          fooo: ["bar"],
        }),
        JSON.stringify({ work_item: ["read"] }),
      ],
    );

    // The reach carriers migration 0123 created, with a direct grant and membership pointing
    // at the admin one: re-keying it must cascade.
    await pool.query(
      `insert into role (id, scope, workspace_id, key, name, rank, capabilities, is_system, is_editable)
       values ('carrierAdminA', 'workspace', 'wsA', 'admin', 'Admin', 80, '[]'::jsonb, true, false),
              ('carrierOwnerA', 'workspace', 'wsA', 'owner', 'Owner', 100, '[]'::jsonb, true, false)`,
    );
    await pool.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ('u-admin', 'admin', 'admin@example.test', true, now(), now())`,
    );
    await pool.query(
      "insert into person (id, user_id, organisation_id, side) values ('p-admin', 'u-admin', $1, 'staff')",
      [org],
    );
    await pool.query(
      `insert into membership (id, person_id, scope, scope_id, role_id, sees_all)
       values ('mAdmin', 'p-admin', 'workspace', 'wsA', 'carrierAdminA', true)`,
    );
    await pool.query(
      `insert into membership_grant (id, membership_id, person_id, scope, scope_id, role_id, source_kind, direct_origin, sees_all)
       values ('gAdmin', 'mAdmin', 'p-admin', 'workspace', 'wsA', 'carrierAdminA', 'direct', 'system_backfill', true)`,
    );

    // The sign-in factor policy names the admin carrier by id in jsonb (no FK): the re-key must
    // rewrite it, or every sign-in would fail closed.
    const policyRows = await pool.query(
      `update instance_setting
          set local_factor_policy = '{"mode":"required_role","requiredRoleId":"carrierAdminA"}'::jsonb`,
    );
    if (policyRows.rowCount === 0) {
      await pool.query(
        `insert into instance_setting (id, local_factor_policy)
         values ('singleton', '{"mode":"required_role","requiredRoleId":"carrierAdminA"}'::jsonb)`,
      );
    }

    const before = await snapshot();
    await applyMigration();
    const first = await snapshot();
    const policy = await pool.query(
      "select local_factor_policy from instance_setting",
    );
    expect(policy.rows).toEqual([
      {
        local_factor_policy: {
          mode: "required_role",
          requiredRoleId: "wrAdminA",
        },
      },
    ]);

    const row = (ws: string, key: string) =>
      first.roles.find((r) => r.workspace_id === ws && r.key === key);

    // wsA: the six built-ins (the squatted `manager` key stays the custom row), plus the
    // migrated custom rows. `customer` is never a workspace role.
    expect(
      first.roles.filter((r) => r.workspace_id === "wsA").map((r) => r.key),
    ).toEqual(
      sorted([
        "admin",
        "arrayish",
        "broken",
        "lead",
        "manager",
        "member",
        "owner",
        "support-lead",
        "viewer",
      ]),
    );
    expect(row("wsA", "customer")).toBeUndefined();

    // wsB had no legacy rows at all and still gets all six, system and genuine.
    expect(
      first.roles.filter((r) => r.workspace_id === "wsB").map((r) => r.key),
    ).toEqual(
      sorted(["admin", "lead", "manager", "member", "owner", "viewer"]),
    );
    for (const key of [
      "admin",
      "lead",
      "manager",
      "member",
      "owner",
      "viewer",
    ]) {
      const compiled = BUILT_IN_ROLES[key as keyof typeof BUILT_IN_ROLES];
      expect(row("wsB", key)).toMatchObject({
        rank: compiled.rank,
        is_system: true,
        is_editable: compiled.isEditable,
      });
      expect(sorted(row("wsB", key)?.capabilities as string[])).toEqual(
        sorted(compiled.capabilities),
      );
    }

    // Legacy ids are preserved; the admin carrier was re-keyed and the FKs cascaded.
    expect(row("wsA", "viewer")?.id).toBe("wrViewerA");
    expect(row("wsA", "member")?.id).toBe("wrMemberA");
    expect(row("wsA", "admin")?.id).toBe("wrAdminA");
    expect(first.grants).toEqual([{ id: "gAdmin", role_id: "wrAdminA" }]);
    expect(first.memberships).toEqual([{ id: "mAdmin", role_id: "wrAdminA" }]);
    // The owner carrier keeps its id and is filled with the compiled owner capabilities.
    expect(row("wsA", "owner")?.id).toBe("carrierOwnerA");
    expect(sorted(row("wsA", "owner")?.capabilities as string[])).toEqual(
      sorted(BUILT_IN_ROLES.owner.capabilities),
    );

    // Untouched default rows take the compiled lists.
    expect(sorted(row("wsA", "viewer")?.capabilities as string[])).toEqual(
      sorted(BUILT_IN_ROLES.viewer.capabilities),
    );
    expect(sorted(row("wsA", "admin")?.capabilities as string[])).toEqual(
      sorted(BUILT_IN_ROLES.admin.capabilities),
    );
    // A narrowed row is NEVER re-widened: the compiled list minus what was removed.
    expect(sorted(row("wsA", "member")?.capabilities as string[])).toEqual(
      sorted(
        BUILT_IN_ROLES.member.capabilities.filter(
          (capability) => capability !== "work_item:update",
        ),
      ),
    );
    expect(row("wsA", "member")).toMatchObject({
      is_system: true,
      rank: BUILT_IN_ROLES.member.rank,
    });

    // A custom row: the translated capabilities, rank 30, key = the legacy role string.
    expect(row("wsA", "support-lead")).toMatchObject({
      id: "wrLeadA",
      name: "support-lead",
      rank: 30,
      is_system: false,
      is_editable: true,
      capabilities: [
        "label:manage",
        "work_item:read",
        "work_item:update",
        "workspace:manage_settings",
      ],
    });
    // Malformed payloads grant nothing.
    expect(row("wsA", "broken")?.capabilities).toEqual([]);
    expect(row("wsA", "arrayish")?.capabilities).toEqual([]);
    // The squatter stays a custom, non-system row under its own key and keeps its own list.
    expect(row("wsA", "manager")).toMatchObject({
      id: "wrSquatA",
      is_system: false,
      capabilities: ["work_item:read"],
    });

    // The legacy table is readable and untouched.
    expect(first.legacy).toEqual(before.legacy);

    // Idempotent: a second run changes nothing.
    await applyMigration();
    expect(await snapshot()).toEqual(first);
  }, 120_000);

  it("refuses to run while identity provisioning points at an owner/admin carrier", async () => {
    const org = (
      await pool.query("select id from organisation where is_internal = true")
    ).rows[0].id as string;
    await pool.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ('u-jit', 'jit', 'jit@example.test', true, now(), now())`,
    );
    await pool.query(
      "insert into person (id, user_id, organisation_id, side) values ('p-jit', 'u-jit', $1, 'staff')",
      [org],
    );
    await pool.query(
      `insert into identity_connection (id, provider_type, portal_scope, default_workspace_id, display_name, issuer, tenant_id, client_id, client_secret, redirect_uri, scopes, claim_mapping, jit_policy, enabled)
       values ('conn', 'entra', 'agent', 'wsA', 'c', 'https://login.microsoftonline.com/t/v2.0', 't', 'cid', '\\x00', 'http://localhost/cb', ARRAY['openid'], '{}'::jsonb, '{}'::jsonb, true)`,
    );
    await pool.query(
      `insert into external_identity (id, identity_connection_id, person_id, user_id, issuer, subject, user_name_snapshot, email_snapshot, active, provisioned_via)
       values ('ext', 'conn', 'p-jit', 'u-jit', 'https://login.microsoftonline.com/t/v2.0', 'sub', 'j', 'j@example.test', true, 'jit')`,
    );
    await pool.query(
      `insert into membership_grant (id, person_id, scope, scope_id, role_id, source_kind, external_identity_id, identity_connection_id, sees_all)
       values ('gBad', 'p-jit', 'workspace', 'wsA', 'carrierOwnerA', 'jit_default', 'ext', 'conn', false)`,
    );
    await expect(applyMigration()).rejects.toThrow(/owner\/admin role/);
  }, 120_000);
});
