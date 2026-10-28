ALTER TABLE "project" DROP CONSTRAINT "project_managed_service_complete";--> statement-breakpoint
DROP INDEX "identity_connection_organisation_unique";--> statement-breakpoint
ALTER TABLE "external_identity" ADD COLUMN "orphaned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity_connection" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "sla_policy_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "service_calendar_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "state_set_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "project_settings_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "default_service_calendar_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "project_settings_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Preserve current behavior on existing projects; only new projects default to inheritance.
UPDATE "project" SET
  "sla_policy_mode" = CASE WHEN "sla_policy_id" IS NULL THEN 'inherit' ELSE 'override' END,
  "service_calendar_mode" = 'override',
  "state_set_mode" = 'override';
--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_default_service_calendar_workspace_fk" FOREIGN KEY ("id","default_service_calendar_id") REFERENCES "public"."service_calendar"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_connection_organisation_unique" ON "identity_connection" USING btree ("organisation_id") WHERE (organisation_id IS NOT NULL AND deleted_at IS NULL);--> statement-breakpoint
ALTER TABLE "identity_connection" ADD CONSTRAINT "identity_connection_deleted_disabled" CHECK ("identity_connection"."deleted_at" IS NULL OR "identity_connection"."enabled" = false);--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_sla_policy_mode_allowed" CHECK ("project"."sla_policy_mode" IN ('inherit', 'override'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_service_calendar_mode_allowed" CHECK ("project"."service_calendar_mode" IN ('inherit', 'override'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_state_set_mode_allowed" CHECK ("project"."state_set_mode" IN ('inherit', 'override'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_settings_version_positive" CHECK ("project"."project_settings_version" > 0);--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_managed_service_complete" CHECK ((kind <> 'managed_service'::text) OR ((support_level IS NOT NULL) AND ((service_calendar_id IS NOT NULL) OR (service_calendar_mode = 'inherit'))));--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_project_settings_version_positive" CHECK ("workspace"."project_settings_version" > 0);
--> statement-breakpoint
-- Deferred backstop: inherited managed-service calendars must exist in the final transaction state.
CREATE FUNCTION taskdesk_check_effective_service_calendar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE invalid_project text;
BEGIN
  IF TG_TABLE_NAME = 'project' THEN
    SELECT p.id INTO invalid_project
    FROM project p JOIN workspace w ON w.id = p.workspace_id
    WHERE p.id = NEW.id AND p.kind = 'managed_service'
      AND (CASE WHEN p.service_calendar_mode = 'inherit'
        THEN w.default_service_calendar_id ELSE p.service_calendar_id END) IS NULL;
  ELSE
    SELECT p.id INTO invalid_project
    FROM project p JOIN workspace w ON w.id = p.workspace_id
    WHERE w.id = NEW.id AND p.kind = 'managed_service'
      AND (CASE WHEN p.service_calendar_mode = 'inherit'
        THEN w.default_service_calendar_id ELSE p.service_calendar_id END) IS NULL
    LIMIT 1;
  END IF;
  IF invalid_project IS NOT NULL THEN
    RAISE EXCEPTION 'managed service requires an effective calendar'
      USING ERRCODE = '23514', CONSTRAINT = 'project_effective_calendar_required';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER project_effective_calendar_required
AFTER INSERT OR UPDATE ON project DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION taskdesk_check_effective_service_calendar();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_effective_calendar_required
AFTER UPDATE ON workspace DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION taskdesk_check_effective_service_calendar();
