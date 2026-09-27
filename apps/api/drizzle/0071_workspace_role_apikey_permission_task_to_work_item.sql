-- Issue #8 rekey follow-up (Opus review of pull request #392, BLOCKING). PR #392 renamed the
-- legacy `task` statement key to `work_item` in code
-- (packages/permissions/src/legacy-better-auth-access-control.ts and every
-- `requireWorkspacePermission` call site) but did nothing to the JSON already sitting in the
-- two `text` columns that store that same statement shape:
--
--   - `workspace_role.permission` -- read by `customRoleStatements()`
--     (apps/api/src/utils/require-workspace-permission.ts) for every non-`owner` role. Issue
--     #66 deliberately removed the fall-back to the compiled built-in definition, so a
--     missing/mismatched key here is a silent DENY, not a fallback to the renamed default.
--   - `apikey.permissions` -- read by `verifyApiKey()` (apps/api/src/utils/verify-api-key.ts)
--     and consulted by `hasWorkspacePermission()` as a narrowing filter on top of the
--     caller's own role.
--
-- Any row written by a pre-rename binary keeps its old `{"task": [...]}` shape forever after
-- this deploys unless backfilled: `statements["work_item"]` (or the API key's own
-- `permissions["work_item"]`) is then `undefined`, and every member of that role, or every
-- caller presenting that API key, silently loses work_item access. Same defect class as issue
-- #318/PR #322 ("a migration doesn't handle a pre-existing row").
--
-- Both columns are plain `text`, not `jsonb` (apps/api/src/database/schema.ts), so the
-- rewrite below casts to `jsonb`, renames the key, and casts back to `text` to match the
-- column type.
--
-- IDEMPOTENT: the `WHERE ... ? 'task'` guard means a second run touches zero rows, since the
-- first run already removed every `task` key. Safe to run twice.
--
-- KEEPS `task`'s value when a row somehow has BOTH `task` and `work_item` keys already
-- (Opus review, PR #392): `task` was the key actually enforced before this rename shipped, so
-- its value is what was really granted; a stray pre-existing `work_item` key could only have
-- gotten there before any validated write path could produce one (nothing wrote that key
-- until this rename), so it is inert and is safely overwritten with `task`'s value.
--
-- NEVER touches a row that has no `task` key at all -- in particular, a row already correctly
-- and exclusively keyed `work_item` is left completely alone, byte for byte.
--
-- ORDERING, checked against this repository's own deploy split (apps/api/src/index.ts):
-- `runMigrationStep()` (a separate one-shot process/Job that runs Drizzle's `migrate()`)
-- always completes before the serving API process's `runApiBootTasks()` --
-- `seedDefaultWorkspaceRoles()` included -- boots and starts accepting connections. So this
-- backfill is guaranteed to finish before any request is served by the renamed code. It is
-- also a pure data rewrite with no dependency on the code-level rename itself, so it is
-- correct to apply before or after that code change lands.
UPDATE "workspace_role"
   SET "permission" = (
     (("permission")::jsonb - 'task')
     || jsonb_build_object('work_item', ("permission")::jsonb -> 'task')
   )::text
 WHERE ("permission")::jsonb ? 'task';
--> statement-breakpoint
UPDATE "apikey"
   SET "permissions" = (
     (("permissions")::jsonb - 'task')
     || jsonb_build_object('work_item', ("permissions")::jsonb -> 'task')
   )::text
 WHERE "permissions" IS NOT NULL
   AND ("permissions")::jsonb ? 'task';
