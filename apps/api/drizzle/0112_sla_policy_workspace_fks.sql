ALTER TABLE "project" DROP CONSTRAINT "project_sla_policy_id_sla_policy_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item" DROP CONSTRAINT "work_item_sla_policy_version_id_sla_policy_version_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item_type" DROP CONSTRAINT "work_item_type_sla_policy_id_sla_policy_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace" DROP CONSTRAINT "workspace_default_sla_policy_id_sla_policy_id_fk";
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_sla_policy_fk" FOREIGN KEY ("workspace_id","sla_policy_id") REFERENCES "public"."sla_policy"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_workspace_sla_policy_version_fk" FOREIGN KEY ("workspace_id","sla_policy_version_id") REFERENCES "public"."sla_policy_version"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_workspace_sla_policy_fk" FOREIGN KEY ("workspace_id","sla_policy_id") REFERENCES "public"."sla_policy"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_default_sla_policy_workspace_fk" FOREIGN KEY ("id","default_sla_policy_id") REFERENCES "public"."sla_policy"("workspace_id","id") ON DELETE restrict ON UPDATE no action;