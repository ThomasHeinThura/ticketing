DROP INDEX "label_workspace_name_unique";--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_workspace_id_project_id_project_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_project_id_idx" ON "label" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_project_name_unique" ON "label" USING btree ("project_id","name") WHERE (project_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "label_workspace_name_unique" ON "label" USING btree ("workspace_id","name") WHERE (task_id IS NULL AND project_id IS NULL);--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_catalogue_or_task" CHECK ("label"."task_id" IS NULL OR "label"."project_id" IS NULL);