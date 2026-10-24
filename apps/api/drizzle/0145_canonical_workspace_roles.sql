-- P4 RL: custom-role capabilities move to the canonical `role` table (owner decision, Thomas, 23 Oct).
--
-- WHAT THIS DOES
--   1. Seeds the six workspace-scope built-in roles (owner, admin, manager, lead, member, viewer) as
--      real, capability-bearing `role` rows in every workspace, so automations can pick an effective
--      role and a custom role can be cloned from one. The capability lists are the compiled
--      `BUILT_IN_ROLES` lists, stored verbatim (a test pins them to the compiled data).
--      `owner` and `admin` rows already exist as empty-capability reach carriers (migration 0123); they
--      are FILLED IN PLACE, never replaced, because `membership_grant.role_id` points at them. An
--      `admin` carrier is re-keyed to the legacy `workspace_role.id` of that workspace's admin row, so
--      an old `/roles/{roleId}` link and a pending delete still resolve (every FK to `role.id` is
--      ON UPDATE CASCADE).
--   2. Migrates every legacy `workspace_role` row to a `role` row, keeping its id:
--        - a CUSTOM row becomes a custom role (`is_system = false`, rank 30, key = the legacy role string,
--          so every `workspace_member.role` reference keeps resolving) whose capabilities are the legacy
--          statements translated pair by pair (the same table as apps/api/src/permissions/legacy-statements.ts);
--        - a SYSTEM row (`viewer` / `member` / `admin`) takes the compiled list, MINUS the capability of
--          every default statement pair an administrator removed from that row, PLUS the capability of every
--          pair they added. A narrowed row is therefore never re-widened (issue #66 class);
--        - a malformed `permission` value grants nothing (fail closed), exactly as the application parses it.
--   3. `workspace_role` stays readable and is not modified: it is the legacy statement source for the three
--      default roles until a later cleanup.
--
-- NOT DONE HERE, ON PURPOSE
--   No `membership` / `membership_grant` rows are written for ordinary members: `workspace_member.role`
--   (a key pointing at `role.key`) stays the assignment pointer, because a direct system grant would override
--   an external SCIM / OIDC projection of the same person and workspace. Owner / admin reach carriers keep
--   working exactly as before.
--
-- LEGACY ROWS THAT CANNOT BE MIGRATED SAFELY
--   A non-system legacy row whose name is a reserved built-in key (a squatter such as a custom role literally
--   named `manager`) is migrated as a custom role under that same key, and the genuine built-in row of that
--   key is NOT seeded for that workspace (the unique key is taken). The application treats a non-system row
--   with a built-in key as granting nothing (issue #318), so such a row stays fail-closed. Rows named
--   `owner`, `customer` or `instance_admin` are never valid workspace roles and are skipped.
--
-- IDEMPOTENT: every insert is guarded by NOT EXISTS / ON CONFLICT DO NOTHING, the carrier fill touches only
-- empty-capability system rows, and the re-key is guarded by `id <> legacy id`.
CREATE FUNCTION pg_temp.m0145_safe_jsonb(raw text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN raw::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;--> statement-breakpoint
-- Refuse to run if identity provisioning points at an owner/admin reach carrier. Those rows held no
-- capabilities until now, so an external grant or group mapping on one conferred nothing; filling them
-- would silently turn that into owner/admin authority. The shared IdP role predicate already refuses
-- `owner` and `admin` as a mapping or default, so any such row is invalid data an operator must remove.
DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM "membership_grant" g JOIN "role" r ON r."id" = g."role_id"
        WHERE r."scope" = 'workspace' AND r."key" IN ('owner', 'admin') AND r."is_system" = true
          AND g."source_kind" <> 'direct' AND g."revoked_at" IS NULL)
     OR EXISTS (
       SELECT 1 FROM "oidc_group_mapping" m JOIN "role" r ON r."id" = m."role_id"
        WHERE r."scope" = 'workspace' AND r."key" IN ('owner', 'admin') AND r."is_system" = true)
     OR EXISTS (
       SELECT 1 FROM "scim_group_mapping" m JOIN "role" r ON r."id" = m."role_id"
        WHERE r."scope" = 'workspace' AND r."key" IN ('owner', 'admin') AND r."is_system" = true)
  THEN
    RAISE EXCEPTION 'migration 0145: an external grant or group mapping points at an owner/admin role; remove it before migrating';
  END IF;
END
$$;--> statement-breakpoint
CREATE TEMP TABLE m0145_builtin ("key" text PRIMARY KEY, "name" text NOT NULL, "description" text NOT NULL, "rank" integer NOT NULL, "capabilities" jsonb NOT NULL, "is_editable" boolean NOT NULL);--> statement-breakpoint
INSERT INTO m0145_builtin ("key", "name", "description", "rank", "capabilities", "is_editable") VALUES
  ('owner', 'Owner', 'Everything, including deleting the workspace. Not editable', 100, '["api_key:manage","approval:decide","approval:decide_cab","approval:request","approval:request_cab","attachment:create","attachment:delete_any","attachment:delete_own","automation:manage","budget:manage","budget:read","change:manage","comment:create","comment:create_internal","comment:delete_any","comment:delete_own","comment:update_any","comment:update_own","custom_field:manage","intake:triage","kb_article:publish","kb_article:read","kb_article:write","label:manage","member:invite","member:remove","project:archive","project:create","project:delete","project:manage_members","project:manage_settings","project:read","project:update","release:manage","report:export","report:read","report:read_all","request_type:manage","request_type:read","saved_view:create","saved_view:read","saved_view:share","service:manage","service:read","sla_policy:manage","sla_policy:read","time_entry:create","time_entry:delete_any","time_entry:delete_own","time_entry:log_backdated","time_entry:manage_rates","time_entry:read_any","time_entry:update_any","time_entry:update_own","webhook:manage","work_item:assign","work_item:create","work_item:delete","work_item:escalate_priority","work_item:export","work_item:rank","work_item:read","work_item:set_priority","work_item:transition","work_item:update","workflow:manage","workflow:read","workspace:delete","workspace:manage_members","workspace:manage_roles","workspace:manage_settings","workspace:read","workspace:transfer_ownership","workspace:update"]'::jsonb, false),
  ('admin', 'Admin', 'Everything except deleting the workspace', 80, '["api_key:manage","approval:decide","approval:decide_cab","approval:request","approval:request_cab","attachment:create","attachment:delete_any","attachment:delete_own","automation:manage","budget:manage","budget:read","change:manage","comment:create","comment:create_internal","comment:delete_any","comment:delete_own","comment:update_any","comment:update_own","custom_field:manage","intake:triage","kb_article:publish","kb_article:read","kb_article:write","label:manage","member:invite","member:remove","project:archive","project:create","project:delete","project:manage_members","project:manage_settings","project:read","project:update","release:manage","report:export","report:read","report:read_all","request_type:manage","request_type:read","saved_view:create","saved_view:read","saved_view:share","service:manage","service:read","sla_policy:manage","sla_policy:read","time_entry:create","time_entry:delete_any","time_entry:delete_own","time_entry:log_backdated","time_entry:manage_rates","time_entry:read_any","time_entry:update_any","time_entry:update_own","webhook:manage","work_item:assign","work_item:create","work_item:delete","work_item:escalate_priority","work_item:export","work_item:rank","work_item:read","work_item:set_priority","work_item:transition","work_item:update","workflow:manage","workflow:read","workspace:manage_members","workspace:manage_roles","workspace:manage_settings","workspace:read","workspace:update"]'::jsonb, true),
  ('manager', 'Manager', 'Runs delivery: projects, members, policies, workflows', 60, '["approval:decide","approval:request_cab","attachment:create","attachment:delete_any","attachment:delete_own","automation:manage","budget:manage","change:manage","comment:create","comment:create_internal","comment:delete_any","comment:delete_own","comment:update_any","comment:update_own","custom_field:manage","intake:triage","kb_article:publish","label:manage","member:invite","member:remove","project:archive","project:create","project:manage_members","project:manage_settings","project:read","project:update","release:manage","report:export","report:read_all","request_type:manage","saved_view:create","saved_view:share","service:manage","sla_policy:manage","time_entry:create","time_entry:delete_any","time_entry:delete_own","time_entry:log_backdated","time_entry:manage_rates","time_entry:read_any","time_entry:update_any","time_entry:update_own","webhook:manage","work_item:assign","work_item:create","work_item:delete","work_item:escalate_priority","work_item:export","work_item:rank","work_item:read","work_item:set_priority","work_item:transition","work_item:update","workflow:manage","workspace:manage_members","workspace:manage_settings","workspace:read"]'::jsonb, true),
  ('lead', 'Lead', 'Assigns work, triages intake, decides approvals within reach', 50, '["approval:decide","approval:request","attachment:create","attachment:delete_own","automation:manage","budget:read","comment:create_internal","comment:delete_own","comment:update_own","intake:triage","kb_article:write","label:manage","member:invite","project:manage_members","project:read","project:update","report:export","report:read","request_type:read","saved_view:share","service:read","sla_policy:read","time_entry:create","time_entry:delete_own","time_entry:log_backdated","time_entry:read_any","time_entry:update_own","work_item:assign","work_item:create","work_item:delete","work_item:export","work_item:rank","work_item:set_priority","work_item:transition","work_item:update","workflow:read","workspace:read"]'::jsonb, true),
  ('member', 'Member', 'Creates and updates work items, comments internally, self-assigns', 40, '["approval:decide","approval:request","attachment:create","attachment:delete_own","budget:read","comment:create_internal","comment:delete_own","comment:update_own","kb_article:write","project:read","report:read","request_type:read","saved_view:create","service:read","sla_policy:read","time_entry:create","time_entry:delete_own","time_entry:update_own","work_item:create","work_item:rank","work_item:set_priority","work_item:transition","work_item:update","workflow:read","workspace:read"]'::jsonb, true),
  ('viewer', 'Viewer', 'Read-only', 20, '["kb_article:read","project:read","report:read","request_type:read","saved_view:read","service:read","sla_policy:read","work_item:read","workflow:read","workspace:read"]'::jsonb, true);--> statement-breakpoint
CREATE TEMP TABLE m0145_pair_cap ("pair" text PRIMARY KEY, "cap" text NOT NULL);--> statement-breakpoint
INSERT INTO m0145_pair_cap ("pair", "cap") VALUES
  ('organization:update', 'workspace:update'),
  ('organization:delete', 'workspace:delete'),
  ('member:create', 'workspace:manage_members'),
  ('member:update', 'workspace:manage_members'),
  ('member:delete', 'member:remove'),
  ('invitation:create', 'member:invite'),
  ('invitation:cancel', 'member:invite'),
  ('team:create', 'workspace:manage_settings'),
  ('team:update', 'workspace:manage_settings'),
  ('team:delete', 'workspace:manage_settings'),
  ('ac:read', 'workspace:read'),
  ('ac:create', 'workspace:manage_roles'),
  ('ac:update', 'workspace:manage_roles'),
  ('ac:delete', 'workspace:manage_roles'),
  ('project:create', 'project:create'),
  ('project:read', 'project:read'),
  ('project:update', 'project:update'),
  ('project:delete', 'project:delete'),
  ('project:share', 'project:manage_members'),
  ('work_item:create', 'work_item:create'),
  ('work_item:read', 'work_item:read'),
  ('work_item:update', 'work_item:update'),
  ('work_item:delete', 'work_item:delete'),
  ('work_item:assign', 'work_item:assign'),
  ('label:create', 'label:manage'),
  ('label:read', 'workspace:read'),
  ('label:update', 'label:manage'),
  ('label:delete', 'label:manage'),
  ('workspace:read', 'workspace:read'),
  ('workspace:update', 'workspace:update'),
  ('workspace:delete', 'workspace:delete'),
  ('workspace:manage_settings', 'workspace:manage_settings');--> statement-breakpoint
CREATE TEMP TABLE m0145_default_pair ("role" text NOT NULL, "pair" text NOT NULL, PRIMARY KEY ("role", "pair"));--> statement-breakpoint
INSERT INTO m0145_default_pair ("role", "pair") VALUES
  ('viewer', 'ac:read'),
  ('viewer', 'project:read'),
  ('viewer', 'work_item:read'),
  ('viewer', 'label:read'),
  ('viewer', 'workspace:read'),
  ('member', 'ac:read'),
  ('member', 'project:create'),
  ('member', 'project:read'),
  ('member', 'work_item:create'),
  ('member', 'work_item:read'),
  ('member', 'work_item:update'),
  ('member', 'label:create'),
  ('member', 'label:read'),
  ('member', 'label:update'),
  ('member', 'label:delete'),
  ('member', 'workspace:read'),
  ('admin', 'organization:update'),
  ('admin', 'invitation:create'),
  ('admin', 'invitation:cancel'),
  ('admin', 'member:create'),
  ('admin', 'member:update'),
  ('admin', 'member:delete'),
  ('admin', 'team:create'),
  ('admin', 'team:update'),
  ('admin', 'team:delete'),
  ('admin', 'ac:create'),
  ('admin', 'ac:read'),
  ('admin', 'ac:update'),
  ('admin', 'ac:delete'),
  ('admin', 'project:create'),
  ('admin', 'project:read'),
  ('admin', 'project:update'),
  ('admin', 'project:delete'),
  ('admin', 'project:share'),
  ('admin', 'work_item:create'),
  ('admin', 'work_item:read'),
  ('admin', 'work_item:update'),
  ('admin', 'work_item:delete'),
  ('admin', 'work_item:assign'),
  ('admin', 'label:create'),
  ('admin', 'label:read'),
  ('admin', 'label:update'),
  ('admin', 'label:delete'),
  ('admin', 'workspace:read'),
  ('admin', 'workspace:update'),
  ('admin', 'workspace:manage_settings');--> statement-breakpoint
-- Every statement pair a legacy row stores (a malformed or non-object value yields no pairs).
CREATE TEMP TABLE m0145_legacy_pair AS
SELECT wr."id" AS role_id, (r.resource || ':' || a.action) AS pair
  FROM "workspace_role" wr
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(pg_temp.m0145_safe_jsonb(wr."permission")) = 'object'
                                     THEN pg_temp.m0145_safe_jsonb(wr."permission") ELSE '{}'::jsonb END) AS r(resource, actions)
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.actions) = 'array' THEN r.actions ELSE '[]'::jsonb END) AS a(action);--> statement-breakpoint
-- The capabilities each migrated legacy row carries.
CREATE TEMP TABLE m0145_legacy_caps AS
SELECT wr."id" AS role_id,
       wr."workspace_id",
       wr."role" AS "key",
       wr."is_system",
       wr."created_at",
       wr."updated_at",
       CASE
         WHEN wr."is_system" AND wr."role" IN ('viewer', 'member', 'admin') THEN
           CASE WHEN jsonb_typeof(pg_temp.m0145_safe_jsonb(wr."permission")) = 'object' THEN
             (
               SELECT COALESCE(jsonb_agg(DISTINCT cap ORDER BY cap), '[]'::jsonb) FROM (
                 SELECT c.cap FROM jsonb_array_elements_text((SELECT b."capabilities" FROM m0145_builtin b WHERE b."key" = wr."role")) AS c(cap)
                  WHERE NOT EXISTS (
                    SELECT 1 FROM m0145_default_pair d JOIN m0145_pair_cap pc ON pc."pair" = d."pair"
                     WHERE d."role" = wr."role" AND pc."cap" = c.cap
                       AND NOT EXISTS (SELECT 1 FROM m0145_legacy_pair lp WHERE lp.role_id = wr."id" AND lp.pair = d."pair"))
                 UNION
                 SELECT pc."cap" FROM m0145_legacy_pair lp JOIN m0145_pair_cap pc ON pc."pair" = lp.pair
                  WHERE lp.role_id = wr."id"
                    AND NOT EXISTS (SELECT 1 FROM m0145_default_pair d WHERE d."role" = wr."role" AND d."pair" = lp.pair)
               ) s
             )
           ELSE '[]'::jsonb END
         ELSE
           (SELECT COALESCE(jsonb_agg(DISTINCT pc."cap" ORDER BY pc."cap"), '[]'::jsonb)
              FROM m0145_legacy_pair lp JOIN m0145_pair_cap pc ON pc."pair" = lp.pair
             WHERE lp.role_id = wr."id")
       END AS capabilities
  FROM "workspace_role" wr
 WHERE wr."role" NOT IN ('owner', 'customer', 'instance_admin');--> statement-breakpoint
-- 1a. Re-key an existing admin carrier to the legacy admin row's id (FKs are ON UPDATE CASCADE).
-- The old -> new id pairs are captured first: `instance_setting.local_factor_policy.requiredRoleId` is a jsonb
-- value with no FK (the 0086 guard trigger only blocks DELETE), so it does not follow the cascade and is
-- rewritten below in the same transaction. Without that, a policy pointing at a renamed carrier would make
-- every sign-in fail closed ("Configured factor role is unavailable").
CREATE TEMP TABLE m0145_rekey AS
SELECT r."id" AS old_id, lc.role_id AS new_id
  FROM "role" r JOIN m0145_legacy_caps lc ON r."workspace_id" = lc."workspace_id"
 WHERE r."scope" = 'workspace' AND r."key" = 'admin' AND r."is_system" = true
   AND lc."key" = 'admin' AND lc."is_system" = true AND r."id" <> lc.role_id
   AND NOT EXISTS (SELECT 1 FROM "role" x WHERE x."id" = lc.role_id);--> statement-breakpoint
UPDATE "role" r SET "id" = k.new_id
  FROM m0145_rekey k
 WHERE r."id" = k.old_id;--> statement-breakpoint
UPDATE "instance_setting" s
   SET "local_factor_policy" = jsonb_set(s."local_factor_policy", '{requiredRoleId}', to_jsonb(k.new_id))
  FROM m0145_rekey k
 WHERE s."local_factor_policy"->>'requiredRoleId' = k.old_id;--> statement-breakpoint
DROP TABLE m0145_rekey;--> statement-breakpoint
-- 1b. Fill the empty owner / admin reach carriers in place. An admin carrier takes the narrowed-aware list of
-- that workspace's legacy admin row when one exists, so a narrowed admin is never re-widened.
UPDATE "role" r SET "name" = b."name", "description" = b."description",
       "is_editable" = b."is_editable",
       "capabilities" = COALESCE(
         (SELECT lc.capabilities FROM m0145_legacy_caps lc
           WHERE lc."workspace_id" = r."workspace_id" AND lc."key" = 'admin' AND lc."is_system" = true AND r."key" = 'admin'),
         b."capabilities"),
       "updated_at" = now()
  FROM m0145_builtin b
 WHERE r."scope" = 'workspace' AND r."workspace_id" IS NOT NULL AND r."key" = b."key" AND b."key" IN ('owner', 'admin')
   AND r."is_system" = true AND r."capabilities" = '[]'::jsonb;--> statement-breakpoint
-- 2a. Migrated system rows (viewer / member / admin): the legacy id, the narrowed-aware capability list.
INSERT INTO "role" ("id", "scope", "workspace_id", "key", "name", "description", "rank", "capabilities", "is_system", "is_editable", "created_at", "updated_at")
SELECT lc.role_id, 'workspace', lc."workspace_id", lc."key", b."name", b."description", b."rank", lc.capabilities, true, b."is_editable", lc."created_at", lc."updated_at"
  FROM m0145_legacy_caps lc JOIN m0145_builtin b ON b."key" = lc."key"
 WHERE lc."is_system" = true AND lc."key" IN ('viewer', 'member', 'admin')
   AND NOT EXISTS (SELECT 1 FROM "role" x WHERE x."scope" = 'workspace' AND x."workspace_id" = lc."workspace_id" AND x."key" = lc."key")
   AND NOT EXISTS (SELECT 1 FROM "role" x WHERE x."id" = lc.role_id)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 2b. Migrated custom rows (including squatters, which stay fail-closed in the application).
INSERT INTO "role" ("id", "scope", "workspace_id", "key", "name", "description", "rank", "capabilities", "is_system", "is_editable", "created_at", "updated_at")
SELECT lc.role_id, 'workspace', lc."workspace_id", lc."key", lc."key", NULL, 30, lc.capabilities, false, true, lc."created_at", lc."updated_at"
  FROM m0145_legacy_caps lc
 WHERE NOT (lc."is_system" = true AND lc."key" IN ('viewer', 'member', 'admin'))
   AND NOT EXISTS (SELECT 1 FROM "role" x WHERE x."scope" = 'workspace' AND x."workspace_id" = lc."workspace_id" AND x."key" = lc."key")
   AND NOT EXISTS (SELECT 1 FROM "role" x WHERE x."id" = lc.role_id)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 3. The six built-ins that still have no row (owner, manager, lead and any workspace without legacy rows).
INSERT INTO "role" ("id", "scope", "workspace_id", "key", "name", "description", "rank", "capabilities", "is_system", "is_editable")
SELECT gen_random_uuid()::text, 'workspace', w."id", b."key", b."name", b."description", b."rank", b."capabilities", true, b."is_editable"
  FROM "workspace" w CROSS JOIN m0145_builtin b
 WHERE NOT EXISTS (SELECT 1 FROM "role" x WHERE x."scope" = 'workspace' AND x."workspace_id" = w."id" AND x."key" = b."key")
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE m0145_legacy_caps;--> statement-breakpoint
DROP TABLE m0145_legacy_pair;--> statement-breakpoint
DROP TABLE m0145_default_pair;--> statement-breakpoint
DROP TABLE m0145_pair_cap;--> statement-breakpoint
DROP TABLE m0145_builtin;--> statement-breakpoint
DROP FUNCTION pg_temp.m0145_safe_jsonb(text);
