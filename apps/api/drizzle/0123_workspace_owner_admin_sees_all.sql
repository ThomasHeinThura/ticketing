-- Workspace owners and admins hold an explicit `sees_all` grant (decision log 2026-10-14,
-- "Workspace owners and admins hold an explicit `sees_all` grant"; rbac.md Reach step 2).
--
-- BACKFILL for workspaces and members that already exist. New ones are covered by the
-- application writers (`apps/api/src/workspace/workspace-admin-reach.ts`). Data-only: no
-- schema change.
--
-- ELIGIBLE: a staff person whose legacy `workspace_member` row for a workspace is the ONLY
-- row for that (workspace, user) pair (duplicate rows are ambiguous and fail closed, like the
-- runtime resolver) and whose role is `owner`, or `admin` backed by the genuine seeded
-- (`is_system`) `workspace_role` row. Managers, members, viewers and customers get nothing.
--
-- PROVENANCE: a DIRECT `membership_grant` with `direct_origin = 'system_backfill'` and
-- `sees_all = true`, projected onto the one effective `membership` row exactly as
-- `projectMembershipKeys` does (rbac.md: `sees_all` is true only when the selected DIRECT
-- grant carries it). An existing active direct grant (an explicit admin-made one) is never
-- replaced or duplicated. External (SCIM / OIDC / JIT) grants are kept, only unlinked from
-- the effective row, as the projection would.
--
-- CARRIER ROLE: per-workspace `role` rows (`owner` / `admin`, scope `workspace`,
-- `is_system`) with an EMPTY capability list: reach carrier only. Authority for these roles
-- keeps coming from the compiled-in built-ins, so no capability snapshot can go stale.
--
-- IDEMPOTENT: every insert is guarded by NOT EXISTS / ON CONFLICT, and the projection
-- re-applies the same values, so running it twice changes nothing the second time.
INSERT INTO "role" ("id", "scope", "workspace_id", "key", "name", "description", "rank", "capabilities", "is_system", "is_editable")
SELECT gen_random_uuid()::text, 'workspace', e.workspace_id, e.role,
       CASE e.role WHEN 'owner' THEN 'Owner' ELSE 'Admin' END,
       'Workspace-wide reach carrier (explicit sees_all). Authority is not read from this row.',
       CASE e.role WHEN 'owner' THEN 100 ELSE 80 END,
       '[]'::jsonb, true, false
  FROM (
    SELECT DISTINCT wm.workspace_id, wm.role
      FROM "workspace_member" wm
      JOIN "workspace" w ON w.id = wm.workspace_id
      JOIN "person" p ON p.user_id = wm.user_id AND p.side = 'staff'
     WHERE wm.role IN ('owner', 'admin')
       AND (SELECT count(*) FROM "workspace_member" d
             WHERE d.workspace_id = wm.workspace_id AND d.user_id = wm.user_id) = 1
       AND (wm.role = 'owner' OR EXISTS (
             SELECT 1 FROM "workspace_role" wr
              WHERE wr.workspace_id = wm.workspace_id AND wr.role = 'admin' AND wr.is_system = true))
  ) e
 WHERE NOT EXISTS (
   SELECT 1 FROM "role" r
    WHERE r.scope = 'workspace' AND r.workspace_id = e.workspace_id AND r.key = e.role
 );--> statement-breakpoint
INSERT INTO "membership_grant" ("id", "person_id", "scope", "scope_id", "role_id", "source_kind", "direct_origin", "sees_all")
SELECT gen_random_uuid()::text, e.person_id, 'workspace', e.workspace_id, r.id, 'direct', 'system_backfill', true
  FROM (
    SELECT wm.workspace_id, wm.role, p.id AS person_id
      FROM "workspace_member" wm
      JOIN "workspace" w ON w.id = wm.workspace_id
      JOIN "person" p ON p.user_id = wm.user_id AND p.side = 'staff'
     WHERE wm.role IN ('owner', 'admin')
       AND (SELECT count(*) FROM "workspace_member" d
             WHERE d.workspace_id = wm.workspace_id AND d.user_id = wm.user_id) = 1
       AND (wm.role = 'owner' OR EXISTS (
             SELECT 1 FROM "workspace_role" wr
              WHERE wr.workspace_id = wm.workspace_id AND wr.role = 'admin' AND wr.is_system = true))
  ) e
  JOIN "role" r ON r.scope = 'workspace' AND r.workspace_id = e.workspace_id AND r.key = e.role AND r.is_system = true
 WHERE NOT EXISTS (
   SELECT 1 FROM "membership_grant" g
    WHERE g.person_id = e.person_id AND g.scope = 'workspace' AND g.scope_id = e.workspace_id
      AND g.source_kind = 'direct' AND g.revoked_at IS NULL
 );--> statement-breakpoint
INSERT INTO "membership" ("id", "person_id", "scope", "scope_id", "role_id", "sees_all")
SELECT gen_random_uuid()::text, g.person_id, 'workspace', g.scope_id, g.role_id, true
  FROM "membership_grant" g
 WHERE g.scope = 'workspace' AND g.source_kind = 'direct' AND g.direct_origin = 'system_backfill'
   AND g.revoked_at IS NULL
ON CONFLICT ("person_id", "scope", "scope_id")
DO UPDATE SET "role_id" = EXCLUDED."role_id", "sees_all" = true, "updated_at" = now();--> statement-breakpoint
UPDATE "scim_group_member" s
   SET "membership_id" = NULL
  FROM "membership" m
  JOIN "membership_grant" g
    ON g.person_id = m.person_id AND g.scope = m.scope AND g.scope_id = m.scope_id
 WHERE s.membership_id = m.id
   AND g.scope = 'workspace' AND g.source_kind = 'direct' AND g.direct_origin = 'system_backfill'
   AND g.revoked_at IS NULL;--> statement-breakpoint
UPDATE "membership_grant" o
   SET "membership_id" = NULL
  FROM "membership_grant" g
 WHERE g.scope = 'workspace' AND g.source_kind = 'direct' AND g.direct_origin = 'system_backfill'
   AND g.revoked_at IS NULL
   AND o.person_id = g.person_id AND o.scope = g.scope AND o.scope_id = g.scope_id
   AND o.id <> g.id AND o.revoked_at IS NULL AND o.membership_id IS NOT NULL;--> statement-breakpoint
UPDATE "membership_grant" g
   SET "membership_id" = m.id
  FROM "membership" m
 WHERE g.scope = 'workspace' AND g.source_kind = 'direct' AND g.direct_origin = 'system_backfill'
   AND g.revoked_at IS NULL
   AND m.person_id = g.person_id AND m.scope = g.scope AND m.scope_id = g.scope_id
   AND g.membership_id IS DISTINCT FROM m.id;
