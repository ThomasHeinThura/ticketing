-- Decision log 2026-09-23, "Work-item activity gets its own `activity` table; kaneo's
-- becomes `task_activity`". Two things happen in this migration:
--
--   1. Kaneo's original `activity` table (task/comment journal, keyed on `task_id`) is
--      renamed to `task_activity`, together with its indexes and unique constraint.
--      Only names change -- data, columns and every legacy task/comment route keep
--      working. Its foreign keys need no ALTER: Postgres tracks a referencing constraint
--      by the referenced table's OID, not its name, so `asset.activity_id`'s existing FK
--      (and every other) simply continues to point at the renamed table.
--   2. The new work-item `activity` table (data-model.md S4; CA-6/CA-7) is created under
--      the now-free name `activity`.
--
-- See `apps/api/src/database/schema.ts`'s comments on `taskActivityTable` and
-- `activityTable` for the full design, including the one judgment call/gap this
-- migration does NOT close: `activity.work_item_id` is a plain single-column FK to
-- `work_item.id`, not the composite `(workspace_id, work_item_id) -> work_item
-- (workspace_id, id)` FK the decision log's detail 1 asks for, because `work_item` does
-- not yet carry the `UNIQUE (workspace_id, id)` target index that FK needs. Flagged in
-- this PR's "Not done" section rather than added here, per this task's own instructions.

ALTER TABLE "activity" RENAME TO "task_activity";--> statement-breakpoint
ALTER INDEX "activity_task_id_idx" RENAME TO "task_activity_task_id_idx";--> statement-breakpoint
ALTER INDEX "activity_userId_idx" RENAME TO "task_activity_userId_idx";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_task_external_source_external_url_unique" TO "task_activity_task_external_source_external_url_unique";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_task_id_task_id_fk" TO "task_activity_task_id_task_id_fk";--> statement-breakpoint
ALTER TABLE "task_activity" RENAME CONSTRAINT "activity_user_id_user_id_fk" TO "task_activity_user_id_user_id_fk";--> statement-breakpoint
-- drizzle's own FK-naming convention embeds the referenced table's name
-- (`<table>_<column>_<refTable>_<refColumn>_fk`), so `asset`'s existing FK to this
-- renamed table is renamed too, to keep `drizzle-kit generate` computing a clean diff
-- against this migration going forward. No behaviour change: same columns, same ON
-- DELETE/UPDATE actions.
ALTER TABLE "asset" RENAME CONSTRAINT "asset_activity_id_activity_id_fk" TO "asset_activity_id_task_activity_id_fk";--> statement-breakpoint
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
ALTER TABLE "activity" ADD CONSTRAINT "activity_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_work_item_id_created_at_idx" ON "activity" USING btree ("work_item_id","created_at" DESC NULLS LAST,"seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_workspaceId_idx" ON "activity" USING btree ("workspace_id");
