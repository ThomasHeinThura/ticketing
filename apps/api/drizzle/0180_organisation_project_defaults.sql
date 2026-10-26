CREATE TABLE "organisation_project_default" (
	"organisation_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"service_calendar_id" text,
	"sla_policy_id" text,
	CONSTRAINT "organisation_project_default_organisation_id_workspace_id_pk" PRIMARY KEY("organisation_id","workspace_id"),
	CONSTRAINT "organisation_project_default_has_value" CHECK ("organisation_project_default"."service_calendar_id" IS NOT NULL OR "organisation_project_default"."sla_policy_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "organisation_project_default" ADD CONSTRAINT "organisation_project_default_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_project_default" ADD CONSTRAINT "organisation_project_default_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_project_default" ADD CONSTRAINT "organisation_project_default_calendar_workspace_fk" FOREIGN KEY ("workspace_id","service_calendar_id") REFERENCES "public"."service_calendar"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_project_default" ADD CONSTRAINT "organisation_project_default_sla_workspace_fk" FOREIGN KEY ("workspace_id","sla_policy_id") REFERENCES "public"."sla_policy"("workspace_id","id") ON DELETE restrict ON UPDATE no action;