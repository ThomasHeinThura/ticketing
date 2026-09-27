/**
 * Migration 0073 / issue #27, following the `activity`/`task_activity` precedent from
 * migration 0066 (`work-item-activity-table.test.ts`'s own guard describe). Real
 * PostgreSQL 18 catalog queries against a database migrated through 0073+0074 -- `ALTER
 * TABLE "comment" RENAME TO "task_comment"` only renames the table itself; every
 * constraint and index name is an independent catalog string that survives untouched
 * unless renamed explicitly (migration 0073's own comment lists the exact query used to
 * find them all: `pg_constraint`/`pg_indexes` against a database at the migration's own
 * parent head, 0072). Left unrenamed, any of them collides with the NEW `comment` table's
 * own auto-named objects in migration 0074 -- Postgres resolves the collision by
 * appending `1` (`comment_pkey1` etc.), a working-looking migration with a landmine name.
 * This asserts the migration actually renamed every one of them, the same class of gap
 * PR #322 shipped past a green suite for a different table.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

describe("migration 0073 -- no comment_-named catalog object survives on task_comment", () => {
  it("no constraint or index on task_comment starts with comment_", async () => {
    await resetTestDatabase();

    const constraintRows = await db.execute(sql`
      select conname from pg_constraint
      where conrelid = 'task_comment'::regclass
        and conname like 'comment\\_%'
    `);
    expect(constraintRows.rows).toHaveLength(0);

    const indexRows = await db.execute(sql`
      select indexname from pg_indexes
      where tablename = 'task_comment'
        and indexname like 'comment\\_%'
    `);
    expect(indexRows.rows).toHaveLength(0);
  });

  it("the new comment table's own primary key is exactly comment_pkey (no _1 collision suffix)", async () => {
    await resetTestDatabase();

    const pkeyRows = await db.execute(sql`
      select conname from pg_constraint
      where conrelid = 'comment'::regclass
        and contype = 'p'
    `);
    expect(pkeyRows.rows).toHaveLength(1);
    expect(pkeyRows.rows[0]).toMatchObject({ conname: "comment_pkey" });
  });

  it("task_comment's own indexes and foreign keys carry the task_comment_ prefix, not comment_", async () => {
    await resetTestDatabase();

    const indexRows = await db.execute(sql`
      select indexname from pg_indexes where tablename = 'task_comment'
    `);
    const indexNames = indexRows.rows.map((r) => r.indexname as string);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "task_comment_task_idx",
        "task_comment_user_idx",
      ]),
    );

    const fkRows = await db.execute(sql`
      select conname from pg_constraint
      where conrelid = 'task_comment'::regclass and contype = 'f'
    `);
    const fkNames = fkRows.rows.map((r) => r.conname as string);
    expect(fkNames.sort()).toEqual(
      [
        "task_comment_task_id_task_id_fk",
        "task_comment_user_id_user_id_fk",
      ].sort(),
    );
  });
});
