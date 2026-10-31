-- 0212_page_version_autosave_coalesce: PG-4 as changed by Thomas on 31 Oct 2026 (Pages autosave).
-- Hand-written and idempotent. A content save by the author of the page's latest "edit" version,
-- within 10 minutes of that version's creation, updates that version instead of adding one
-- (apps/api/src/pages/logic.ts shouldCoalesceVersion). The immutability trigger allows exactly
-- that update and refuses every other change:
--   * only `number`, `body`, `body_text` and `updated_at` change; every other column (title, kind,
--     author, creation time, restored_from, ids) stays as it was;
--   * the row is the page's latest version, an "edit" by a known author, not a restore;
--   * it was created less than 10 minutes ago by the database clock. The 10 must stay equal to
--     PAGE_VERSION_COALESCE_WINDOW_MINUTES in logic.ts (a test checks both);
--   * it is renumbered to exactly the next number, which the page row already holds in the same
--     transaction, on a live page last saved by the version's author;
--   * `updated_at` is set to now() (the transaction's time).
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
  -- PG-4 autosave coalescing (see the header comment for the full rule).
  IF (to_jsonb(NEW) - 'number' - 'body' - 'body_text' - 'updated_at')
       = (to_jsonb(OLD) - 'number' - 'body' - 'body_text' - 'updated_at')
     AND OLD.kind = 'edit'
     AND OLD.created_by IS NOT NULL
     AND OLD.restored_from IS NULL
     AND OLD.created_at > now() - make_interval(mins => 10)
     AND NEW.number = OLD.number + 1
     AND NEW.updated_at IS NOT NULL AND NEW.updated_at = now()
     AND NOT EXISTS (
       SELECT 1 FROM "project_page_version" v
       WHERE v."page_id" = OLD."page_id" AND v."number" > OLD."number"
     )
     AND EXISTS (
       SELECT 1 FROM "project_page" p
       WHERE p."id" = OLD."page_id" AND p."version" = NEW."number" AND p."deleted_at" IS NULL
         AND p."updated_by" = OLD."created_by"
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'project_page_version rows are immutable' USING ERRCODE = '23000';
END
$$;
