-- Issue #398 -- contract migration for the legacy `task` permission key (the second half of
-- the #8 rekey; 0071 was the expand step).
--
-- `task` was renamed to `work_item` in #392. 0071 copied `task` into `work_item` and KEPT
-- `task` so pods from before #392 could keep reading it during a rolling deploy. That window
-- is closed: only signed images by digest are deployed, none of them from before #392. This
-- folds any `task` still stored into `work_item` and removes `task` from every
-- `workspace_role.permission` and `apikey.permissions` value. FORWARD-ONLY: a pre-#392 build
-- could no longer read these rows, so take a backup before running it.
--
--   * `work_item` already present: it is kept. It is what the current code enforces, and
--     rows written after 0071 may have diverged from `task`.
--   * `work_item` missing (a pre-#392 pod wrote a task-only row after 0071): `task` is copied
--     into it, so no permission is lost.
--
-- Idempotent: a second run finds no `task` key. Preflight: a stored value that is not a JSON
-- object makes the migration raise before any row changes (an unparseable value raises from
-- the `::jsonb` cast itself).
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(id, ', ') INTO bad FROM (
    SELECT id FROM "workspace_role" WHERE jsonb_typeof("permission"::jsonb) <> 'object' LIMIT 5
  ) s;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '#398 preflight: workspace_role.permission is not a JSON object, e.g. workspace_role ids: %', bad;
  END IF;

  SELECT string_agg(id, ', ') INTO bad FROM (
    SELECT id FROM "apikey" WHERE "permissions" IS NOT NULL AND jsonb_typeof("permissions"::jsonb) <> 'object' LIMIT 5
  ) s;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '#398 preflight: apikey.permissions is not a JSON object, e.g. apikey ids: %', bad;
  END IF;
END $$;--> statement-breakpoint
UPDATE "workspace_role"
   SET "permission" = ((jsonb_build_object('work_item', "permission"::jsonb -> 'task') || "permission"::jsonb) - 'task')::text
 WHERE ("permission"::jsonb) ? 'task';--> statement-breakpoint
UPDATE "apikey"
   SET "permissions" = ((jsonb_build_object('work_item', "permissions"::jsonb -> 'task') || "permissions"::jsonb) - 'task')::text
 WHERE "permissions" IS NOT NULL
   AND ("permissions"::jsonb) ? 'task';
