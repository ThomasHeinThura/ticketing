-- 0132: audit purge hardening (review-p0 F2, F4, F5). Supersedes the 0131 purge function; 0131
-- itself is never edited. The caller no longer supplies the anchor: the SECURITY DEFINER function
-- enforces a hard-coded retention floor (AU-13 default, 12 months), re-derives every anchor field
-- from the rows it deletes, and is the only writer of audit_chain_anchor (the application role's
-- INSERT on that table is revoked by ensureApplicationRole's read-only table list).
DROP FUNCTION IF EXISTS audit_log_purge_prefix(bigint, text);
--> statement-breakpoint
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
        AND OLD.created_at >= a.first_purged_created_at
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
CREATE FUNCTION audit_log_purge_prefix(p_through_seq bigint)
RETURNS TABLE (
  out_anchor_id text,
  out_purged_count integer,
  out_first_created_at timestamptz,
  out_through_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c_floor CONSTANT interval := interval '12 months';
  v_head bigint;
  v_count integer;
  v_first timestamptz;
  v_through timestamptz;
  v_last_hash text;
  v_next_hash text;
  v_id text;
  v_deleted integer;
BEGIN
  IF p_through_seq IS NULL THEN RAISE EXCEPTION 'audit purge: through_seq is required'; END IF;
  PERFORM pg_advisory_xact_lock(4010);
  SELECT max(al.seq) INTO v_head FROM public.audit_log al;
  IF v_head IS NULL OR p_through_seq >= v_head THEN
    RAISE EXCEPTION 'audit purge: may not delete the chain head';
  END IF;
  SELECT count(*), min(al.created_at), max(al.created_at)
    INTO v_count, v_first, v_through
    FROM public.audit_log al WHERE al.seq <= p_through_seq;
  IF v_count = 0 THEN RAISE EXCEPTION 'audit purge: nothing to purge'; END IF;
  -- Retention floor (AU-13 default window), enforced here so no caller can shorten it. The check is on
  -- max(created_at) of the range, so an out-of-order created_at cannot slip a recent row in.
  IF v_through > now() - c_floor THEN
    RAISE EXCEPTION 'audit purge: range contains rows inside the retention floor';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_log al WHERE al.seq <= p_through_seq AND EXISTS (
      SELECT 1 FROM public.legal_hold lh WHERE lh.lifted_at IS NULL AND (
        (lh.scope = 'organisation' AND (
          lh.scope_id = al.organisation_id
          OR lh.scope_id = (SELECT w.organisation_id FROM public.workspace w WHERE w.id = al.workspace_id)
          OR lh.scope_id IN (SELECT p.organisation_id FROM public.person p WHERE p.id = al.actor_id OR p.user_id = al.actor_id)))
        OR (lh.scope = 'person' AND (
          lh.scope_id = al.actor_id
          OR lh.scope_id IN (SELECT p.id FROM public.person p WHERE p.user_id = al.actor_id))))))
  THEN RAISE EXCEPTION 'audit purge: range contains held rows'; END IF;
  SELECT al.row_hash INTO v_last_hash FROM public.audit_log al
    WHERE al.seq <= p_through_seq ORDER BY al.seq DESC LIMIT 1;
  SELECT al.row_hash INTO v_next_hash FROM public.audit_log al
    WHERE al.seq > p_through_seq ORDER BY al.seq ASC LIMIT 1;
  v_id := gen_random_uuid()::text;
  INSERT INTO public.audit_chain_anchor (
    id, created_at, purged_through_at, last_purged_row_hash,
    first_purged_created_at, purged_count, next_row_hash
  ) VALUES (v_id, now(), v_through, v_last_hash, v_first, v_count, v_next_hash);
  PERFORM set_config('taskdesk.audit_purge_anchor', v_id, true);
  DELETE FROM public.audit_log WHERE seq <= p_through_seq;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('taskdesk.audit_purge_anchor', '', true);
  IF v_deleted <> v_count THEN
    RAISE EXCEPTION 'audit purge: deleted % rows but anchored %', v_deleted, v_count;
  END IF;
  RETURN QUERY SELECT v_id, v_count, v_first, v_through;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_log_purge_prefix(bigint) FROM PUBLIC;
