ALTER TABLE "membership_grant" DROP CONSTRAINT "membership_grant_direct_origin_check";--> statement-breakpoint
ALTER TABLE "membership_grant" DROP CONSTRAINT "membership_grant_source_shape_check";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_direct_origin_check" CHECK ((direct_origin IS NULL) OR (direct_origin = ANY (ARRAY['admin'::text, 'system_backfill'::text, 'project_creator'::text])));--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_source_shape_check" CHECK (((source_kind = 'direct'::text) AND (direct_origin IS NOT NULL) AND (((direct_origin = 'admin'::text) AND (granted_by_person_id IS NOT NULL)) OR ((direct_origin = ANY (ARRAY['system_backfill'::text, 'project_creator'::text])) AND (granted_by_person_id IS NULL))) AND (external_identity_id IS NULL) AND (identity_connection_id IS NULL) AND (oidc_group_mapping_id IS NULL) AND (scim_group_mapping_id IS NULL)) OR ((source_kind = 'jit_default'::text) AND (direct_origin IS NULL) AND (granted_by_person_id IS NULL) AND (external_identity_id IS NOT NULL) AND (identity_connection_id IS NOT NULL) AND (oidc_group_mapping_id IS NULL) AND (scim_group_mapping_id IS NULL) AND (sees_all = false)) OR ((source_kind = 'oidc_group'::text) AND (direct_origin IS NULL) AND (granted_by_person_id IS NULL) AND (external_identity_id IS NOT NULL) AND (identity_connection_id IS NOT NULL) AND (oidc_group_mapping_id IS NOT NULL) AND (scim_group_mapping_id IS NULL) AND (sees_all = false)) OR ((source_kind = 'scim_group'::text) AND (direct_origin IS NULL) AND (granted_by_person_id IS NULL) AND (external_identity_id IS NOT NULL) AND (identity_connection_id IS NOT NULL) AND (oidc_group_mapping_id IS NULL) AND (scim_group_mapping_id IS NOT NULL) AND (sees_all = false)));
--> statement-breakpoint
-- Decision log 2026-10-14 "A project's creator holds a project-lead membership".
--
-- Data-only seed: one project-scope `project-lead` role per existing workspace, so the role
-- exists to assign (#435). Capabilities are EXACTLY the built-in `lead` list in rbac.md /
-- `BUILT_IN_ROLES.lead` (a test pins this literal against it). New workspaces get the same
-- row from `ensureProjectLeadRole`. NO membership or grant is backfilled: nothing records who
-- created an existing project, and a guessed creator could grant reach to the wrong person.
-- Idempotent: guarded by the (scope, workspace, key) uniqueness.
INSERT INTO "role" ("id", "scope", "workspace_id", "key", "name", "description", "rank", "capabilities", "is_system", "is_editable")
SELECT gen_random_uuid()::text, 'project', w.id, 'project-lead', 'Project lead',
       'Project-scope lead granted to the creator of a project (rbac.md built-in lead capabilities).',
       50, '["workspace:read", "project:read", "project:update", "project:manage_members", "work_item:create", "work_item:update", "work_item:delete", "work_item:assign", "work_item:transition", "work_item:rank", "work_item:set_priority", "work_item:export", "comment:create_internal", "comment:update_own", "comment:delete_own", "attachment:create", "attachment:delete_own", "label:manage", "saved_view:share", "sla_policy:read", "workflow:read", "request_type:read", "intake:triage", "approval:request", "approval:decide", "time_entry:create", "time_entry:update_own", "time_entry:delete_own", "time_entry:read_any", "time_entry:log_backdated", "budget:read", "report:read", "report:export", "kb_article:write", "service:read", "member:invite", "automation:manage"]'::jsonb, true, true
  FROM "workspace" w
 WHERE NOT EXISTS (
   SELECT 1 FROM "role" r
    WHERE r.scope = 'project' AND r.workspace_id = w.id AND r.key = 'project-lead'
 );
