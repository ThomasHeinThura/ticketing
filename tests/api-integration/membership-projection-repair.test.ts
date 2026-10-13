import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { schema } from "../../apps/api/src/database";
import { migrateWithMembershipProvenanceCutover } from "../../apps/api/src/database/migrate-membership-provenance";
import { classifyLegacyMemberships } from "../../apps/api/src/identity/membership-provenance-preflight";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/api/drizzle",
);
const scratch: Array<{ adminUrl: string; name: string }> = [];

async function scratchDatabase(baseUrl: string) {
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  const name = `membership_repair_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  // Production runs the migration pool at max 2; use the same here.
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  scratch.push({ adminUrl: adminUrl.toString(), name });
  return { pool, database: drizzle(pool, { schema }) };
}

afterAll(async () => {
  for (const item of scratch) {
    const admin = new Client({ connectionString: item.adminUrl });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${item.name}" with (force)`);
    } finally {
      await admin.end();
    }
  }
});

type Row = {
  id: string;
  personId: string;
  orgId: string;
  roleId: string;
};

async function seedMembership(
  pool: Pool,
  n: number,
  admin: boolean,
): Promise<Row> {
  const orgId = `repair-org-${n}`;
  const personId = `repair-person-${n}`;
  const roleId = `repair-role-${n}`;
  await pool.query(
    `insert into public.organisation (id, key, name, is_internal)
     values ($1, $1, 'Repair test', false)`,
    [orgId],
  );
  await pool.query(
    `insert into public."user" (id, name, email, role)
     values ($1, 'Owner', $2, $3)`,
    [
      `repair-user-${n}`,
      `repair-${n}@example.invalid`,
      admin ? "admin" : "member",
    ],
  );
  await pool.query(
    `insert into public.person (id, user_id, organisation_id, side, active)
     values ($1, $2, $3, 'staff', true)`,
    [personId, `repair-user-${n}`, orgId],
  );
  await pool.query(
    `insert into public.role (id, scope, workspace_id, key, name, rank)
     values ($1, 'organisation', null, $1, 'Repair role', 1)`,
    [roleId],
  );
  const id = `repair-membership-${n}`;
  await pool.query(
    `insert into public.membership
       (id, person_id, scope, scope_id, role_id, sees_all, derived_from)
     values ($1, $2, 'organisation', $3, $4, false, null)`,
    [id, personId, orgId, roleId],
  );
  return { id, personId, orgId, roleId };
}

function decision(row: Row) {
  const [entry] = classifyLegacyMemberships(
    [
      {
        id: row.id,
        personId: row.personId,
        scope: "organisation",
        scopeId: row.orgId,
        roleId: row.roleId,
        seesAll: false,
        derivedFrom: null,
      },
    ],
    [],
  );
  return {
    membershipId: row.id,
    rowDigest: entry?.rowDigest,
    evidenceReferences: ["repair-test-evidence"],
    rationale: "The owner confirms this direct administrative grant.",
    grants: [
      {
        sourceKind: "direct",
        roleId: row.roleId,
        scope: "organisation",
        scopeId: row.orgId,
        seesAll: false,
        directOrigin: "admin",
        grantedByPersonId: "repair-person-1",
      },
    ],
  };
}

async function writeRecord(
  dir: string,
  name: string,
  rows: Row[],
  approver = "repair-person-1",
) {
  const path = resolve(dir, name);
  await writeFile(
    path,
    `${JSON.stringify({
      format: "taskdesk-membership-provenance-reconciliation/v1",
      approval: {
        approverPersonId: approver,
        approvalReference: "repair-test-owner-record",
      },
      decisions: rows.map(decision),
    })}\n`,
    { mode: 0o600 },
  );
  return path;
}

describe("membership grant projection repair for a database already at 0119", () => {
  it("refuses without an approved record, repairs with one, is idempotent, and refuses unresolved rows", async () => {
    const baseUrl = process.env.TASKDESK_DATABASE_URL;
    if (!baseUrl) throw new Error("A test database is required");
    const { pool, database } = await scratchDatabase(baseUrl);
    const dir = await mkdtemp(resolve(tmpdir(), "taskdesk-repair-"));
    try {
      const options = { database, pool, migrationsFolder };
      // Fresh install: every migration, including the 0090 grant tables, and no memberships.
      await migrateWithMembershipProvenanceCutover({ ...options, args: [] });
      const journalCount = Number(
        (
          await pool.query<{ n: string }>(
            "select count(*)::text as n from drizzle.__drizzle_migrations",
          )
        ).rows[0]?.n,
      );

      const first = await seedMembership(pool, 1, true);
      const grantCount = async () =>
        Number(
          (
            await pool.query<{ n: string }>(
              "select count(*)::text as n from public.membership_grant",
            )
          ).rows[0]?.n,
        );

      // Startup refuses and points at the preflight; nothing is written.
      await expect(
        migrateWithMembershipProvenanceCutover({ ...options, args: [] }),
      ).rejects.toThrow(
        /incomplete grant projection[\s\S]*db:identity-provenance-preflight/u,
      );
      expect(await grantCount()).toBe(0);

      // An approved record repairs the projection with correct direct/admin grants.
      const record = await writeRecord(dir, "approved.json", [first]);
      const args = ["--membership-provenance-reconciliation", record];
      await migrateWithMembershipProvenanceCutover({ ...options, args });
      const grants = await pool.query(
        `select membership_id, person_id, scope, scope_id, role_id, source_kind,
                direct_origin, granted_by_person_id, sees_all, revoked_at
           from public.membership_grant`,
      );
      expect(grants.rows).toEqual([
        {
          membership_id: first.id,
          person_id: first.personId,
          scope: "organisation",
          scope_id: first.orgId,
          role_id: first.roleId,
          source_kind: "direct",
          direct_origin: "admin",
          granted_by_person_id: "repair-person-1",
          sees_all: false,
          revoked_at: null,
        },
      ]);

      // Re-running, with or without the record, changes nothing.
      await migrateWithMembershipProvenanceCutover({ ...options, args });
      await migrateWithMembershipProvenanceCutover({ ...options, args: [] });
      expect(await grantCount()).toBe(1);
      expect(
        Number(
          (
            await pool.query<{ n: string }>(
              "select count(*)::text as n from drizzle.__drizzle_migrations",
            )
          ).rows[0]?.n,
        ),
      ).toBe(journalCount);

      // A later unresolved row the record does not cover is refused atomically.
      const second = await seedMembership(pool, 2, false);
      await expect(
        migrateWithMembershipProvenanceCutover({ ...options, args }),
      ).rejects.toThrow(/reconciliation refused/u);
      expect(await grantCount()).toBe(1);

      // A record that names an approver who is not an instance admin is refused too.
      const bad = await writeRecord(
        dir,
        "bad.json",
        [second],
        "repair-person-2",
      );
      await expect(
        migrateWithMembershipProvenanceCutover({
          ...options,
          args: ["--membership-provenance-reconciliation", bad],
        }),
      ).rejects.toThrow(/approver is not a current instance admin/u);
      expect(await grantCount()).toBe(1);
    } finally {
      await pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
