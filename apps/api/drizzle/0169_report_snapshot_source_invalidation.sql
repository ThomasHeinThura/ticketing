-- RP-9: invalidate affected closed-day coverage in the source transaction.
-- Snapshot writers share the workspace fence and aggregate only after acquiring it.
CREATE OR REPLACE FUNCTION taskdesk_invalidate_snapshot_work_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id text;
  v_day timestamptz;
  v_old_workspace text;
  v_new_workspace text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_workspace := OLD.workspace_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_workspace := NEW.workspace_id;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.resolved_at IS NULL AND NEW.first_response_at IS NULL)
    OR (TG_OP = 'DELETE' AND OLD.resolved_at IS NULL AND OLD.first_response_at IS NULL)
    OR (TG_OP = 'UPDATE'
      AND OLD.resolved_at IS NULL AND OLD.first_response_at IS NULL
      AND NEW.resolved_at IS NULL AND NEW.first_response_at IS NULL) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id
    AND OLD.resolved_at IS NOT DISTINCT FROM NEW.resolved_at
    AND OLD.first_response_at IS NOT DISTINCT FROM NEW.first_response_at
    AND OLD.state_id IS NOT DISTINCT FROM NEW.state_id
    AND OLD.type_id IS NOT DISTINCT FROM NEW.type_id
    AND OLD.priority IS NOT DISTINCT FROM NEW.priority
    AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;
  END IF;

  FOR v_workspace_id IN
    SELECT DISTINCT candidate.workspace_id
    FROM (VALUES (v_old_workspace), (v_new_workspace)) AS candidate(workspace_id)
    WHERE candidate.workspace_id IS NOT NULL
    ORDER BY candidate.workspace_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('metric_snapshot_workspace:' || v_workspace_id));
  END LOOP;

  FOR v_workspace_id, v_day IN
    SELECT DISTINCT candidate.workspace_id,
      date_trunc('day', candidate.settled_at)::timestamp AT TIME ZONE 'UTC' AS period_start
    FROM (VALUES
      (v_old_workspace, CASE WHEN TG_OP <> 'INSERT' THEN OLD.resolved_at ELSE NULL END),
      (v_old_workspace, CASE WHEN TG_OP <> 'INSERT' THEN OLD.first_response_at ELSE NULL END),
      (v_new_workspace, CASE WHEN TG_OP <> 'DELETE' THEN NEW.resolved_at ELSE NULL END),
      (v_new_workspace, CASE WHEN TG_OP <> 'DELETE' THEN NEW.first_response_at ELSE NULL END)
    ) AS candidate(workspace_id, settled_at)
    WHERE candidate.workspace_id IS NOT NULL AND candidate.settled_at IS NOT NULL
    ORDER BY candidate.workspace_id, period_start
  LOOP
    DELETE FROM metric_snapshot_day
    WHERE workspace_id = v_workspace_id AND period_start = v_day;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_work_item_invalidate
AFTER INSERT OR UPDATE OR DELETE ON work_item
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_work_item();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION taskdesk_invalidate_snapshot_sla_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_id text;
  v_metric text;
  v_workspace_id text;
  v_settled timestamp without time zone;
  v_old_item text;
  v_new_item text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_item := OLD.work_item_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_item := NEW.work_item_id; END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.work_item_id IS NOT DISTINCT FROM NEW.work_item_id
    AND OLD.metric IS NOT DISTINCT FROM NEW.metric
    AND OLD.state IS NOT DISTINCT FROM NEW.state THEN
    RETURN NEW;
  END IF;

  FOR v_workspace_id IN
    SELECT DISTINCT w.workspace_id
    FROM work_item w
    WHERE w.id IN (v_old_item, v_new_item)
    ORDER BY w.workspace_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('metric_snapshot_workspace:' || v_workspace_id));
  END LOOP;

  FOR v_item_id, v_metric IN
    SELECT DISTINCT candidate.work_item_id, candidate.metric
    FROM (VALUES
      (CASE WHEN TG_OP <> 'INSERT' THEN OLD.work_item_id ELSE NULL END,
       CASE WHEN TG_OP <> 'INSERT' THEN OLD.metric ELSE NULL END),
      (CASE WHEN TG_OP <> 'DELETE' THEN NEW.work_item_id ELSE NULL END,
       CASE WHEN TG_OP <> 'DELETE' THEN NEW.metric ELSE NULL END)
    ) AS candidate(work_item_id, metric)
    WHERE candidate.work_item_id IS NOT NULL AND candidate.metric IN ('resolution', 'first_response')
    ORDER BY candidate.work_item_id, candidate.metric
  LOOP
    SELECT w.workspace_id,
      CASE v_metric WHEN 'resolution' THEN w.resolved_at ELSE w.first_response_at END
    INTO v_workspace_id, v_settled
    FROM work_item w WHERE w.id = v_item_id;
    IF v_workspace_id IS NOT NULL AND v_settled IS NOT NULL THEN
      DELETE FROM metric_snapshot_day
      WHERE workspace_id = v_workspace_id
        AND period_start = date_trunc('day', v_settled)::timestamp AT TIME ZONE 'UTC';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_sla_cache_invalidate
AFTER INSERT OR UPDATE OR DELETE ON work_item_sla_cache
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_sla_cache();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION taskdesk_invalidate_snapshot_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id text;
  v_project_id text;
BEGIN
  IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
    AND OLD.organisation_id IS NOT DISTINCT FROM NEW.organisation_id
    AND OLD.workspace_id IS NOT DISTINCT FROM NEW.workspace_id THEN
    RETURN NEW;
  END IF;

  FOR v_workspace_id IN
    SELECT DISTINCT candidate.workspace_id
    FROM (VALUES (OLD.workspace_id), (NEW.workspace_id)) AS candidate(workspace_id)
    WHERE candidate.workspace_id IS NOT NULL
    ORDER BY candidate.workspace_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('metric_snapshot_workspace:' || v_workspace_id));
  END LOOP;

  FOR v_project_id, v_workspace_id IN
    SELECT DISTINCT candidate.project_id, candidate.workspace_id
    FROM (VALUES (OLD.id, OLD.workspace_id), (NEW.id, NEW.workspace_id)) AS candidate(project_id, workspace_id)
    WHERE candidate.project_id IS NOT NULL AND candidate.workspace_id IS NOT NULL
    ORDER BY candidate.project_id, candidate.workspace_id
  LOOP
    DELETE FROM metric_snapshot_day d
    WHERE d.workspace_id = v_workspace_id
      AND EXISTS (
        SELECT 1 FROM metric_snapshot ms
        WHERE ms.workspace_id = d.workspace_id
          AND ms.period_start = d.period_start
          AND ms.project_id = v_project_id
      );
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_project_invalidate
AFTER UPDATE OF deleted_at, organisation_id, workspace_id ON project
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_project();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION taskdesk_invalidate_snapshot_state_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id text;
  v_day timestamptz;
BEGIN
  IF OLD."group" IS NOT DISTINCT FROM NEW."group"
    AND OLD.workspace_id IS NOT DISTINCT FROM NEW.workspace_id THEN
    RETURN NEW;
  END IF;
  FOR v_workspace_id IN
    SELECT DISTINCT candidate.workspace_id
    FROM (VALUES (OLD.workspace_id), (NEW.workspace_id)) AS candidate(workspace_id)
    WHERE candidate.workspace_id IS NOT NULL
    ORDER BY candidate.workspace_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('metric_snapshot_workspace:' || v_workspace_id));
  END LOOP;
  FOR v_workspace_id, v_day IN
    SELECT DISTINCT p.workspace_id,
      date_trunc('day', w.resolved_at)::timestamp AT TIME ZONE 'UTC' AS period_start
    FROM work_item w
    JOIN project p ON p.id = w.project_id
    JOIN state s ON s.id = w.state_id
    WHERE s.state_template_id IN (OLD.id, NEW.id)
      AND w.resolved_at IS NOT NULL
    ORDER BY p.workspace_id, period_start
  LOOP
    DELETE FROM metric_snapshot_day
    WHERE workspace_id = v_workspace_id AND period_start = v_day;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_state_template_invalidate
AFTER UPDATE OF "group", workspace_id ON state_template
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_state_template();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION taskdesk_invalidate_snapshot_state_mapping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id text;
  v_day timestamptz;
BEGIN
  IF OLD.state_template_id IS NOT DISTINCT FROM NEW.state_template_id
    AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id THEN
    RETURN NEW;
  END IF;
  FOR v_workspace_id IN
    SELECT DISTINCT p.workspace_id
    FROM project p WHERE p.id IN (OLD.project_id, NEW.project_id)
    ORDER BY p.workspace_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('metric_snapshot_workspace:' || v_workspace_id));
  END LOOP;
  FOR v_workspace_id, v_day IN
    SELECT DISTINCT p.workspace_id,
      date_trunc('day', w.resolved_at)::timestamp AT TIME ZONE 'UTC' AS period_start
    FROM work_item w
    JOIN project p ON p.id = w.project_id
    WHERE w.state_id IN (OLD.id, NEW.id) AND w.resolved_at IS NOT NULL
    ORDER BY p.workspace_id, period_start
  LOOP
    DELETE FROM metric_snapshot_day
    WHERE workspace_id = v_workspace_id AND period_start = v_day;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_state_mapping_invalidate
AFTER UPDATE OF state_template_id, project_id ON state
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_state_mapping();
