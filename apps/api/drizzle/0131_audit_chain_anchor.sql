CREATE TABLE "audit_chain_anchor" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_through_at" timestamp with time zone NOT NULL,
	"last_purged_row_hash" text NOT NULL CHECK ("last_purged_row_hash" ~ '^[0-9a-f]{64}$'),
	"first_purged_created_at" timestamp with time zone NOT NULL,
	"purged_count" integer NOT NULL CHECK ("purged_count" > 0),
	"next_row_hash" text CHECK ("next_row_hash" IS NULL OR "next_row_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE FUNCTION audit_chain_anchor_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_chain_anchor is append-only: % is not permitted', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_chain_anchor_append_only BEFORE UPDATE OR DELETE ON audit_chain_anchor
  FOR EACH ROW EXECUTE FUNCTION audit_chain_anchor_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_chain_anchor_append_only_truncate BEFORE TRUNCATE ON audit_chain_anchor
  FOR EACH STATEMENT EXECUTE FUNCTION audit_chain_anchor_reject_mutation();
--> statement-breakpoint
-- The anchored-purge carve-out: a DELETE is allowed only inside audit_log_purge_prefix(),
-- which sets taskdesk.audit_purge_anchor to an anchor row written in the same transaction.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND coalesce(current_setting('taskdesk.audit_purge_anchor', true), '') <> ''
    AND EXISTS (
      SELECT 1 FROM audit_chain_anchor a
      WHERE a.id = current_setting('taskdesk.audit_purge_anchor', true)
        AND a.created_at = now()
        AND OLD.created_at <= a.purged_through_at
    )
  THEN
    RETURN OLD;
  END IF;
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
--> statement-breakpoint
CREATE FUNCTION audit_log_purge_prefix(p_through_seq bigint, p_anchor_id text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a audit_chain_anchor%ROWTYPE;
  v_head bigint;
  v_hash text;
  v_count integer;
  v_deleted integer;
BEGIN
  PERFORM pg_advisory_xact_lock(4010);
  SELECT * INTO a FROM audit_chain_anchor WHERE id = p_anchor_id AND created_at = now();
  IF NOT FOUND THEN RAISE EXCEPTION 'audit purge: anchor not written in this transaction'; END IF;
  SELECT max(seq) INTO v_head FROM audit_log;
  IF p_through_seq >= v_head THEN RAISE EXCEPTION 'audit purge: may not delete the chain head'; END IF;
  SELECT row_hash INTO v_hash FROM audit_log WHERE seq = p_through_seq;
  IF v_hash IS DISTINCT FROM a.last_purged_row_hash THEN RAISE EXCEPTION 'audit purge: anchor hash mismatch'; END IF;
  SELECT count(*) INTO v_count FROM audit_log WHERE seq <= p_through_seq;
  IF v_count <> a.purged_count THEN RAISE EXCEPTION 'audit purge: anchor count mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM audit_log al WHERE al.seq <= p_through_seq AND EXISTS (
      SELECT 1 FROM legal_hold lh WHERE lh.lifted_at IS NULL AND (
        (lh.scope = 'organisation' AND (
          lh.scope_id = al.organisation_id
          OR lh.scope_id = (SELECT w.organisation_id FROM workspace w WHERE w.id = al.workspace_id)
          OR lh.scope_id IN (SELECT p.organisation_id FROM person p WHERE p.id = al.actor_id OR p.user_id = al.actor_id)))
        OR (lh.scope = 'person' AND (
          lh.scope_id = al.actor_id
          OR lh.scope_id IN (SELECT p.id FROM person p WHERE p.user_id = al.actor_id))))))
  THEN RAISE EXCEPTION 'audit purge: range contains held rows'; END IF;
  PERFORM set_config('taskdesk.audit_purge_anchor', p_anchor_id, true);
  DELETE FROM audit_log WHERE seq <= p_through_seq;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('taskdesk.audit_purge_anchor', '', true);
  RETURN v_deleted;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_log_purge_prefix(bigint, text) FROM PUBLIC;
