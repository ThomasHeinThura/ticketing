/**
 * Issue #118 — `workspace_role` must not permit two privilege definitions for one
 * `(workspace_id, role)`.
 *
 * THE DEFECT. `apps/api/src/database/schema.ts` declares two PLAIN indexes on this table and
 * never a `uniqueIndex`, so duplicate `(workspace_id, role)` rows with *different* `permission`
 * payloads insert cleanly — reachable without a race, because better-auth's `createOrgRole`
 * performs no duplicate-name check. Both evaluators that read the table
 * (`customRoleStatements`, `ownRoleStatements`) select with `.limit(1)` and no `ORDER BY`, so
 * the capability answer for a member holding that role becomes heap order, and an unrelated
 * `UPDATE` can reverse it. Same defect class as #77/#88 (`workspace_member`) and #82
 * (`workspace_member.role`), for a third table.
 *
 * THIS FILE IS THE ORACLE FOR THE MIGRATION'S RECOVERY STRATEGY, and it executes the migration's
 * OWN SQL -- read from the file that ships -- against a real PostgreSQL, the way the `0050`
 * suite does one table over. Four behaviours, and the first is what makes the other three mean
 * anything:
 *
 *   A. NON-VACUITY -- before the constraint exists, a conflicting duplicate INSERTS. Without
 *      this, every assertion below would also pass on a database that never had the defect.
 *   B. HEALTHY data passes through untouched and gains the constraint.
 *   C. IDENTICAL duplicates are REPAIRED to one row -- they are one definition written twice,
 *      so collapsing them decides nobody's privileges.
 *   D. CONFLICTING duplicates REFUSE: the migration raises, names the pair and both row ids,
 *      and leaves the data exactly as it was. It never picks one definition.
 *
 * MIGRATION NUMBER IS PROVISIONAL. This file reads the migration by its placeholder name; see
 * that file's header. Renaming it through `pnpm db:generate` against the landed base also
 * updates the path below.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  signUpUser,
} from "./helpers/organization-http";

const CONSTRAINT = "workspace_role_workspace_id_role_unique";

/** The statements of the #118 migration, from the file that actually ships. */
async function migrationStatements(): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(
    here,
    "../../apps/api/drizzle/NEXT_workspace_role_unique.sql",
  );
  const source = await readFile(path, "utf8");
  return source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Drops the constraint so a section can reproduce the pre-migration state the migration exists
 * to clean up. Every section that calls this must re-add it (or run the migration, which does).
 */
async function withoutRoleUniqueConstraint(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "workspace_role" DROP CONSTRAINT IF EXISTS ${sql.raw(`"${CONSTRAINT}"`)}`,
  );
}

async function constraintExists(): Promise<boolean> {
  const result = await db.execute<{ conname: string }>(sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'workspace_role'::regclass AND contype = 'u'
      AND conname = ${CONSTRAINT}
  `);
  return result.rows.length === 1;
}

/**
 * A real workspace row, so the FK from `workspace_role.workspace_id` is satisfied.
 *
 * NOTE THE SEEDING, because it silently changes what a "duplicate" is here: creating a workspace
 * seeds `viewer`, `member` and `admin` into `workspace_role`. So inserting a row named `viewer`
 * is not "an unrelated third role" -- it is a SECOND definition for a pair that already has one,
 * which is exactly the conflict this migration refuses. These tests therefore use role names the
 * seed never creates (`manager`, `auditor`). Found the honest way: the first draft of this file
 * used `viewer` as its control row and the migration correctly refused.
 */
async function aWorkspace(): Promise<string> {
  const { app } = createApp();
  await signUpUser(app); // instance-admin slot, for the same reason the 0050 suite burns it
  const owner = await signUpUser(app);
  const created = await createWorkspaceViaPlugin(app, owner.cookie);
  return ((await created.json()) as { id: string }).id;
}

async function insertRole(
  id: string,
  workspaceId: string,
  role: string,
  permission: string,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO "workspace_role" ("id","workspace_id","role","permission","created_at","updated_at")
        VALUES (${id}, ${workspaceId}, ${role}, ${permission}, now(), now())`,
  );
}

async function rowsFor(
  workspaceId: string,
  role: string,
): Promise<Array<{ id: string; permission: string }>> {
  const result = await db.execute<{ id: string; permission: string }>(sql`
    SELECT id, permission FROM "workspace_role"
    WHERE workspace_id = ${workspaceId} AND role = ${role} ORDER BY id
  `);
  return result.rows;
}

beforeEach(async () => {
  await resetTestDatabase();
  await withoutRoleUniqueConstraint();
});

describe("#118 A -- NON-VACUITY: the defect is reachable before the constraint exists", () => {
  it("two rows for one (workspace_id, role) with DIFFERENT permission payloads both insert", async () => {
    const workspaceId = await aWorkspace();
    await insertRole(
      "nv1",
      workspaceId,
      "manager",
      '{"organization":["update"]}',
    );
    await insertRole(
      "nv2",
      workspaceId,
      "manager",
      '{"organization":["delete"]}',
    );

    const rows = await rowsFor(workspaceId, "manager");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.permission)).size).toBe(2);
    expect(await constraintExists()).toBe(false);
  });
});

describe("#118 B -- healthy data passes through untouched and gains the constraint", () => {
  it("runs every statement, changes no rows, and leaves the unique constraint in place", async () => {
    const workspaceId = await aWorkspace();
    await insertRole(
      "h1",
      workspaceId,
      "manager",
      '{"organization":["update"]}',
    );
    await insertRole("h2", workspaceId, "auditor", '{"project":["read"]}');

    for (const statement of await migrationStatements()) {
      await db.execute(sql.raw(statement));
    }

    expect(await rowsFor(workspaceId, "manager")).toHaveLength(1);
    expect(await rowsFor(workspaceId, "auditor")).toHaveLength(1);
    expect(await constraintExists()).toBe(true);
  });
});

describe("#118 C -- identical duplicates are REPAIRED, because they decide nobody's privileges", () => {
  it("collapses two byte-identical rows to one and leaves an unrelated role alone", async () => {
    const workspaceId = await aWorkspace();
    await insertRole(
      "c1",
      workspaceId,
      "manager",
      '{"organization":["update"]}',
    );
    await insertRole(
      "c2",
      workspaceId,
      "manager",
      '{"organization":["update"]}',
    );
    await insertRole("c3", workspaceId, "auditor", '{"project":["read"]}');

    for (const statement of await migrationStatements()) {
      await db.execute(sql.raw(statement));
    }

    const managers = await rowsFor(workspaceId, "manager");
    expect(managers).toHaveLength(1);
    // The surviving row carries the same definition -- the repair changed no authority.
    expect(managers[0]?.permission).toBe('{"organization":["update"]}');
    expect(await rowsFor(workspaceId, "auditor")).toHaveLength(1);
    expect(await constraintExists()).toBe(true);
  });
});

describe("#118 D -- conflicting duplicates REFUSE rather than picking a definition", () => {
  it("raises, names the pair and both rows, and leaves the data exactly as it was", async () => {
    const workspaceId = await aWorkspace();
    await insertRole(
      "d1",
      workspaceId,
      "manager",
      '{"organization":["update"]}',
    );
    await insertRole(
      "d2",
      workspaceId,
      "manager",
      '{"organization":["delete"]}',
    );

    const statements = await migrationStatements();
    const repair = statements[0];
    const refuse = statements[1];
    if (!repair || !refuse)
      throw new Error("#118 migration is missing statements");

    // The repair pass must leave a genuine disagreement ALONE -- it has no single meaning.
    await db.execute(sql.raw(repair));
    expect(await rowsFor(workspaceId, "manager")).toHaveLength(2);

    // And the refusal pass must stop the migration, naming what it refused to decide.
    // Drizzle wraps the driver error; the RAISE text is on `cause`, not the outer message.
    const failure = await db.execute(sql.raw(refuse)).then(
      () => null,
      (error: unknown) => error as { cause?: { message?: string } },
    );
    expect(failure).not.toBeNull();
    const raised = failure?.cause?.message ?? "";
    expect(raised).toMatch(/#118/);
    expect(raised).toContain(workspaceId);
    expect(raised).toMatch(/manager/);
    expect(raised).toContain("d1");
    expect(raised).toContain("d2");

    // Nothing was deleted and no constraint was added by a refused migration.
    expect(await rowsFor(workspaceId, "manager")).toHaveLength(2);
    expect(await constraintExists()).toBe(false);
  });

  it("a duplicate insert FAILS once the constraint is in place -- the state cannot return", async () => {
    const workspaceId = await aWorkspace();
    await insertRole(
      "e1",
      workspaceId,
      "manager",
      '{"organization":["update"]}',
    );
    for (const statement of await migrationStatements()) {
      await db.execute(sql.raw(statement));
    }

    const failure = await insertRole(
      "e2",
      workspaceId,
      "manager",
      '{"organization":["delete"]}',
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).not.toBeNull();
    expect(await rowsFor(workspaceId, "manager")).toHaveLength(1);

    // Still writable for a DIFFERENT role -- the constraint is narrow, not a blanket block.
    await insertRole("e3", workspaceId, "auditor", '{"project":["read"]}');
    expect(await rowsFor(workspaceId, "auditor")).toHaveLength(1);
  });
});
