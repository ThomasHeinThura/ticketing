-- Issue #27, following the `activity`/`task_activity` precedent (decision log
-- 2026-09-23, migration 0066): kaneo's original `comment` table (task/comment row,
-- keyed on `task_id`) is renamed to `task_comment` so `data-model.md` §4's own
-- work-item-scoped `comment` table can be created under the name it actually names
-- (migration 0074). Drizzle's own diff only renames the table itself, the two
-- explicitly-named foreign keys and the two explicitly-named indexes (all generated
-- below, unedited) -- it does NOT know to rename the objects Postgres auto-named when
-- the table was first created and never given an explicit name in `schema.ts`
-- (`.primaryKey()` alone, no `not null` constraint name of its own): the primary key
-- (`comment_pkey`) and, on Postgres 18 only, each column's own `NOT NULL` constraint.
-- Confirmed exhaustive by querying `pg_constraint`/`pg_indexes` for `"comment"` against
-- a database migrated to this migration's own parent head (0072) -- not guessed; see
-- this PR's body for the exact query and result. Left unrenamed, every one of these
-- would collide with the new `comment` table's own auto-named objects in migration
-- 0074 (Postgres resolves the collision by appending `1`, `comment_pkey1` etc., the
-- same silent landmine 0066's own comment describes).
ALTER TABLE "comment" RENAME TO "task_comment";--> statement-breakpoint
-- `RENAME CONSTRAINT` on a primary key also renames its backing index in the same
-- statement (Postgres keeps the two in sync) -- confirmed live: a separate `ALTER INDEX
-- ... RENAME` immediately after this raised `relation "comment_pkey" does not exist`,
-- because the index no longer had that name by the time it ran.
ALTER TABLE "task_comment" RENAME CONSTRAINT "comment_pkey" TO "task_comment_pkey";--> statement-breakpoint
-- Same Postgres-18-only guard 0066 uses: on 16/17 these five constraints do not exist
-- as named catalog objects at all, so an unconditional `RENAME CONSTRAINT` against a
-- name that does not exist would fail this migration (and every migration after it, in
-- the same transaction) outright below that version. A no-op on 16/17, identical to the
-- unconditional form on 18.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"task_comment"'::regclass AND conname = 'comment_id_not_null'
  ) THEN
    ALTER TABLE "task_comment" RENAME CONSTRAINT "comment_id_not_null" TO "task_comment_id_not_null";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"task_comment"'::regclass AND conname = 'comment_task_id_not_null'
  ) THEN
    ALTER TABLE "task_comment" RENAME CONSTRAINT "comment_task_id_not_null" TO "task_comment_task_id_not_null";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"task_comment"'::regclass AND conname = 'comment_content_not_null'
  ) THEN
    ALTER TABLE "task_comment" RENAME CONSTRAINT "comment_content_not_null" TO "task_comment_content_not_null";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"task_comment"'::regclass AND conname = 'comment_created_at_not_null'
  ) THEN
    ALTER TABLE "task_comment" RENAME CONSTRAINT "comment_created_at_not_null" TO "task_comment_created_at_not_null";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"task_comment"'::regclass AND conname = 'comment_updated_at_not_null'
  ) THEN
    ALTER TABLE "task_comment" RENAME CONSTRAINT "comment_updated_at_not_null" TO "task_comment_updated_at_not_null";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"task_comment"'::regclass AND conname = 'comment_user_id_not_null'
  ) THEN
    ALTER TABLE "task_comment" RENAME CONSTRAINT "comment_user_id_not_null" TO "task_comment_user_id_not_null";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "task_comment" DROP CONSTRAINT "comment_task_id_task_id_fk";
--> statement-breakpoint
ALTER TABLE "task_comment" DROP CONSTRAINT "comment_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "comment_task_idx";--> statement-breakpoint
DROP INDEX "comment_user_idx";--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_comment_task_idx" ON "task_comment" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_comment_user_idx" ON "task_comment" USING btree ("user_id");
