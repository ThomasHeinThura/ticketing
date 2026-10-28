-- 0200_p6_provenance_plugin_scope: the import provenance namespace gains the plugin id (P6 review
-- P6-R1-09). Until now an imported row was identified by (workspace, system = sourceRef, entity type,
-- external id), so two plugins that shared a source reference could claim or stale each other's rows.
-- The ledger (import_record_link) already carries plugin_id; the provenance row now does too.
-- Hand-written and idempotent. 0196-0199 are not edited.

ALTER TABLE "external_link" ADD COLUMN IF NOT EXISTS "plugin_id" text;--> statement-breakpoint

-- Backfill from the run that wrote the row (rows written by 0198-era code carry import_run_id).
UPDATE "external_link" e
   SET "plugin_id" = r."plugin_id"
  FROM "import_run" r
 WHERE e."origin" = 'imported'
   AND e."plugin_id" IS NULL
   AND e."import_run_id" = r."id";--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_link_imported_plugin_check') THEN
    ALTER TABLE "external_link" ADD CONSTRAINT "external_link_imported_plugin_check"
      CHECK ("origin" IS NULL OR "plugin_id" IS NOT NULL) NOT VALID;
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "external_link_imported_source_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_link_imported_source_plugin_unique"
  ON "external_link" ("workspace_id", "plugin_id", "system", "entity_type", "external_id")
  WHERE "origin" = 'imported';
