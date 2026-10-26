CREATE TABLE "organisation_deletion_project_snapshot" (
	"operation_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prior_archived_at" timestamp,
	"prior_archive_version" bigint NOT NULL,
	"expected_archive_version" bigint NOT NULL,
	"archived_by_operation" boolean NOT NULL,
	CONSTRAINT "organisation_deletion_project_snapshot_operation_id_project_id_pk" PRIMARY KEY("operation_id","project_id"),
	CONSTRAINT "organisation_deletion_project_snapshot_versions_safe" CHECK (prior_archive_version >= 0 AND prior_archive_version <= 9007199254740991 AND expected_archive_version >= prior_archive_version AND expected_archive_version <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "organisation_deletion_snapshot" (
	"organisation_id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"generation" bigint NOT NULL,
	"deleted_at" timestamp NOT NULL,
	"purge_after" timestamp NOT NULL,
	"prior_active" boolean NOT NULL,
	"prior_portal_access" boolean NOT NULL,
	CONSTRAINT "organisation_deletion_snapshot_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "organisation_deletion_snapshot_operation_org_unique" UNIQUE("operation_id","organisation_id"),
	CONSTRAINT "organisation_deletion_snapshot_generation_safe" CHECK (generation > 0 AND generation <= 9007199254740991)
);
--> statement-breakpoint
DROP INDEX "pending_action_expiry_scoped_idx";--> statement-breakpoint
DROP INDEX "pending_action_expiry_unscoped_probe_idx";--> statement-breakpoint
DROP INDEX "pending_action_one_pending_target_unique";--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "deletion_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "archive_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "organisation_deletion_operation_id" text;--> statement-breakpoint
ALTER TABLE "organisation_deletion_project_snapshot" ADD CONSTRAINT "organisation_deletion_project_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_deletion_project_snapshot" ADD CONSTRAINT "organisation_deletion_project_snapshot_operation_org_fk" FOREIGN KEY ("operation_id","organisation_id") REFERENCES "public"."organisation_deletion_snapshot"("operation_id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_deletion_snapshot" ADD CONSTRAINT "organisation_deletion_snapshot_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organisation_deletion_project_snapshot_org_idx" ON "organisation_deletion_project_snapshot" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "pending_action_expiry_scoped_idx" ON "pending_action" USING btree ("expires_at","id") WHERE state = 'pending'::text AND (workspace_id IS NOT NULL OR (workspace_id IS NULL AND (project_id IS NULL AND ((organisation_id IS NULL AND (((action = 'delete'::text) AND (target_type = 'user'::text) AND (route_key = 'POST /api/instance/users/{id}/deactivate'::text)) OR ((action = 'user_deactivation'::text) AND (target_type = 'person'::text) AND (route_key = 'POST /api/instance/users/{id}/deactivate'::text)))) OR (organisation_id IS NOT NULL AND target_type = 'organisation'::text AND ((action = 'delete'::text AND route_key = 'DELETE /api/instance/organisations/{id}'::text) OR (action = 'purge'::text AND route_key = 'POST /api/instance/purge'::text)))))));--> statement-breakpoint
CREATE INDEX "pending_action_expiry_unscoped_probe_idx" ON "pending_action" USING btree ("expires_at") WHERE state = 'pending'::text AND workspace_id IS NULL AND NOT (project_id IS NULL AND ((organisation_id IS NULL AND (((action = 'delete'::text) AND (target_type = 'user'::text) AND (route_key = 'POST /api/instance/users/{id}/deactivate'::text)) OR ((action = 'user_deactivation'::text) AND (target_type = 'person'::text) AND (route_key = 'POST /api/instance/users/{id}/deactivate'::text)))) OR (organisation_id IS NOT NULL AND target_type = 'organisation'::text AND ((action = 'delete'::text AND route_key = 'DELETE /api/instance/organisations/{id}'::text) OR (action = 'purge'::text AND route_key = 'POST /api/instance/purge'::text)))));--> statement-breakpoint
CREATE UNIQUE INDEX "pending_action_one_pending_target_unique" ON "pending_action" USING btree ("requested_by_person_id","action","target_type","route_key","target_ids","state") WHERE (state = 'pending'::text);--> statement-breakpoint
ALTER TABLE "organisation" ADD CONSTRAINT "organisation_deletion_generation_safe" CHECK (deletion_generation >= 0 AND deletion_generation <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_archive_version_safe" CHECK (archive_version >= 0 AND archive_version <= 9007199254740991);
--> statement-breakpoint
-- Fence restores against every independent archive, delete and ownership writer.
-- An org deletion supplies a new operation marker; normal writers leave the old
-- marker unchanged, which clears it and makes their later choice authoritative.
CREATE FUNCTION taskdesk_project_archive_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.archive_version := OLD.archive_version + 1;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.organisation_deletion_operation_id IS NOT DISTINCT FROM OLD.organisation_deletion_operation_id THEN
    NEW.organisation_deletion_operation_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER taskdesk_project_archive_fence
BEFORE UPDATE OF archived_at, deleted_at, organisation_id ON project
FOR EACH ROW EXECUTE FUNCTION taskdesk_project_archive_fence();
