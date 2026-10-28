-- RP-9: certify a closed day only for the complete twelve-family snapshot projection.
-- Legacy rows default to version 1 and are not trusted by the version-2 reader.
ALTER TABLE metric_snapshot_day
  ADD COLUMN IF NOT EXISTS snapshot_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'metric_snapshot_day_version_positive'
      AND conrelid = 'public.metric_snapshot_day'::regclass
  ) THEN
    ALTER TABLE metric_snapshot_day
      ADD CONSTRAINT metric_snapshot_day_version_positive CHECK (snapshot_version > 0);
  END IF;
END $$;
--> statement-breakpoint
-- Existing markers certify only the earlier three-family writer. Facts remain intact and will
-- be recomputed by the report snapshot job before a day becomes covered again.
DELETE FROM metric_snapshot_day;
--> statement-breakpoint

-- Replace 0169's date-specific AFTER triggers. Every relevant source mutation now fences and
-- invalidates the whole workspace BEFORE the source row changes. The report writer takes this same
-- workspace lock before reading any source and writes the version-2 marker after all facts.
DROP TRIGGER IF EXISTS metric_snapshot_work_item_invalidate ON work_item;
DROP TRIGGER IF EXISTS metric_snapshot_sla_cache_invalidate ON work_item_sla_cache;
DROP TRIGGER IF EXISTS metric_snapshot_project_invalidate ON project;
DROP TRIGGER IF EXISTS metric_snapshot_state_template_invalidate ON state_template;
DROP TRIGGER IF EXISTS metric_snapshot_state_mapping_invalidate ON state;
DROP FUNCTION IF EXISTS taskdesk_invalidate_snapshot_work_item();
DROP FUNCTION IF EXISTS taskdesk_invalidate_snapshot_sla_cache();
DROP FUNCTION IF EXISTS taskdesk_invalidate_snapshot_project();
DROP FUNCTION IF EXISTS taskdesk_invalidate_snapshot_state_template();
DROP FUNCTION IF EXISTS taskdesk_invalidate_snapshot_state_mapping();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION taskdesk_invalidate_snapshot_fact_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_workspaces text[] := ARRAY[]::text[];
  v_workspace_id text;
  v_changed boolean := TG_OP <> 'UPDATE';
  v_index integer;
  v_period_start timestamptz;
  v_old_id text;
  v_new_id text;
  v_old_user_id text;
  v_new_user_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  -- Trigger arguments name only fields that can change a stored fact. Ordinary ORM updates to
  -- updated_at or unrelated metadata return before taking the shared workspace fence.
  IF TG_OP = 'UPDATE' THEN
    FOR v_index IN 0..TG_NARGS - 1 LOOP
      IF (v_old -> TG_ARGV[v_index]) IS DISTINCT FROM (v_new -> TG_ARGV[v_index]) THEN
        v_changed := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_changed THEN RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'person' THEN
    v_old_id := v_old ->> 'id';
    v_new_id := v_new ->> 'id';
    v_old_user_id := v_old ->> 'user_id';
    v_new_user_id := v_new ->> 'user_id';
    SELECT COALESCE(array_agg(source.workspace_id ORDER BY source.workspace_id), ARRAY[]::text[])
    INTO v_workspaces
    FROM (
      SELECT DISTINCT ms.workspace_id
      FROM metric_snapshot ms
      WHERE ms.dimensions ->> 'assigneeId' IN (v_old_id, v_new_id)
         OR ms.dimensions ->> 'requesterId' IN (v_old_id, v_new_id)
         OR ms.dimensions ->> 'personId' IN (v_old_id, v_new_id)
         OR ms.dimensions ->> 'creatorId' IN (v_old_id, v_new_id)
         OR ms.dimensions ->> 'escalationPersonId' IN (v_old_id, v_new_id)
      UNION
      -- cost_entry.creatorId is derived by joining created_by (a user id) to person.user_id.
      SELECT DISTINCT ce.workspace_id
      FROM cost_entry ce
      WHERE ce.created_by IN (v_old_user_id, v_new_user_id)
    ) AS source;
  ELSIF TG_TABLE_NAME IN ('work_item_sla_cache', 'satisfaction_rating', 'submission') THEN
    v_old_id := v_old ->> 'work_item_id';
    v_new_id := v_new ->> 'work_item_id';
    SELECT COALESCE(array_agg(DISTINCT w.workspace_id ORDER BY w.workspace_id), ARRAY[]::text[])
    INTO v_workspaces
    FROM work_item w
    WHERE w.id IN (v_old_id, v_new_id);
  ELSIF TG_TABLE_NAME = 'state' THEN
    SELECT COALESCE(array_agg(DISTINCT p.workspace_id ORDER BY p.workspace_id), ARRAY[]::text[])
    INTO v_workspaces
    FROM project p
    WHERE p.id IN (v_old ->> 'project_id', v_new ->> 'project_id');
  ELSIF TG_TABLE_NAME = 'cycle_snapshot' THEN
    SELECT COALESCE(array_agg(DISTINCT c.workspace_id ORDER BY c.workspace_id), ARRAY[]::text[])
    INTO v_workspaces
    FROM cycle c
    WHERE c.id IN (v_old ->> 'cycle_id', v_new ->> 'cycle_id');
  ELSE
    SELECT COALESCE(array_agg(DISTINCT candidate.workspace_id ORDER BY candidate.workspace_id), ARRAY[]::text[])
    INTO v_workspaces
    FROM unnest(ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id']) AS candidate(workspace_id)
    WHERE candidate.workspace_id IS NOT NULL;
  END IF;

  -- Each row change locks the affected old/new workspaces in a stable order, before the source
  -- mutation. This matches snapshot.repository.ts's fence and is reentrant for nested fact DML.
  FOREACH v_workspace_id IN ARRAY v_workspaces LOOP
    PERFORM pg_advisory_xact_lock(hashtext('metric_snapshot_workspace:' || v_workspace_id));
  END LOOP;

  IF TG_TABLE_NAME = 'person' AND TG_OP = 'DELETE' THEN
    -- JSON dimensions outlive their source FKs, so remove facts that would otherwise retain an
    -- erased person's opaque identifier. metric_snapshot's own trigger invalidates each marker.
    DELETE FROM metric_snapshot ms
    WHERE ms.dimensions ->> 'assigneeId' = v_old_id
       OR ms.dimensions ->> 'requesterId' = v_old_id
       OR ms.dimensions ->> 'personId' = v_old_id
       OR ms.dimensions ->> 'creatorId' = v_old_id
       OR ms.dimensions ->> 'escalationPersonId' = v_old_id;
  END IF;

  IF TG_TABLE_NAME = 'metric_snapshot' THEN
    -- The snapshot writer writes many days in one workspace transaction. Fact-row DML only
    -- invalidates the exact old/new day; clearing the workspace here would erase markers that
    -- the same writer just completed for earlier days in its batch.
    FOR v_workspace_id, v_period_start IN
      SELECT DISTINCT candidate.workspace_id, candidate.period_start
      FROM (VALUES
        (v_old ->> 'workspace_id', NULLIF(v_old ->> 'period_start', '')::timestamptz),
        (v_new ->> 'workspace_id', NULLIF(v_new ->> 'period_start', '')::timestamptz)
      ) AS candidate(workspace_id, period_start)
      WHERE candidate.workspace_id IS NOT NULL AND candidate.period_start IS NOT NULL
      ORDER BY candidate.workspace_id, candidate.period_start
    LOOP
      DELETE FROM metric_snapshot_day
      WHERE workspace_id = v_workspace_id AND period_start = v_period_start;
    END LOOP;
  ELSE
    FOREACH v_workspace_id IN ARRAY v_workspaces LOOP
      DELETE FROM metric_snapshot_day WHERE workspace_id = v_workspace_id;
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Twelve metric families and every source that shapes their dimensions/measures. For updates,
-- the generic trigger compares the supplied projection columns before locking or invalidating.
CREATE TRIGGER metric_snapshot_work_item_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON work_item
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'project_id', 'created_at', 'resolved_at', 'first_response_at',
  'state_id', 'type_id', 'priority', 'assignee_id', 'requester_id', 'deleted_at'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_sla_cache_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON work_item_sla_cache
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'work_item_id', 'metric', 'state', 'due_at'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_rating_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON satisfaction_rating
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'work_item_id', 'person_id', 'score', 'created_at'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_submission_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON submission
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'work_item_id', 'state', 'created_at', 'request_type_id'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_time_entry_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON time_entry
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'project_id', 'work_item_id', 'person_id', 'date', 'minutes',
  'activity_id', 'billable', 'rate_minor', 'currency'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_cost_entry_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON cost_entry
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'project_id', 'work_item_id', 'cost_type_id', 'person_id', 'date',
  'units', 'rate_minor', 'amount_minor', 'currency', 'created_by'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_escalation_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON sla_escalation
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'project_id', 'work_item_id', 'metric', 'assignee_id_at_start',
  'state', 'stop_reason', 'started_at'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_deflection_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON deflection_event
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'kb_article_id', 'request_type_id', 'person_id', 'abandoned_at', 'created_at'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_kb_article_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON kb_article
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'project_id'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_cycle_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON cycle
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'id', 'workspace_id', 'project_id', 'completed_at'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_cycle_snapshot_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON cycle_snapshot
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'cycle_id', 'date', 'unit', 'scope_points', 'completed_points', 'item_count',
  'completed_count', 'unestimated_count'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_project_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON project
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'id', 'workspace_id', 'organisation_id', 'deleted_at'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_state_template_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON state_template
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'id', 'workspace_id', 'group'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_state_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON state
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'id', 'project_id', 'state_template_id'
);
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_person_fact_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON person
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'id', 'user_id', 'organisation_id'
);
--> statement-breakpoint
-- A fact writer may run without a newer process version during a rolling deployment. Every fact
-- DML therefore takes the same fence and drops coverage; legacy marker inserts still default to
-- version 1, while only the complete writer can certify version 2 after its final fact write.
CREATE TRIGGER metric_snapshot_fact_dml_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON metric_snapshot
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'period_start', 'grain', 'metric_key', 'project_id',
  'organisation_id', 'dimensions', 'measures'
);
