-- 0212_page_version_autosave_coalesce: PG-4 as changed by Thomas on 31 Oct 2026 (Pages autosave).
-- Hand-written and idempotent. A save by the same author shortly after their own latest "edit"
-- version updates that version instead of adding one (the window lives in
-- apps/api/src/pages/logic.ts). The immutability trigger keeps refusing every other change.
--
-- `updated_at` is NULL until a version is first coalesced; existing rows are not touched.
ALTER TABLE "project_page_version" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "project_page_version_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The FK's own `ON DELETE SET NULL` on created_by when the author's person row is erased or
  -- purged. Every other column must be untouched (P5-R1-06).
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
     AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;
  -- PG-4 autosave coalescing: only the page's latest version, only an "edit" by a known author,
  -- keeping its identity, author, kind and start time, renumbered to the page's current version.
  IF OLD.kind = 'edit' AND NEW.kind = 'edit'
     AND NEW.id = OLD.id AND NEW.page_id = OLD.page_id
     AND OLD.created_by IS NOT NULL AND NEW.created_by = OLD.created_by
     AND NEW.created_at = OLD.created_at
     AND OLD.restored_from IS NULL AND NEW.restored_from IS NULL
     AND NEW.updated_at IS NOT NULL
     AND NEW.number > OLD.number
     AND NOT EXISTS (
       SELECT 1 FROM "project_page_version" v
       WHERE v."page_id" = OLD."page_id" AND v."number" > OLD."number"
     )
     AND EXISTS (
       SELECT 1 FROM "project_page" p
       WHERE p."id" = OLD."page_id" AND p."version" = NEW."number" AND p."deleted_at" IS NULL
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'project_page_version rows are immutable' USING ERRCODE = '23000';
END
$$;
