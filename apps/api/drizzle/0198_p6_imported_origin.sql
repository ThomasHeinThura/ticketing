-- 0198_p6_imported_origin: P6 import writer (Lane B). Imported-origin markers on the journal and the
-- comment stream, plus generic entity provenance on external_link (data-model.md section 11).
-- Hand-written and idempotent. Foreign keys on populated tables are added NOT VALID.
--
-- Imported rows keep the SOURCE time in created_at (IM-6) and are marked origin = 'imported' with the
-- real write time in imported_at, so a reader can always tell a historical timestamp from a native one.
-- Native rows keep origin NULL. audit_log is not touched by this migration or by the import writer.

ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "origin" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "imported_at" timestamp;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "origin" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "imported_at" timestamp;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_origin_allowed') THEN
    ALTER TABLE "activity" ADD CONSTRAINT "activity_origin_allowed"
      CHECK ("origin" IS NULL OR "origin" = 'imported') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_origin_import_time') THEN
    ALTER TABLE "activity" ADD CONSTRAINT "activity_origin_import_time"
      CHECK (("origin" IS NULL) = ("imported_at" IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_origin_allowed') THEN
    ALTER TABLE "comment" ADD CONSTRAINT "comment_origin_allowed"
      CHECK ("origin" IS NULL OR "origin" = 'imported') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_origin_import_time') THEN
    ALTER TABLE "comment" ADD CONSTRAINT "comment_origin_import_time"
      CHECK (("origin" IS NULL) = ("imported_at" IS NULL)) NOT VALID;
  END IF;
END $$;--> statement-breakpoint

-- external_link: the Kaneo task link table becomes the provenance table for any imported entity.
-- Legacy rows (task_id set) are unchanged; entity rows carry task_id NULL and an entity anchor.
ALTER TABLE "external_link" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "external_link" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "work_item_id" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "entity_type" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "entity_id" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "system" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "organisation_id" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "origin" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "import_run_id" text;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "source_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "source_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "source_resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "stale_at" timestamp;--> statement-breakpoint
ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "deferred_links" jsonb;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_link_anchor_check') THEN
    ALTER TABLE "external_link" ADD CONSTRAINT "external_link_anchor_check"
      CHECK ("task_id" IS NOT NULL OR ("workspace_id" IS NOT NULL AND "work_item_id" IS NOT NULL
        AND "entity_type" IS NOT NULL AND "entity_id" IS NOT NULL AND "system" IS NOT NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_link_entity_type_allowed') THEN
    ALTER TABLE "external_link" ADD CONSTRAINT "external_link_entity_type_allowed"
      CHECK ("entity_type" IS NULL OR "entity_type" IN ('work_item', 'comment', 'attachment')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_link_origin_allowed') THEN
    ALTER TABLE "external_link" ADD CONSTRAINT "external_link_origin_allowed"
      CHECK ("origin" IS NULL OR "origin" = 'imported') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_link_deferred_shape') THEN
    ALTER TABLE "external_link" ADD CONSTRAINT "external_link_deferred_shape"
      CHECK ("deferred_links" IS NULL OR jsonb_typeof("deferred_links") = 'object') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_link_work_item_fk') THEN
    ALTER TABLE "external_link" ADD CONSTRAINT "external_link_work_item_fk"
      FOREIGN KEY ("workspace_id", "work_item_id") REFERENCES "work_item" ("workspace_id", "id")
      ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
  END IF;
END $$;--> statement-breakpoint

-- One provenance row per imported source entity; reruns find it and never duplicate the target.
CREATE UNIQUE INDEX IF NOT EXISTS "external_link_imported_source_unique"
  ON "external_link" ("workspace_id", "system", "entity_type", "external_id")
  WHERE "origin" = 'imported';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_link_work_item_idx"
  ON "external_link" ("work_item_id") WHERE "work_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_link_entity_idx"
  ON "external_link" ("workspace_id", "entity_type", "entity_id") WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_link_deferred_idx"
  ON "external_link" ("workspace_id", "system") WHERE "deferred_links" IS NOT NULL;
