/**
 * Migration 0120 `approval_workspace_anchor` (owner decision 2026-10-10, ledger "Still open").
 *
 * Each test runs against its OWN dedicated database (never the shared `*_test` target):
 *   1. upgrade: migrate to exactly 0119 using a temp folder of unmodified copies, seed
 *      approval rows in two workspaces with raw SQL, apply 0120 by splitting on
 *      `--> statement-breakpoint` (the exact shipped SQL), then assert the backfill, the
 *      constraint inventory, and that every cross-tenant insert/update is rejected;
 *   2. clean replay: migrate 0000 -> latest from the real folder and assert the same shape.
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
const CUTOFF_TAG = "0119_tenant_composite_fks";
const MIGRATION_TAG = "0120_approval_workspace_anchor";
const FK_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";

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

function buildPre0120Folder(): string {
  const journal = JSON.parse(
    readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  const cutoff = journal.entries.findIndex((e) => e.tag === CUTOFF_TAG);
  if (cutoff === -1) throw new Error(`${CUTOFF_TAG} not in journal`);
  const entries = journal.entries.slice(0, cutoff + 1);
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-pre-0120-"));
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

async function sqlState(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const NEW_CONSTRAINTS = [
  "approval_workspace_id_workspace_id_fk",
  "approval_workspace_work_item_fk",
];
const OLD_CONSTRAINT = "approval_work_item_id_work_item_id_fk";

describe("migration 0120_approval_workspace_anchor -- approval tenant anchor", () => {
  const baseUrl = requireDatabaseUrl();
  const parentName = new URL(baseUrl).pathname.replace(/^\//, "");
  const created: string[] = [];
  let folder: string;

  async function createDatabase(prefix: string): Promise<Pool> {
    const name = `${prefix}_${randomUUID().replaceAll("-", "_")}`;
    const admin = new Client({
      connectionString: withDatabaseName(baseUrl, "postgres"),
    });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
    } finally {
      await admin.end();
    }
    created.push(name);
    return new Pool({ connectionString: withDatabaseName(baseUrl, name) });
  }

  async function seedTenant(pool: Pool, ws: string, orgId: string) {
    const q = (text: string, values: unknown[] = []) =>
      pool.query(text, values);
    await q(
      "insert into workspace (id, name, slug, organisation_id, created_at) values ($1, $1, $1, $2, now())",
      [ws, orgId],
    );
    await q(
      "insert into project (id, workspace_id, slug, name) values ($1, $2, $1, $1)",
      [`${ws}-proj`, ws],
    );
    await q(
      "insert into work_item_type (id, workspace_id, key, name, category) values ($1, $2, 'task', 'Task', 'service')",
      [`${ws}-type`, ws],
    );
    await q(
      "insert into state_template (id, workspace_id, key, name, \"group\") values ($1, $2, 'open', 'Open', 'unstarted')",
      [`${ws}-tpl`, ws],
    );
    await q(
      "insert into state (id, project_id, state_template_id) values ($1, $2, $3)",
      [`${ws}-state`, `${ws}-proj`, `${ws}-tpl`],
    );
    await q(
      "insert into workflow (id, workspace_id, key, name) values ($1, $2, 'wf', 'wf')",
      [`${ws}-wf`, ws],
    );
    await q(
      "insert into workflow_version (id, workflow_id, number) values ($1, $2, 1)",
      [`${ws}-wfv`, `${ws}-wf`],
    );
    await q(
      "insert into workflow_transition (id, version_id, to_state_template_id) values ($1, $2, $3)",
      [`${ws}-tr`, `${ws}-wfv`, `${ws}-tpl`],
    );
    for (const n of [1, 2]) {
      await q(
        "insert into work_item (id, project_id, type_id, number, key, title, state_id, workspace_id) values ($1, $2, $3, $4, $5, 't', $6, $7)",
        [
          `${ws}-wi${n}`,
          `${ws}-proj`,
          `${ws}-type`,
          n,
          `${ws}-${n}`,
          `${ws}-state`,
          ws,
        ],
      );
    }
  }

  async function personId(pool: Pool, orgId: string) {
    await pool.query(
      "insert into person (id, organisation_id, side) values ('p1', $1, 'internal') on conflict do nothing",
      [orgId],
    );
  }

  const insertApproval = (
    pool: Pool,
    id: string,
    workspaceId: string | null,
    workItemId: string,
    transitionId: string,
  ) =>
    pool.query(
      "insert into approval (id, workspace_id, work_item_id, transition_id, kind, requested_by, approver_id, expires_at) values ($1, $2, $3, $4, 'customer', 'p1', 'p1', now() + interval '7 days')",
      [id, workspaceId, workItemId, transitionId],
    );

  /** Pre-0120 insert: the column does not exist yet. */
  const insertLegacyApproval = (
    pool: Pool,
    id: string,
    workItemId: string,
    transitionId: string,
  ) =>
    pool.query(
      "insert into approval (id, work_item_id, transition_id, kind, requested_by, approver_id, expires_at) values ($1, $2, $3, 'customer', 'p1', 'p1', now() + interval '7 days')",
      [id, workItemId, transitionId],
    );

  const orgOf = (pool: Pool) =>
    pool
      .query("select id from organisation where is_internal = true")
      .then((r) => r.rows[0].id as string);

  async function assertAnchoredShape(pool: Pool) {
    const cons = await pool.query(
      "select conname from pg_constraint where conrelid = 'approval'::regclass and conname = any($1)",
      [[...NEW_CONSTRAINTS, OLD_CONSTRAINT]],
    );
    expect(cons.rows.map((r) => r.conname).sort()).toEqual(NEW_CONSTRAINTS);
    const fk = await pool.query(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'approval_workspace_work_item_fk'",
    );
    expect(fk.rows[0].def).toBe(
      "FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_item(workspace_id, id) ON DELETE CASCADE",
    );
    const col = await pool.query(
      "select is_nullable from information_schema.columns where table_name = 'approval' and column_name = 'workspace_id'",
    );
    expect(col.rows).toEqual([{ is_nullable: "NO" }]);
    const idx = await pool.query(
      "select 1 from pg_indexes where tablename = 'approval' and indexname = 'approval_workspaceId_idx'",
    );
    expect(idx.rowCount).toBe(1);
  }

  async function assertCrossTenantRejected(pool: Pool) {
    // A mismatched workspace is refused in both directions, as insert and as update.
    expect(
      await sqlState(insertApproval(pool, "x1", "wsA", "wsB-wi1", "wsA-tr")),
    ).toBe(FK_VIOLATION);
    expect(
      await sqlState(insertApproval(pool, "x2", "wsB", "wsA-wi1", "wsB-tr")),
    ).toBe(FK_VIOLATION);
    expect(
      await sqlState(
        pool.query("update approval set workspace_id = 'wsB' where id = 'aA1'"),
      ),
    ).toBe(FK_VIOLATION);
    expect(
      await sqlState(
        pool.query(
          "update approval set work_item_id = 'wsB-wi1' where id = 'aA1'",
        ),
      ),
    ).toBe(FK_VIOLATION);
    // The column is NOT NULL and an unknown workspace is refused.
    expect(
      await sqlState(insertApproval(pool, "x3", null, "wsA-wi1", "wsA-tr")),
    ).toBe(NOT_NULL_VIOLATION);
    expect(
      await sqlState(insertApproval(pool, "x4", "wsNope", "wsA-wi1", "wsA-tr")),
    ).toBe(FK_VIOLATION);
    // Same-tenant control.
    expect(
      await sqlState(insertApproval(pool, "ok1", "wsA", "wsA-wi2", "wsA-tr")),
    ).toBeNull();
    // A work item's workspace cannot be moved out from under its approvals.
    expect(
      await sqlState(
        pool.query(
          "update work_item set workspace_id = 'wsB' where id = 'wsA-wi2'",
        ),
      ),
    ).not.toBeNull();
    // Deleting a work item cascades to its approvals.
    await pool.query("delete from work_item where id = 'wsA-wi2'");
    const gone = await pool.query(
      "select count(*)::int as n from approval where work_item_id = 'wsA-wi2'",
    );
    expect(gone.rows[0].n).toBe(0);
  }

  beforeAll(() => {
    if (!parentName.endsWith("_test")) {
      throw new Error(
        `Refusing to run against non-test database ${parentName}`,
      );
    }
    folder = buildPre0120Folder();
  });

  afterAll(async () => {
    if (folder) rmSync(folder, { recursive: true, force: true });
    const admin = new Client({
      connectionString: withDatabaseName(baseUrl, "postgres"),
    });
    await admin.connect();
    try {
      for (const name of created) {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [name],
        );
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
      }
    } finally {
      await admin.end();
    }
  });

  it("upgrades 0119 -> 0120 backfilling workspace_id from the work item, then rejects every cross-tenant reference", async () => {
    const pool = await createDatabase("m0120_up");
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
      const org = await orgOf(pool);
      await seedTenant(pool, "wsA", org);
      await seedTenant(pool, "wsB", org);
      await personId(pool, org);

      // Pre-0120: approvals exist with no workspace_id column.
      const before = await pool.query(
        "select 1 from information_schema.columns where table_name = 'approval' and column_name = 'workspace_id'",
      );
      expect(before.rowCount).toBe(0);
      await insertLegacyApproval(pool, "aA1", "wsA-wi1", "wsA-tr");
      await insertLegacyApproval(pool, "aA2", "wsA-wi2", "wsA-tr");
      await insertLegacyApproval(pool, "aB1", "wsB-wi1", "wsB-tr");

      // Apply the shipped 0120 SQL verbatim.
      const statements = readFileSync(
        join(drizzleFolder, `${MIGRATION_TAG}.sql`),
        "utf8",
      ).split("--> statement-breakpoint");
      for (const statement of statements) {
        if (statement.trim()) await pool.query(statement);
      }

      // Backfill: each approval takes its own work item's workspace, none is left NULL.
      const rows = await pool.query(
        "select a.id, a.workspace_id, w.workspace_id as item_workspace from approval a join work_item w on w.id = a.work_item_id order by a.id",
      );
      expect(rows.rows).toEqual([
        { id: "aA1", workspace_id: "wsA", item_workspace: "wsA" },
        { id: "aA2", workspace_id: "wsA", item_workspace: "wsA" },
        { id: "aB1", workspace_id: "wsB", item_workspace: "wsB" },
      ]);

      await assertAnchoredShape(pool);
      await assertCrossTenantRejected(pool);
    } finally {
      await pool.end();
    }
  });

  it("clean replay 0000 -> latest produces the anchored shape and rejects cross-tenant references", async () => {
    const pool = await createDatabase("m0120_clean");
    try {
      await migrate(drizzle(pool), { migrationsFolder: drizzleFolder });
      const org = await orgOf(pool);
      await seedTenant(pool, "wsA", org);
      await seedTenant(pool, "wsB", org);
      await personId(pool, org);
      await insertApproval(pool, "aA1", "wsA", "wsA-wi1", "wsA-tr");
      await assertAnchoredShape(pool);
      await assertCrossTenantRejected(pool);
    } finally {
      await pool.end();
    }
  });

  it("0120 is in the journal with a `when` above 0119's", () => {
    const journal = JSON.parse(
      readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string; when: number }> };
    const prior = journal.entries.find((e) => e.tag === CUTOFF_TAG);
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    expect(prior).toBeDefined();
    expect(entry).toBeDefined();
    expect(entry?.when).toBeGreaterThan(
      prior?.when ?? Number.POSITIVE_INFINITY,
    );
  });
});
