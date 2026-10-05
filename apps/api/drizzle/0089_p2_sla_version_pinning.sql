ALTER TABLE "project" ADD COLUMN "sla_policy_id" text;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "sla_policy_version_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "default_sla_policy_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_sla_policy_id_sla_policy_id_fk" FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policy"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_sla_policy_version_id_sla_policy_version_id_fk" FOREIGN KEY ("sla_policy_version_id") REFERENCES "public"."sla_policy_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_sla_policy_id_sla_policy_id_fk" FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policy"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_default_sla_policy_id_sla_policy_id_fk" FOREIGN KEY ("default_sla_policy_id") REFERENCES "public"."sla_policy"("id") ON DELETE restrict ON UPDATE cascade;