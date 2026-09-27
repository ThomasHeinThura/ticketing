ALTER TABLE "audit_log" ADD COLUMN "project_id" text;--> statement-breakpoint
-- Opus security review of PR #375, S1 (blocking): 0067's `audit_log_reject_mutation()`
-- carve-out only checks "every column except organisation_id is unchanged" against a
-- CLOSED list of columns, and this migration adds a column that is not on that list.
-- Reproduced live: with the column added but the function left as-is, the table owner
-- could run
--   WITH d AS (DELETE FROM organisation ... RETURNING id)
--   UPDATE audit_log SET organisation_id = NULL, project_id = NULL WHERE organisation_id IN (SELECT id FROM d);
-- and it succeeded -- the AU-7 tombstone carve-out ("organisation_id changing to NULL,
-- every OTHER column byte-for-byte identical") does not itself pin `project_id`, so
-- rewriting it alongside a real tombstone update passed unnoticed, and `audit-verify`
-- still reported `ok` because neither column is hashed (H1). That silently changes who
-- can READ a row under this PR's own reach filter -- to NULL (visible to every
-- workspace manager) or to an unreachable project (hidden from its rightful readers).
-- Fix: replace the function with the identical body plus one more equality check,
-- `NEW.project_id IS DISTINCT FROM OLD.project_id`, so the carve-out rejects a
-- statement that touches `project_id` exactly the same way it already rejects one that
-- touches any other non-`organisation_id` column.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.organisation_id IS DISTINCT FROM NEW.organisation_id THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
      OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
      OR NEW.api_key_id IS DISTINCT FROM OLD.api_key_id
      OR NEW.impersonator_id IS DISTINCT FROM OLD.impersonator_id
      OR NEW.actor_ip IS DISTINCT FROM OLD.actor_ip
      OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
      OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.action IS DISTINCT FROM OLD.action
      OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
      OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
      OR NEW.before IS DISTINCT FROM OLD.before
      OR NEW.after IS DISTINCT FROM OLD.after
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
      OR NEW.row_hash IS DISTINCT FROM OLD.row_hash
      OR NEW.seq IS DISTINCT FROM OLD.seq
    THEN
      RAISE EXCEPTION 'audit_log is append-only: UPDATE is not permitted beyond the AU-7 organisation_id tombstone (row id %)', OLD.id;
    END IF;
    IF NEW.organisation_id IS NOT NULL THEN
      RAISE EXCEPTION 'audit_log is append-only: organisation_id may only be set to NULL (the AU-7 tombstone), never reassigned (row id %)', OLD.id;
    END IF;
    IF EXISTS (SELECT 1 FROM organisation WHERE id = OLD.organisation_id) THEN
      RAISE EXCEPTION 'audit_log is append-only: organisation_id may only be set to NULL when that organisation no longer exists (the AU-7 tombstone fires from ON DELETE, not on a live organisation) (row id %)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_log is append-only: % is not permitted (row id %)',
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
END;
$$;
