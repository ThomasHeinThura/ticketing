ALTER TABLE "work_item" DROP CONSTRAINT "work_item_type_id_work_item_type_id_fk";
--> statement-breakpoint
-- #192: `work_item` is genuinely empty on every instance today (#23's write path does not
-- exist yet -- nothing anywhere in this codebase or its migrations has ever inserted a
-- `work_item` row), so this column can go straight to NOT NULL with no backfill step.
ALTER TABLE "work_item" ADD COLUMN "workspace_id" text NOT NULL;--> statement-breakpoint
-- #192: unlike `work_item`, `workspace` is NOT empty on a real instance -- kaneo's own
-- create-workspace route is already live, independent of #23. Added nullable first, then
-- backfilled below, then tightened to NOT NULL -- a plain `ADD COLUMN ... NOT NULL` with no
-- default would fail outright against any existing row.
ALTER TABLE "workspace" ADD COLUMN "organisation_id" text;--> statement-breakpoint
-- #192 backfill (F2-shaped, same reasoning as 0061_instance_setting.sql's own backfill):
-- every workspace this codebase can create today is internal -- there is no route yet that
-- creates one for a customer organisation -- so backfilling every existing row to the
-- internal organisation is not a guess, it is what was already true.
--
-- This does NOT assume the internal organisation row already exists at the moment this
-- statement runs. `apps/api/src/index.ts` runs every pending SQL migration (this one
-- included) to completion BEFORE it ever calls `seedInternalOrganisationAndStaffPersons()`
-- for the first time on a given boot, so a database migrating through every pending
-- migration in one shot -- the organisation-table migration (PR #179) through this one --
-- would reach this statement with `organisation` created but still EMPTY: the app-level
-- seed has not run yet this boot. Rather than rely on some PRIOR boot having already
-- seeded it (true for an instance that has booted at least once since PR #179, e.g. the
-- live UAT stack, but not guaranteed for every path a migration can be applied through),
-- this statement seeds the same row itself first, using the identical key/name/is_internal
-- values `apps/api/src/utils/seed-internal-organisation.ts` uses. Idempotent via the
-- existing `organisation_is_internal_unique` partial index (PR #179): if a prior boot (or
-- a concurrent replica applying migrations at the same time) already created it, the WHERE
-- NOT EXISTS below makes this a no-op, and the application seed later this same boot finds
-- the row already present instead of creating a second one. `gen_random_uuid()` is a
-- PostgreSQL 13+ built-in (no extension needed, unlike pre-13) -- same id-generation
-- pattern already used for hand-written inserts in `0004_curved_stingray.sql`, since
-- `organisation.id` has no SQL-level default (`$defaultFn` is JS-side, Drizzle-only).
INSERT INTO "organisation" ("id", "key", "name", "is_internal", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'internal', 'Internal', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "organisation" WHERE "is_internal" = true);
--> statement-breakpoint
UPDATE "workspace" SET "organisation_id" = (SELECT "id" FROM "organisation" WHERE "is_internal" = true LIMIT 1) WHERE "organisation_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "organisation_id" SET NOT NULL;--> statement-breakpoint
-- #192: UNIQUE before FK, not the reverse -- this must run before the composite FK below
-- that targets it ("there is no unique constraint matching given keys for referenced table
-- work_item_type" otherwise). drizzle-kit's generated statement order put this last;
-- reordered by hand, the same UNIQUE-before-FK ordering gap PR #191's own body flagged
-- drizzle-kit reintroducing for its `work_item_key_claim` table.
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_workspace_id_id_unique" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_workspace_id_project_id_project_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_workspace_id_type_id_work_item_type_workspace_id_id_fk" FOREIGN KEY ("workspace_id","type_id") REFERENCES "public"."work_item_type"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "work_item_workspaceId_idx" ON "work_item" USING btree ("workspace_id");
