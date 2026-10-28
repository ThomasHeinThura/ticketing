-- P5 round-2 review fixes (hand-written; idempotent: IF NOT EXISTS / CREATE OR REPLACE).
--
-- P5-R2-05: per-day invalidation no longer depends on the writer of the fact seeing the marker.
--   A marker the snapshot writer inserted after a REPEATABLE READ / SERIALIZABLE source transaction
--   took its snapshot was invisible to that transaction's trigger DELETE, so it stayed trusted. Every
--   day-keyed fact write now also bumps metric_snapshot_day_gen(workspace, day).gen (an UPSERT: it
--   conflicts loudly under RR/SERIALIZABLE instead of missing a row), the writer records the
--   generation it read under the exclusive day lock on the marker, and a marker is trusted only
--   while its generation is current. The writer never writes the generation row. Only days already
--   closed by the database clock are bumped, so a write feeding today never contends on a row.
-- P5-R2-01: inserting a project, state, state template or KB article no longer bumps the workspace
--   epoch (a new row has no past facts). A person's user link (UPDATE OF user_id) invalidates only
--   the (workspace, day) pairs of cost entries created by the old or new user, through the per-day
--   path; the instance-wide epoch bump is kept for erasure (DELETE) only.
-- P5-R2-02 / P5-R2-04: a queued export is stored as appended chunks (report_export_chunk), never by
--   rewriting one growing value; report_export.notified_at makes the "export ready" email once-only.

CREATE TABLE IF NOT EXISTS metric_snapshot_day_gen (
  workspace_id text NOT NULL,
  period_start timestamptz NOT NULL,
  gen bigint NOT NULL DEFAULT 0,
  CONSTRAINT metric_snapshot_day_gen_pk PRIMARY KEY (workspace_id, period_start),
  CONSTRAINT metric_snapshot_day_gen_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id)
    REFERENCES workspace(id) ON DELETE CASCADE ON UPDATE CASCADE
);
--> statement-breakpoint
ALTER TABLE metric_snapshot_day
  ADD COLUMN IF NOT EXISTS gen bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cost_entry_created_by_idx ON cost_entry (created_by);
--> statement-breakpoint

-- One closed day of one workspace changed: wait for (and then exclude) a writer computing it, bump its
-- generation if the writer may already have certified it, and drop its marker.
CREATE OR REPLACE FUNCTION taskdesk_snapshot_invalidate_day(p_workspace_id text, p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_day IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('metric_snapshot_day:' || p_workspace_id || ':' || to_char(p_day, 'YYYY-MM-DD')));
  -- Read the clock after the lock: a writer that certified the day held the exclusive lock first and
  -- checked that the day had ended by this same clock, so the day is seen as closed here.
  IF p_day < (clock_timestamp() AT TIME ZONE 'UTC')::date
     AND EXISTS (SELECT 1 FROM workspace w WHERE w.id = p_workspace_id) THEN
    INSERT INTO metric_snapshot_day_gen (workspace_id, period_start, gen)
    VALUES (p_workspace_id, p_day::timestamp AT TIME ZONE 'UTC', 1)
    ON CONFLICT (workspace_id, period_start) DO UPDATE SET gen = metric_snapshot_day_gen.gen + 1;
  END IF;
  DELETE FROM metric_snapshot_day
  WHERE workspace_id = p_workspace_id
    AND period_start = (p_day::timestamp AT TIME ZONE 'UTC');
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

  -- P5-R2-01: a brand-new project, state, state template or KB article has no past facts yet (no
  -- item, deflection or state history refers to it), so its INSERT cannot move a closed day.
  IF TG_OP = 'INSERT' AND TG_TABLE_NAME IN ('project', 'state', 'state_template', 'kb_article') THEN
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
  ELSIF TG_TABLE_NAME = 'person' AND TG_OP = 'UPDATE' THEN
    -- P5-R2-01: a changed user link moves only the cost-entry creator facts of entries created by
    -- the old or the new user (ce_creator joins person.user_id = cost_entry.created_by). Those
    -- (workspace, day) pairs are invalidated through the per-day path; every other workspace and day
    -- keeps its markers. A placeholder person linked on first sign-in usually has none at all.
    FOR v_workspace_id, v_day IN
      SELECT DISTINCT ce.workspace_id, ce.date::date FROM cost_entry ce
      WHERE ce.created_by IS NOT NULL
        AND ce.created_by IN (v_old ->> 'user_id', v_new ->> 'user_id')
      ORDER BY 1, 2
    LOOP
      PERFORM taskdesk_snapshot_invalidate_day(v_workspace_id, v_day);
    END LOOP;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'person' THEN
    -- Erasure (DELETE) keeps the instance-wide epoch bump: it is rare and its reach is unbounded.
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
        PERFORM taskdesk_snapshot_invalidate_day(v_workspace_id, v_day);
      END LOOP;
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- P5-R2-02 / P5-R2-04: a queued export's CSV, appended page by page and concatenated in seq order on
-- download. The parent row keeps the metadata; content stays only for files written before 0208.
CREATE TABLE IF NOT EXISTS report_export_chunk (
  export_id text NOT NULL,
  seq integer NOT NULL,
  content text NOT NULL,
  CONSTRAINT report_export_chunk_pk PRIMARY KEY (export_id, seq),
  CONSTRAINT report_export_chunk_export_id_report_export_id_fk FOREIGN KEY (export_id)
    REFERENCES report_export(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT report_export_chunk_seq_nonnegative CHECK (seq >= 0)
);
--> statement-breakpoint
ALTER TABLE report_export
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;
--> statement-breakpoint
-- Files finished before the email existed are not announced after an upgrade.
UPDATE report_export SET notified_at = COALESCE(finished_at, now())
WHERE notified_at IS NULL AND status IN ('ready', 'failed', 'expired');
