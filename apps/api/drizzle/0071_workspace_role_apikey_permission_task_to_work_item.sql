-- Issue #8 capability-key expansion for workspace-role and API-key permissions.
--
-- Helm runs this migration in each new pod's init container while old replicas can still
-- serve traffic. Old replicas read `task`; new replicas read `work_item`. Keep both keys
-- during the rolling deployment so neither version loses existing permissions. A later
-- contract migration may remove `task` only after old binaries are no longer serving and
-- the rollback window has ended.
--
-- The pre-upgrade `task` value is authoritative if both keys already exist: it is what the
-- previous code enforced. Copy it to `work_item` but retain `task` for old replicas. Replays
-- produce the same JSON value and are safe.
UPDATE "workspace_role"
   SET "permission" = (
     ("permission"::jsonb)
     || jsonb_build_object('work_item', "permission"::jsonb -> 'task')
   )::text
 WHERE ("permission"::jsonb) ? 'task';
--> statement-breakpoint
UPDATE "apikey"
   SET "permissions" = (
     ("permissions"::jsonb)
     || jsonb_build_object('work_item', "permissions"::jsonb -> 'task')
   )::text
 WHERE "permissions" IS NOT NULL
   AND ("permissions"::jsonb) ? 'task';
