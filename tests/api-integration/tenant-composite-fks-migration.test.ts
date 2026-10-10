/**
 * Migration 0119 `tenant_composite_fks` (M1 security review forward item N2).
 *
 * Runs against its OWN dedicated database (never the shared `*_test` target):
 *   1. migrate to exactly 0118 using a temp folder of unmodified copies;
 *   2. seed representative SAME-tenant rows with raw SQL (an upgrade must preserve them);
 *   3. apply 0119 by splitting on `--> statement-breakpoint` (the exact shipped SQL);
 *   4. assert the same-tenant rows survived and both composite FKs exist;
 *   5. assert a cross-tenant insert AND a cross-tenant update is rejected for each new
 *      composite FK (SQLSTATE 23503), and that a workspace delete still cascades.
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
const CUTOFF_TAG = "0118_fair_kabuki";
const MIGRATION_TAG = "0119_tenant_composite_fks";
const FK_VIOLATION = "23503";

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

function buildPre0119Folder(): string {
  const journal = JSON.parse(
    readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  const cutoff = journal.entries.findIndex((e) => e.tag === CUTOFF_TAG);
  if (cutoff === -1) throw new Error(`${CUTOFF_TAG} not in journal`);
  const entries = journal.entries.slice(0, cutoff + 1);
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-pre-0119-"));
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

describe("migration 0119_tenant_composite_fks -- N2 tenant-composite foreign keys", () => {
  const baseUrl = requireDatabaseUrl();
  const parentName = new URL(baseUrl).pathname.replace(/^\//, "");
  const dbName = `m0119_fks_${randomUUID().replaceAll("-", "_")}`;
  const dbUrl = withDatabaseName(baseUrl, dbName);
  let folder: string;
  let pool: Pool;

  const orgId = () =>
    pool
      .query("select id from organisation where is_internal = true")
      .then((r) => r.rows[0].id as string);

  async function workspace(id: string, orgIdValue: string) {
    await pool.query(
      "insert into workspace (id, name, slug, organisation_id, created_at) values ($1, $1, $1, $2, now())",
      [id, orgIdValue],
    );
  }
  async function team(id: string, workspaceId: string) {
    await pool.query(
      "insert into team (id, name, workspace_id, created_at) values ($1, $1, $2, now())",
      [id, workspaceId],
    );
  }
  async function outbox(eventId: string, workspaceId: string | null) {
    await pool.query(
      "insert into outbox (event_id, kind, payload, workspace_id) values ($1, $3, '{}'::jsonb, $2)",
      [
        eventId,
        workspaceId,
        workspaceId ? "work_item.created" : "identity.deprovisioned",
      ],
    );
  }
  async function delivery(
    id: string,
    eventId: string,
    workspaceId: string,
    personId: string,
  ) {
    await pool.query(
      "insert into notification_delivery (id, event_id, recipient_person_id, channel, workspace_id, dedupe_key) values ($1, $2, $3, 'notify.email', $4, $1)",
      [id, eventId, personId, workspaceId],
    );
  }
  async function savedView(
    id: string,
    workspaceId: string,
    personId: string,
    teamId: string | null,
  ) {
    await pool.query(
      "insert into saved_view (id, workspace_id, created_by, name, scope, scope_id, visibility, shared_with_team_id, query, layout) values ($1, $2, $3, $1, 'workspace', $2, $4, $5, '{}'::jsonb, 'list')",
      [id, workspaceId, personId, teamId ? "team" : "private", teamId],
    );
  }

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
    folder = buildPre0119Folder();
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

  it("upgrades 0118 -> 0119 preserving same-tenant rows, then rejects every cross-tenant reference", async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const org = await orgId();

    // Pre-0119 state: two workspaces, a team in each, a person, same-tenant rows.
    await workspace("wsA", org);
    await workspace("wsB", org);
    await team("teamA", "wsA");
    await team("teamB", "wsB");
    await pool.query(
      "insert into person (id, organisation_id, side) values ('p1', $1, 'internal')",
      [org],
    );
    await outbox("evA", "wsA");
    await outbox("evB", "wsB");
    await outbox("evInstance", null);
    await delivery("dA", "evA", "wsA", "p1");
    await savedView("svA", "wsA", "p1", "teamA");
    await savedView("svPrivate", "wsA", "p1", null);

    // Apply the shipped 0119 SQL verbatim.
    const statements = readFileSync(
      join(drizzleFolder, `${MIGRATION_TAG}.sql`),
      "utf8",
    ).split("--> statement-breakpoint");
    for (const statement of statements) {
      if (statement.trim()) await pool.query(statement);
    }

    // Same-tenant rows preserved.
    const dRows = await pool.query(
      "select workspace_id, event_id from notification_delivery where id = 'dA'",
    );
    expect(dRows.rows).toEqual([{ workspace_id: "wsA", event_id: "evA" }]);
    const svRows = await pool.query(
      "select id, shared_with_team_id from saved_view order by id",
    );
    expect(svRows.rows).toEqual([
      { id: "svA", shared_with_team_id: "teamA" },
      { id: "svPrivate", shared_with_team_id: null },
    ]);

    // Constraint inventory: composite FKs exist, the old single-column FKs are gone.
    const cons = await pool.query(
      "select conname from pg_constraint where conname = any($1)",
      [
        [
          "notification_delivery_workspace_event_fk",
          "saved_view_workspace_shared_team_fk",
          "outbox_event_id_workspace_id_unique",
          "team_workspace_id_id_unique",
          "notification_delivery_event_id_outbox_event_id_fk",
          "saved_view_shared_with_team_id_team_id_fk",
        ],
      ],
    );
    expect(cons.rows.map((r) => r.conname).sort()).toEqual([
      "notification_delivery_workspace_event_fk",
      "outbox_event_id_workspace_id_unique",
      "saved_view_workspace_shared_team_fk",
      "team_workspace_id_id_unique",
    ]);

    // saved_view -> team: cross-tenant insert and update rejected; same-tenant ok.
    expect(await sqlState(savedView("svX", "wsA", "p1", "teamB"))).toBe(
      FK_VIOLATION,
    );
    expect(
      await sqlState(
        pool.query(
          "update saved_view set shared_with_team_id = 'teamB' where id = 'svA'",
        ),
      ),
    ).toBe(FK_VIOLATION);
    expect(await sqlState(savedView("svOk", "wsB", "p1", "teamB"))).toBeNull();

    // notification_delivery -> outbox: delivery workspace must equal the event's workspace.
    expect(await sqlState(delivery("dX", "evB", "wsA", "p1"))).toBe(
      FK_VIOLATION,
    );
    expect(
      await sqlState(
        pool.query(
          "update notification_delivery set workspace_id = 'wsB' where id = 'dA'",
        ),
      ),
    ).toBe(FK_VIOLATION);
    // An instance-scoped event (NULL workspace) can never back a workspace delivery.
    expect(await sqlState(delivery("dI", "evInstance", "wsA", "p1"))).toBe(
      FK_VIOLATION,
    );
    expect(await sqlState(delivery("dOk", "evB", "wsB", "p1"))).toBeNull();

    // Deleting the outbox event still cascades to its delivery (ON DELETE cascade kept).
    await pool.query("delete from outbox where event_id = 'evA'");
    const gone = await pool.query(
      "select 1 from notification_delivery where id = 'dA'",
    );
    expect(gone.rowCount).toBe(0);

    // A direct team delete is still refused while a view shares it ...
    expect(
      await sqlState(pool.query("delete from team where id = 'teamB'")),
    ).toBe(FK_VIOLATION);
    // ... but deleting the whole workspace still cascades team + views in one statement.
    expect(
      await sqlState(pool.query("delete from workspace where id = 'wsB'")),
    ).toBeNull();
    const left = await pool.query(
      "select count(*)::int as n from saved_view where workspace_id = 'wsB'",
    );
    expect(left.rows[0].n).toBe(0);
  });

  it("0119 is present in the journal with a `when` above 0118's", () => {
    const journal = JSON.parse(
      readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string; when: number }> };
    const prior = journal.entries.find((e) => e.tag === CUTOFF_TAG);
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    expect(prior).toBeDefined();
    expect(entry).toBeDefined();
    expect(entry?.when).toBeGreaterThan(prior?.when ?? Number.POSITIVE_INFINITY);
  });
});
