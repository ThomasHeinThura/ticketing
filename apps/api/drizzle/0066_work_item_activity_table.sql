-- Decision log 2026-09-23, "Work-item activity gets its own `activity` table; kaneo's
-- becomes `task_activity`". Three things happen in this migration:
--
--   1. Kaneo's original `activity` table (task/comment journal, keyed on `task_id`) is
--      renamed to `task_activity`, together with EVERY remaining `activity_`-named
--      catalog object on it: its two indexes, its unique constraint, its two foreign
--      keys, its primary key (`activity_pkey`), and -- Postgres 18 catalogues these
--      too -- each column's `NOT NULL` constraint (`activity_id_not_null`,
--      `activity_task_id_not_null`, `activity_type_not_null`,
--      `activity_created_at_not_null`, `activity_updated_at_not_null`). `ALTER TABLE ...
--      RENAME TO` only renames the table itself; every constraint/index name is an
--      independent catalog string that survives untouched unless renamed explicitly, so
--      leaving any of these unrenamed would collide with the new `activity` table's own
--      auto-named objects below (Postgres resolves the collision by appending `1`,
--      `activity_pkey1` etc., which is a silent landmine, not a working migration).
--      Confirmed exhaustive by querying `pg_constraint`/`pg_indexes` for `activity`
--      against a database migrated to this migration's own parent head (main, before
--      this PR) -- not guessed. Only names change here -- data, columns and every legacy
--      task/comment route keep working. Its foreign keys need no ALTER beyond the
--      rename above: Postgres tracks a referencing constraint by the referenced table's
--      OID, not its name, so `asset.activity_id`'s existing FK (and every other) simply
--      continues to point at the renamed table.
--   2. `work_item` gains `UNIQUE (workspace_id, id)` (`work_item_workspace_id_id_unique`)
--      -- it previously carried only `UNIQUE (project_id, id)`
--      (`work_item_project_id_id_unique`); #192/#191 composite-scoped `type_id`/
--      `state_id`/`parent_id` against `project_id` and `work_item_type.workspace_id`,
--      never against a `work_item (workspace_id, id)` target, so this is the first FK to
--      need one. Named following the `work_item_type_workspace_id_id_unique` precedent.
--   3. The new work-item `activity` table (data-model.md S4; CA-6/CA-7) is created under
--      the now-free name `activity`, with `(workspace_id, work_item_id)` composite-FK'd
--      to `work_item (workspace_id, id)` -- the decision log's detail 1 -- targeting the
--      unique index from step 2. `ON UPDATE NO ACTION` (never `CASCADE`), per #191's O1
--      finding: this FK's referenced columns include the mutable `work_item.workspace_id`.
--      `ON DELETE RESTRICT`: activity is kept forever as the journal; work items are
--      soft-deleted, never hard-deleted.
--
-- The composite FK constraint name (`activity_workspace_id_work_item_id_work_item_
-- workspace_id_id_fk`) is exactly 63 bytes -- checked against issue #241 (a sibling
-- composite FK's name silently truncated at 64 bytes) -- so it is NOT truncated.
--
-- See `apps/api/src/database/schema.ts`'s comments on `taskActivityTable` and
-- `activityTable` for the full design.

ALTER TABLE "activity" RENAME TO "task_activity";--> statement-breakpoint
ALTER INDEX "activity_task_id_idx" RENAME TO "task_activity_task_id_idx";--> statement-breakpoint
ALTER INDEX "activity_userId_idx" RENAME TO "task_activity_userId_idx";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_task_external_source_external_url_unique" TO "task_activity_task_external_source_external_url_unique";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_task_id_task_id_fk" TO "task_activity_task_id_task_id_fk";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_user_id_user_id_fk" TO "task_activity_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_pkey" TO "task_activity_pkey";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_id_not_null" TO "task_activity_id_not_null";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_task_id_not_null" TO "task_activity_task_id_not_null";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_type_not_null" TO "task_activity_type_not_null";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_created_at_not_null" TO "task_activity_created_at_not_null";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_updated_at_not_null" TO "task_activity_updated_at_not_null";--> statement-breakpoint
-- drizzle's own FK-naming convention embeds the referenced table's name
-- (`<table>_<column>_<refTable>_<refColumn>_fk`), so `asset`'s existing FK to this
-- renamed table is renamed too, to keep `drizzle-kit generate` computing a clean diff
-- against this migration going forward. No behaviour change: same columns, same ON
-- DELETE/UPDATE actions.
ALTER TABLE "asset" RENAME CONSTRAINT "asset_activity_id_activity_id_fk" TO "asset_activity_id_task_activity_id_fk";--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_workspace_id_id_unique" UNIQUE("workspace_id","id");--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"verb" text NOT NULL,
	"field" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"payload" jsonb,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"workflow_version_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "activity_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "activity_seq_unique" UNIQUE("seq"),
	CONSTRAINT "activity_visibility_allowed" CHECK ("activity"."visibility" in ('public', 'internal'))
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_workspace_id_work_item_id_work_item_workspace_id_id_fk" FOREIGN KEY ("workspace_id","work_item_id") REFERENCES "public"."work_item"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_work_item_id_created_at_idx" ON "activity" USING btree ("work_item_id","created_at" DESC NULLS LAST,"seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_workspaceId_idx" ON "activity" USING btree ("workspace_id");
