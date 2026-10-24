-- 0151_p5_service_management: SVC-1..5, CH-1..6, REL-1..5 (service catalogue, changes, freezes, releases).
-- Additive and hand-written. New FKs onto existing populated tables are NOT VALID so no row is
-- scanned or rejected; new and updated rows are checked. No data is deleted.
-- Delete rules (P5-R1-06): service -> release / change_service CASCADE and release -> change_detail
-- SET NULL (release_id), so a workspace or service cascade never trips a per-row RESTRICT/NO ACTION
-- check; the service delete route refuses a service in use before any of them can fire.
CREATE TABLE IF NOT EXISTS "service" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"owner_team_id" text,
	"support_level" text DEFAULT 'L1' NOT NULL,
	"service_calendar_id" text,
	"status" text DEFAULT 'operational' NOT NULL,
	"status_note" text,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" text,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "service_support_level_check" CHECK ("service"."support_level" IN ('L1', 'L2', 'L3')),
	CONSTRAINT "service_status_check" CHECK ("service"."status" IN ('operational', 'degraded', 'outage'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_link" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"service_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"url" text,
	"project_id" text,
	"kb_article_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_link_kind_target_check" CHECK (("service_link"."kind" = 'documentation' AND "service_link"."url" IS NOT NULL AND "service_link"."project_id" IS NULL AND "service_link"."kb_article_id" IS NULL)
        OR ("service_link"."kind" = 'project' AND "service_link"."project_id" IS NOT NULL AND "service_link"."url" IS NULL AND "service_link"."kb_article_id" IS NULL)
        OR ("service_link"."kind" = 'kb_article' AND "service_link"."kb_article_id" IS NOT NULL AND "service_link"."url" IS NULL AND "service_link"."project_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_dependency" (
	"workspace_id" text NOT NULL,
	"service_id" text NOT NULL,
	"depends_on_service_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_dependency_pk" PRIMARY KEY("service_id","depends_on_service_id"),
	CONSTRAINT "service_dependency_not_self" CHECK ("service_dependency"."service_id" <> "service_dependency"."depends_on_service_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_release_checklist_item" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"service_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "release" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"service_id" text NOT NULL,
	"planned_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"notes_generated_at" timestamp with time zone,
	"notes_edited_at" timestamp with time zone,
	"publish_to_portal" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "release_status_check" CHECK ("release"."status" IN ('planned', 'in_progress', 'released', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_detail" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"risk" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"rollback_plan" text,
	"release_id" text,
	"freeze_override" boolean DEFAULT false NOT NULL,
	"freeze_override_reason" text,
	"freeze_override_by" text,
	"freeze_override_at" timestamp with time zone,
	"freeze_override_freezes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_detail_workspace_work_item_unique" UNIQUE("workspace_id","work_item_id"),
	CONSTRAINT "change_detail_risk_check" CHECK ("change_detail"."risk" IS NULL OR "change_detail"."risk" IN ('low', 'medium', 'high')),
	CONSTRAINT "change_detail_window_check" CHECK (("change_detail"."window_start" IS NULL AND "change_detail"."window_end" IS NULL)
        OR ("change_detail"."window_start" IS NOT NULL AND "change_detail"."window_end" IS NOT NULL AND "change_detail"."window_end" > "change_detail"."window_start")),
	CONSTRAINT "change_detail_override_check" CHECK ("change_detail"."freeze_override" = false
        OR ("change_detail"."freeze_override_reason" IS NOT NULL AND "change_detail"."freeze_override_at" IS NOT NULL))
);
--> statement-breakpoint
-- CH-4 (P5-R5-02/04): freeze-scoped override and persisted approval. Idempotent for a database that
-- already created change_detail before these columns existed.
ALTER TABLE "change_detail" ADD COLUMN IF NOT EXISTS "freeze_override_freezes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "change_detail" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_service" (
	"workspace_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"service_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_service_pk" PRIMARY KEY("work_item_id","service_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_freeze" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"reason" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_freeze_range_check" CHECK ("change_freeze"."ends_at" > "change_freeze"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_workspace_name_unique" ON "service" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_workspace_name_id_idx" ON "service" USING btree ("workspace_id","name","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_link_service_idx" ON "service_link" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_dependency_depends_on_idx" ON "service_dependency" USING btree ("depends_on_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_release_checklist_position_unique" ON "service_release_checklist_item" USING btree ("service_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "release_workspace_planned_idx" ON "release" USING btree ("workspace_id","planned_date","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_detail_workspace_window_idx" ON "change_detail" USING btree ("workspace_id","window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_detail_release_idx" ON "change_detail" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_service_service_idx" ON "change_service" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_freeze_workspace_range_idx" ON "change_freeze" USING btree ("workspace_id","starts_at","ends_at");--> statement-breakpoint
-- Foreign keys (new tables are empty, so they are validated at once; the three that point at the
-- existing populated tables work_item, checklist_item are NOT VALID below).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_workspace_id_workspace_id_fk') THEN
    ALTER TABLE "service" ADD CONSTRAINT "service_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
    ALTER TABLE "service" ADD CONSTRAINT "service_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "service" ADD CONSTRAINT "service_service_calendar_id_service_calendar_id_fk" FOREIGN KEY ("service_calendar_id") REFERENCES "public"."service_calendar"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "service" ADD CONSTRAINT "service_status_changed_by_user_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "service" ADD CONSTRAINT "service_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "service_link" ADD CONSTRAINT "service_link_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."service"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "service_link" ADD CONSTRAINT "service_link_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "service_dependency" ADD CONSTRAINT "service_dependency_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."service"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "service_dependency" ADD CONSTRAINT "service_dependency_depends_on_fk" FOREIGN KEY ("workspace_id","depends_on_service_id") REFERENCES "public"."service"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "service_release_checklist_item" ADD CONSTRAINT "service_release_checklist_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."service"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "release" ADD CONSTRAINT "release_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
    ALTER TABLE "release" ADD CONSTRAINT "release_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."service"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "release" ADD CONSTRAINT "release_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "change_detail" ADD CONSTRAINT "change_detail_work_item_fk" FOREIGN KEY ("workspace_id","work_item_id") REFERENCES "public"."work_item"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "change_detail" ADD CONSTRAINT "change_detail_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "public"."release"("workspace_id","id") ON DELETE set null ("release_id") ON UPDATE no action;
    ALTER TABLE "change_detail" ADD CONSTRAINT "change_detail_freeze_override_by_user_id_fk" FOREIGN KEY ("freeze_override_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "change_detail" ADD CONSTRAINT "change_detail_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "change_service" ADD CONSTRAINT "change_service_change_fk" FOREIGN KEY ("workspace_id","work_item_id") REFERENCES "public"."change_detail"("workspace_id","work_item_id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "change_service" ADD CONSTRAINT "change_service_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."service"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "change_freeze" ADD CONSTRAINT "change_freeze_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
    ALTER TABLE "change_freeze" ADD CONSTRAINT "change_freeze_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "change_freeze" ADD CONSTRAINT "change_freeze_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
-- SVC-3 and REL-3: existing columns become real references. Composite and NO ACTION so the
-- workspace must match; NOT VALID so populated rows are not scanned.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_item_workspace_service_fk') THEN
    ALTER TABLE "work_item" ADD CONSTRAINT "work_item_workspace_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."service"("workspace_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_item_workspace_release_fk') THEN
    ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_workspace_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "public"."release"("workspace_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- PA-15: the change freeze override is an elevated, operation-bound action. Journal order applies
-- this after 0158, so the full allowlist of 0158 is restated with the new operation appended.
ALTER TABLE "step_up_confirmation" DROP CONSTRAINT "step_up_operation_route";--> statement-breakpoint
ALTER TABLE "step_up_confirmation" ADD CONSTRAINT "step_up_operation_route" CHECK ((operation_key IS NULL) OR ((operation_key = 'metrics_token_rotate'::text) AND (route_key = 'POST /api/instance/observability/metrics-token/rotate'::text)) OR ((operation_key = 'identity_connection_create'::text) AND (route_key = 'POST /api/instance/identity-connections'::text)) OR ((operation_key = 'identity_connection_configure'::text) AND (route_key = 'PATCH /api/instance/identity-connections/{id}'::text)) OR ((operation_key = 'oidc_group_mapping_create'::text) AND (route_key = 'POST /api/instance/identity-connections/{id}/oidc-group-mappings'::text)) OR ((operation_key = 'oidc_group_mapping_update'::text) AND (route_key = 'PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}'::text)) OR ((operation_key = 'scim_admin_update'::text) AND (route_key = 'PATCH /api/instance/identity-connections/{id}/scim'::text)) OR ((operation_key = 'scim_token_rotate'::text) AND (route_key = 'POST /api/instance/identity-connections/{id}/scim/rotate-token'::text)) OR ((operation_key = 'scim_token_revoke'::text) AND (route_key = 'POST /api/instance/identity-connections/{id}/scim/revoke-token'::text)) OR ((operation_key = 'mfa_reset'::text) AND (route_key = 'POST /api/instance/users/{id}/reset-mfa'::text)) OR ((operation_key = 'instance_admin_grant'::text) AND (route_key = 'POST /api/instance/users/{id}/grant-admin'::text)) OR ((operation_key = 'instance_admin_suspend'::text) AND (route_key = 'POST /api/instance/users/{id}/suspend'::text)) OR ((operation_key = 'impersonation_start'::text) AND (route_key = 'POST /api/instance/users/{id}/impersonate'::text)) OR ((operation_key = 'secrets_rotate'::text) AND (route_key = 'POST /api/instance/plugins/rotate-secrets'::text)) OR ((operation_key = 'webhook_create'::text) AND (route_key = 'POST /api/webhooks'::text)) OR ((operation_key = 'webhook_update_url'::text) AND (route_key = 'PATCH /api/webhooks/{id}'::text)) OR ((operation_key = 'webhook_rotate_secret'::text) AND (route_key = 'POST /api/webhooks/{id}/rotate-secret'::text)) OR ((operation_key = 'workspace_role_create'::text) AND (route_key = 'POST /api/workspace/{workspaceId}/roles'::text)) OR ((operation_key = 'workspace_role_update'::text) AND (route_key = 'PATCH /api/workspace/{workspaceId}/roles/{roleId}'::text)) OR ((operation_key = 'service_key_create'::text) AND (route_key = 'POST /api/workspaces/{id}/api-keys'::text)) OR ((operation_key = 'workspace_ownership_transfer'::text) AND (route_key = 'POST /api/workspace/{workspaceId}/transfer-ownership'::text)) OR ((operation_key = 'change_freeze_override'::text) AND (route_key = 'POST /api/work-items/{key}/change/override-freeze'::text)));
