-- P5 round-1 review (P5-R1-03): narrow snapshot invalidation, no workspace-wide lock.
--
-- 0171 took one workspace-wide advisory lock in every fact-source trigger, deleted every
-- metric_snapshot_day marker of the workspace on each relevant write, held the same lock in the
-- writer across a whole backfill, and scanned metric_snapshot's JSONB on every person update.
--
-- New model (idempotent: CREATE OR REPLACE / IF NOT EXISTS / DROP TRIGGER IF EXISTS):
--  * Day-keyed sources (work item, SLA cache, rating, submission, time, cost, escalation,
--    deflection, cycle, cycle snapshot, metric_snapshot) derive the UTC day(s) their old and new
--    row feed, take a SHARED per-(workspace, day) advisory lock and delete only those markers.
--    The writer takes the EXCLUSIVE per-day lock with pg_try_advisory_xact_lock before reading,
--    so a source write waits at most for one day's short writer transaction and the writer never
--    waits (a busy day is skipped and retried by the next run).
--  * Sources that can change facts of every day (project, state template, state, KB article,
--    person user link) bump metric_snapshot_epoch.epoch for the workspace instead of deleting or
--    locking anything. A marker records the epoch it was computed under and is trusted only while
--    that epoch is current, so a stale marker can never be served.

ALTER TABLE metric_snapshot_day
  ADD COLUMN IF NOT EXISTS epoch bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS metric_snapshot_epoch (
  workspace_id text PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE ON UPDATE CASCADE,
  epoch bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sla_escalation_work_item_id_idx ON sla_escalation (work_item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS submission_work_item_id_idx ON submission (work_item_id);
--> statement-breakpoint

-- UTC day of a to_jsonb() timestamp/timestamptz/date text (timestamptz carries an offset).
CREATE OR REPLACE FUNCTION taskdesk_snapshot_day_of(v text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  IF length(v) > 10 AND v ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
    RETURN ((v::timestamptz) AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN v::timestamp::date;
END;
$$;
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
  v_changed boolean := TG_OP <> 'UPDATE';
  v_index integer;
  v_workspaces text[] := ARRAY[]::text[];
  v_days date[] := ARRAY[]::date[];
  v_workspace_id text;
  v_day date;
  v_broad boolean := false;
  v_all_workspaces boolean := false;
  v_old_id text;
  v_new_id text;
  v_dimension_changed boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_index IN 0..TG_NARGS - 1 LOOP
      IF (v_old -> TG_ARGV[v_index]) IS DISTINCT FROM (v_new -> TG_ARGV[v_index]) THEN
        v_changed := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_changed THEN RETURN NEW; END IF;
  END IF;

  -- The snapshot writer maintains its own markers: its fact DML must not invalidate its day.
  IF TG_TABLE_NAME = 'metric_snapshot'
     AND current_setting('taskdesk.snapshot_writer', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_old_id := v_old ->> 'id';
  v_new_id := v_new ->> 'id';

  IF TG_TABLE_NAME = 'work_item' THEN
    v_workspaces := ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id'];
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'created_at'), taskdesk_snapshot_day_of(v_new ->> 'created_at'),
      taskdesk_snapshot_day_of(v_old ->> 'resolved_at'), taskdesk_snapshot_day_of(v_new ->> 'resolved_at'),
      taskdesk_snapshot_day_of(v_old ->> 'first_response_at'), taskdesk_snapshot_day_of(v_new ->> 'first_response_at')
    ];
    -- Dimensions of the related day-keyed facts come from the work item: only when one of them
    -- (or the item's visibility) changed do those facts' days need to be invalidated too.
    v_dimension_changed := TG_OP <> 'UPDATE'
      OR (v_old -> 'project_id') IS DISTINCT FROM (v_new -> 'project_id')
      OR (v_old -> 'type_id') IS DISTINCT FROM (v_new -> 'type_id')
      OR (v_old -> 'priority') IS DISTINCT FROM (v_new -> 'priority')
      OR (v_old -> 'assignee_id') IS DISTINCT FROM (v_new -> 'assignee_id')
      OR (v_old -> 'requester_id') IS DISTINCT FROM (v_new -> 'requester_id')
      OR (v_old -> 'deleted_at') IS DISTINCT FROM (v_new -> 'deleted_at');
    IF v_dimension_changed AND TG_OP <> 'INSERT' THEN
      v_days := v_days || COALESCE((SELECT array_agg(d) FROM (
        SELECT taskdesk_snapshot_day_of(c.due_at::text) AS d FROM work_item_sla_cache c WHERE c.work_item_id = v_old_id AND c.due_at IS NOT NULL
        UNION SELECT taskdesk_snapshot_day_of(r.created_at::text) FROM satisfaction_rating r WHERE r.work_item_id = v_old_id
        UNION SELECT taskdesk_snapshot_day_of(e.started_at::text) FROM sla_escalation e WHERE e.work_item_id = v_old_id
        UNION SELECT t.date::date FROM time_entry t WHERE t.work_item_id = v_old_id
        UNION SELECT x.date::date FROM cost_entry x WHERE x.work_item_id = v_old_id
      ) related), ARRAY[]::date[]);
    END IF;
  ELSIF TG_TABLE_NAME = 'work_item_sla_cache' THEN
    SELECT array_agg(DISTINCT w.workspace_id) INTO v_workspaces FROM work_item w
    WHERE w.id IN (v_old ->> 'work_item_id', v_new ->> 'work_item_id');
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'due_at'), taskdesk_snapshot_day_of(v_new ->> 'due_at')
    ] || COALESCE((SELECT array_agg(d) FROM (
      SELECT taskdesk_snapshot_day_of(w.resolved_at::text) AS d FROM work_item w WHERE w.id IN (v_old ->> 'work_item_id', v_new ->> 'work_item_id')
      UNION SELECT taskdesk_snapshot_day_of(w.first_response_at::text) FROM work_item w WHERE w.id IN (v_old ->> 'work_item_id', v_new ->> 'work_item_id')
    ) settled), ARRAY[]::date[]);
  ELSIF TG_TABLE_NAME = 'satisfaction_rating' THEN
    SELECT array_agg(DISTINCT w.workspace_id) INTO v_workspaces FROM work_item w
    WHERE w.id IN (v_old ->> 'work_item_id', v_new ->> 'work_item_id');
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'created_at'), taskdesk_snapshot_day_of(v_new ->> 'created_at')
    ];
  ELSIF TG_TABLE_NAME = 'submission' THEN
    -- A submission supplies the request type of its item's rating facts.
    SELECT array_agg(DISTINCT w.workspace_id) INTO v_workspaces FROM work_item w
    WHERE w.id IN (v_old ->> 'work_item_id', v_new ->> 'work_item_id');
    SELECT array_agg(DISTINCT taskdesk_snapshot_day_of(r.created_at::text)) INTO v_days
    FROM satisfaction_rating r WHERE r.work_item_id IN (v_old ->> 'work_item_id', v_new ->> 'work_item_id');
  ELSIF TG_TABLE_NAME IN ('time_entry', 'cost_entry') THEN
    v_workspaces := ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id'];
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'date'), taskdesk_snapshot_day_of(v_new ->> 'date')
    ];
  ELSIF TG_TABLE_NAME = 'sla_escalation' THEN
    v_workspaces := ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id'];
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'started_at'), taskdesk_snapshot_day_of(v_new ->> 'started_at')
    ];
  ELSIF TG_TABLE_NAME = 'deflection_event' THEN
    v_workspaces := ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id'];
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'created_at'), taskdesk_snapshot_day_of(v_new ->> 'created_at')
    ];
  ELSIF TG_TABLE_NAME = 'cycle' THEN
    v_workspaces := ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id'];
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'completed_at'), taskdesk_snapshot_day_of(v_new ->> 'completed_at')
    ];
  ELSIF TG_TABLE_NAME = 'cycle_snapshot' THEN
    SELECT array_agg(DISTINCT c.workspace_id), array_agg(DISTINCT taskdesk_snapshot_day_of(c.completed_at::text))
    INTO v_workspaces, v_days FROM cycle c
    WHERE c.id IN (v_old ->> 'cycle_id', v_new ->> 'cycle_id') AND c.completed_at IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'metric_snapshot' THEN
    v_workspaces := ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id'];
    v_days := ARRAY[
      taskdesk_snapshot_day_of(v_old ->> 'period_start'), taskdesk_snapshot_day_of(v_new ->> 'period_start')
    ];
  ELSIF TG_TABLE_NAME = 'person' THEN
    v_broad := true;
    v_all_workspaces := true;
    IF TG_OP = 'DELETE' THEN
      -- JSON dimensions outlive their source FKs, so facts naming an erased person's opaque
      -- identifier are removed. This is the erasure path only, not a per-update scan.
      DELETE FROM metric_snapshot ms
      WHERE ms.dimensions ->> 'assigneeId' = v_old_id
         OR ms.dimensions ->> 'requesterId' = v_old_id
         OR ms.dimensions ->> 'personId' = v_old_id
         OR ms.dimensions ->> 'creatorId' = v_old_id
         OR ms.dimensions ->> 'escalationPersonId' = v_old_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'state' THEN
    v_broad := true;
    SELECT array_agg(DISTINCT p.workspace_id) INTO v_workspaces FROM project p
    WHERE p.id IN (v_old ->> 'project_id', v_new ->> 'project_id');
  ELSE
    -- project, state_template, kb_article: a change can reach facts of any day.
    v_broad := true;
    v_workspaces := ARRAY[v_old ->> 'workspace_id', v_new ->> 'workspace_id'];
  END IF;

  IF v_broad THEN
    IF v_all_workspaces THEN
      INSERT INTO metric_snapshot_epoch (workspace_id, epoch)
      SELECT w.id, 1 FROM workspace w
      ON CONFLICT (workspace_id) DO UPDATE SET epoch = metric_snapshot_epoch.epoch + 1;
    ELSE
      INSERT INTO metric_snapshot_epoch (workspace_id, epoch)
      SELECT DISTINCT x, 1 FROM unnest(v_workspaces) AS x
      WHERE x IS NOT NULL AND EXISTS (SELECT 1 FROM workspace w WHERE w.id = x)
      ON CONFLICT (workspace_id) DO UPDATE SET epoch = metric_snapshot_epoch.epoch + 1;
    END IF;
  ELSE
    FOR v_workspace_id IN
      SELECT DISTINCT x FROM unnest(v_workspaces) AS x WHERE x IS NOT NULL ORDER BY x
    LOOP
      FOR v_day IN
        SELECT DISTINCT d FROM unnest(v_days) AS d WHERE d IS NOT NULL ORDER BY d
      LOOP
        PERFORM pg_advisory_xact_lock_shared(
          hashtext('metric_snapshot_day:' || v_workspace_id || ':' || to_char(v_day, 'YYYY-MM-DD')));
        DELETE FROM metric_snapshot_day
        WHERE workspace_id = v_workspace_id
          AND period_start = (v_day::timestamp AT TIME ZONE 'UTC');
      END LOOP;
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Person: only an erasure (DELETE) or a changed user link (cost-entry creator facts) matters; the
-- organisation of a person never changes, so an update of it no longer scans anything.
DROP TRIGGER IF EXISTS metric_snapshot_person_fact_invalidate ON person;
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_person_fact_invalidate
BEFORE DELETE OR UPDATE OF user_id ON person
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source('user_id');
--> statement-breakpoint
-- Fact DML only matters for its day; the writer's own fact DML is exempt via the GUC above.
DROP TRIGGER IF EXISTS metric_snapshot_fact_dml_invalidate ON metric_snapshot;
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_fact_dml_invalidate
BEFORE INSERT OR UPDATE OR DELETE ON metric_snapshot
FOR EACH ROW EXECUTE FUNCTION taskdesk_invalidate_snapshot_fact_source(
  'workspace_id', 'period_start', 'grain', 'metric_key', 'project_id',
  'organisation_id', 'dimensions', 'measures'
);
