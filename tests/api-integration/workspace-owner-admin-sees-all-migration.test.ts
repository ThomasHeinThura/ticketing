/**
 * Migration 0123 `workspace_owner_admin_sees_all` -- the backfill for workspaces and members
 * that already exist (decision log 2026-10-14; rbac.md Reach step 2).
 *
 * Runs against its OWN dedicated database (never the shared `*_test` target):
 *   1. migrate to exactly 0122 using a temp folder of unmodified copies;
 *   2. seed pre-existing workspaces, members of every role, an external (JIT) grant, an
 *      explicit admin-made direct grant and an ambiguous duplicate-row member with RAW SQL;
 *   3. apply 0123 by splitting on `--> statement-breakpoint` (the exact shipped SQL);
 *   4. assert owners and genuine admins hold a direct `system_backfill` grant projected to a
 *      `sees_all` membership, nobody else does, other provenance is untouched;
 *   5. apply it a second time and assert nothing changed (idempotent).
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
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const drizzleFolder = resolve(currentDir, "../../apps/api/drizzle");
const CUTOFF_TAG = "0122_pending_action_expiry_indexes";
const MIGRATION_TAG = "0123_workspace_owner_admin_sees_all";

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

function buildPre0123Folder(): string {
  const journal = JSON.parse(
    readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  const cutoff = journal.entries.findIndex((e) => e.tag === CUTOFF_TAG);
  if (cutoff === -1) throw new Error(`${CUTOFF_TAG} not in journal`);
  const entries = journal.entries.slice(0, cutoff + 1);
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-pre-0123-"));
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

describe("migration 0123_workspace_owner_admin_sees_all -- owner/admin sees_all backfill", () => {
  const baseUrl = requireDatabaseUrl();
  const parentName = new URL(baseUrl).pathname.replace(/^\//, "");
  const dbName = `m0123_reach_${randomUUID().replaceAll("-", "_")}`;
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
    folder = buildPre0123Folder();
    pool = new Pool({ connectionString: dbUrl });
  });

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
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await pool.query(trimmed);
    }
  }

  async function snapshot() {
    const grants = await pool.query(
      `select g.person_id, g.scope_id, g.source_kind, g.direct_origin, g.sees_all,
              g.revoked_at is not null as revoked, g.membership_id is not null as linked, r.key as role_key
         from membership_grant g join role r on r.id = g.role_id
        order by g.person_id, g.scope_id, g.source_kind, r.key`,
    );
    const memberships = await pool.query(
      `select m.person_id, m.scope_id, m.sees_all, r.key as role_key
         from membership m join role r on r.id = m.role_id
        order by m.person_id, m.scope_id`,
    );
    const roles = await pool.query(
      `select workspace_id, key, is_system, is_editable, capabilities, rank
         from role order by workspace_id, key`,
    );
    return {
      grants: grants.rows,
      memberships: memberships.rows,
      roles: roles.rows,
    };
  }

  it("backfills existing owners and genuine admins only, leaves other provenance alone, and is idempotent", async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const org = (
      await pool.query("select id from organisation where is_internal = true")
    ).rows[0].id as string;

    for (const ws of ["wsA", "wsB", "wsC"]) {
      await pool.query(
        "insert into workspace (id, name, slug, organisation_id, created_at) values ($1, $1, $1, $2, now())",
        [ws, org],
      );
    }
    // wsA has the genuine seeded admin row; wsB's `admin` row is a custom lookalike.
    await pool.query(
      `insert into workspace_role (id, workspace_id, role, permission, is_system, created_at, updated_at)
       values ('wrA', 'wsA', 'admin', '{}', true, now(), now()),
              ('wrB', 'wsB', 'admin', '{}', false, now(), now())`,
    );

    const people = [
      "owner",
      "admin",
      "member",
      "manager",
      "viewer",
      "dup",
      "customeradmin",
      "adminB",
      "explicit",
      "jit",
      "scim",
    ];
    for (const key of people) {
      await pool.query(
        `insert into "user" (id, name, email, email_verified, created_at, updated_at)
         values ($1, $1, $1 || '@example.test', true, now(), now())`,
        [`u-${key}`],
      );
      await pool.query(
        "insert into person (id, user_id, organisation_id, side) values ($1, $2, $3, $4)",
        [
          `p-${key}`,
          `u-${key}`,
          org,
          key === "customeradmin" ? "customer" : "staff",
        ],
      );
    }
    const legacy: Array<[string, string, string]> = [
      ["wsA", "owner", "owner"],
      ["wsA", "admin", "admin"],
      ["wsA", "member", "member"],
      ["wsA", "manager", "manager"],
      ["wsA", "viewer", "viewer"],
      ["wsA", "dup", "admin"],
      ["wsA", "dup", "member"],
      ["wsA", "customeradmin", "admin"],
      ["wsA", "explicit", "admin"],
      ["wsA", "jit", "admin"],
      ["wsA", "scim", "admin"],
      ["wsB", "adminB", "admin"],
      ["wsB", "owner", "owner"],
    ];
    for (const [ws, key, role] of legacy) {
      await pool.query(
        `insert into workspace_member (id, workspace_id, user_id, role, joined_at)
         values ($1, $2, $3, $4, now())`,
        [`wm-${ws}-${key}-${role}`, ws, `u-${key}`, role],
      );
    }

    // An explicit admin-made direct grant for `explicit` (sees_all false), granted by `owner`.
    await pool.query(
      `insert into role (id, scope, workspace_id, key, name, rank, capabilities)
       values ('roleExplicit', 'workspace', 'wsA', 'explicit-role', 'Explicit', 5, '[]'::jsonb),
              ('roleJit', 'workspace', 'wsA', 'jit-role', 'Jit', 5, '[]'::jsonb)`,
    );
    await pool.query(
      `insert into membership (id, person_id, scope, scope_id, role_id, sees_all)
       values ('mExplicit', 'p-explicit', 'workspace', 'wsA', 'roleExplicit', false),
              ('mJit', 'p-jit', 'workspace', 'wsA', 'roleJit', false)`,
    );
    await pool.query(
      `insert into membership_grant (id, membership_id, person_id, scope, scope_id, role_id, source_kind, direct_origin, granted_by_person_id, sees_all)
       values ('gExplicit', 'mExplicit', 'p-explicit', 'workspace', 'wsA', 'roleExplicit', 'direct', 'admin', 'p-owner', false)`,
    );
    // An external (JIT) grant for `jit`: needs an identity connection and external identity.
    await pool.query(
      `insert into identity_connection (id, provider_type, portal_scope, default_workspace_id, display_name, issuer, tenant_id, client_id, client_secret, redirect_uri, scopes, claim_mapping, jit_policy, enabled)
       values ('conn', 'entra', 'agent', 'wsA', 'c', 'https://login.microsoftonline.com/t/v2.0', 't', 'cid', '\\x00', 'http://localhost/cb', ARRAY['openid'], '{}'::jsonb, '{}'::jsonb, true)`,
    );
    await pool.query(
      `insert into external_identity (id, identity_connection_id, person_id, user_id, issuer, subject, user_name_snapshot, email_snapshot, active, provisioned_via)
       values ('ext', 'conn', 'p-jit', 'u-jit', 'https://login.microsoftonline.com/t/v2.0', 'sub', 'j', 'j@example.test', true, 'jit')`,
    );
    await pool.query(
      `insert into membership_grant (id, membership_id, person_id, scope, scope_id, role_id, source_kind, external_identity_id, identity_connection_id, sees_all)
       values ('gJit', 'mJit', 'p-jit', 'workspace', 'wsA', 'roleJit', 'jit_default', 'ext', 'conn', false)`,
    );

    // A SCIM-sourced grant and its group-member link for an admin: the effective row it
    // pointed at is taken over by the direct owner/admin grant, so the link is cleared.
    await pool.query(
      `insert into scim_connection (identity_connection_id, enabled) values ('conn', false)`,
    );
    await pool.query(
      `insert into scim_group_mapping (id, scim_connection_id, external_group_id, role_id, scope, scope_id)
       values ('map', 'conn', 'grp', 'roleJit', 'workspace', 'wsA')`,
    );
    await pool.query(
      `insert into external_identity (id, identity_connection_id, person_id, user_id, issuer, subject, user_name_snapshot, email_snapshot, active, provisioned_via)
       values ('ext2', 'conn', 'p-scim', 'u-scim', 'https://login.microsoftonline.com/t/v2.0', 'sub2', 's', 's@example.test', true, 'scim')`,
    );
    await pool.query(
      `insert into membership (id, person_id, scope, scope_id, role_id, sees_all)
       values ('mScim', 'p-scim', 'workspace', 'wsA', 'roleJit', false)`,
    );
    await pool.query(
      `insert into membership_grant (id, membership_id, person_id, scope, scope_id, role_id, source_kind, external_identity_id, identity_connection_id, scim_group_mapping_id, sees_all)
       values ('gScim', 'mScim', 'p-scim', 'workspace', 'wsA', 'roleJit', 'scim_group', 'ext2', 'conn', 'map', false)`,
    );
    await pool.query(
      `insert into scim_group_member (id, scim_group_mapping_id, external_identity_id, membership_id, membership_grant_id)
       values ('sgm', 'map', 'ext2', 'mScim', 'gScim')`,
    );

    await applyMigration();
    const first = await snapshot();

    const grantFor = (person: string, ws: string) =>
      first.grants.filter(
        (g) =>
          g.person_id === person &&
          g.scope_id === ws &&
          g.direct_origin === "system_backfill",
      );
    const membershipFor = (person: string, ws: string) =>
      first.memberships.filter(
        (m) => m.person_id === person && m.scope_id === ws,
      );

    // Owners (both workspaces) and the genuine-admin rows get a direct system grant + sees_all membership.
    for (const [person, ws, key] of [
      ["p-owner", "wsA", "owner"],
      ["p-owner", "wsB", "owner"],
      ["p-admin", "wsA", "admin"],
      ["p-jit", "wsA", "admin"],
      ["p-scim", "wsA", "admin"],
    ] as const) {
      expect(grantFor(person, ws), `${person}/${ws} grant`).toEqual([
        expect.objectContaining({
          source_kind: "direct",
          sees_all: true,
          revoked: false,
          linked: true,
          role_key: key,
        }),
      ]);
      expect(membershipFor(person, ws), `${person}/${ws} membership`).toEqual([
        expect.objectContaining({ sees_all: true, role_key: key }),
      ]);
    }

    // Nobody else: member, manager, viewer, the ambiguous duplicate, the customer, the
    // custom `admin` lookalike (wsB), and the explicit admin-grant holder (untouched).
    for (const [person, ws] of [
      ["p-member", "wsA"],
      ["p-manager", "wsA"],
      ["p-viewer", "wsA"],
      ["p-dup", "wsA"],
      ["p-customeradmin", "wsA"],
      ["p-adminB", "wsB"],
      ["p-explicit", "wsA"],
    ] as const) {
      expect(grantFor(person, ws), `${person}/${ws} no system grant`).toEqual(
        [],
      );
    }
    for (const person of [
      "p-member",
      "p-manager",
      "p-viewer",
      "p-dup",
      "p-customeradmin",
      "p-adminB",
    ]) {
      expect(first.memberships.filter((m) => m.person_id === person)).toEqual(
        [],
      );
    }
    // The explicit direct grant is exactly as it was.
    expect(membershipFor("p-explicit", "wsA")).toEqual([
      expect.objectContaining({ sees_all: false, role_key: "explicit-role" }),
    ]);

    // The external JIT grant survives, active, unlinked from the effective row (ours wins).
    expect(
      first.grants.filter(
        (g) => g.person_id === "p-jit" && g.source_kind === "jit_default",
      ),
    ).toEqual([
      expect.objectContaining({
        revoked: false,
        linked: false,
        sees_all: false,
      }),
    ]);

    // The SCIM group-member link no longer points at the effective row; the SCIM grant stays.
    const scimLink = await pool.query(
      "select membership_id from scim_group_member where id = 'sgm'",
    );
    expect(scimLink.rows).toEqual([{ membership_id: null }]);
    expect(
      first.grants.filter(
        (g) => g.person_id === "p-scim" && g.source_kind === "scim_group",
      ),
    ).toEqual([expect.objectContaining({ revoked: false, linked: false })]);

    // Carrier roles: empty capabilities, system, not editable; only where needed.
    const carriers = first.roles.filter(
      (r) => r.key === "owner" || r.key === "admin",
    );
    expect(carriers.map((r) => `${r.workspace_id}/${r.key}`).sort()).toEqual([
      "wsA/admin",
      "wsA/owner",
      "wsB/owner",
    ]);
    for (const role of carriers) {
      expect(role).toMatchObject({
        is_system: true,
        is_editable: false,
        capabilities: [],
      });
    }

    // Idempotent: a second run changes nothing.
    await applyMigration();
    expect(await snapshot()).toEqual(first);
  }, 120_000);
});
