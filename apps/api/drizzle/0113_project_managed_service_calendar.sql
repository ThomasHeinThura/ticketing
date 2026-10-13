ALTER TABLE "project" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "health" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "support_level" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "service_calendar_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_service_calendar_fk" FOREIGN KEY ("workspace_id","service_calendar_id") REFERENCES "public"."service_calendar"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_workspace_service_calendar_idx" ON "project" USING btree ("workspace_id","service_calendar_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_kind_allowed" CHECK ("project"."kind" in ('project', 'managed_service'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_health_allowed" CHECK ("project"."health" is null or "project"."health" in ('red', 'amber', 'green'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_support_level_allowed" CHECK ("project"."support_level" is null or "project"."support_level" in ('L1', 'L2', 'L3'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_managed_service_complete" CHECK ("project"."kind" <> 'managed_service' or ("project"."support_level" is not null and "project"."service_calendar_id" is not null));