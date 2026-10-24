-- 0139 custom field tenant anchor (N2 forward item after 0120; P4 custom fields).
-- custom_field_type_visibility and custom_field_value had no workspace_id, so nothing stopped a
-- row pointing across tenants. Add the column, backfill it from the owning custom_field, make it
-- NOT NULL and pin every reference to the same workspace with composite foreign keys. The parent
-- keys custom_field_workspace_id_id_unique, work_item_type_workspace_id_id_unique,
-- work_item_workspace_id_id_unique and project_workspace_id_id_unique already exist.
ALTER TABLE "custom_field_type_visibility" ADD COLUMN "workspace_id" text;--> statement-breakpoint
UPDATE "custom_field_type_visibility" SET "workspace_id" = "custom_field"."workspace_id" FROM "custom_field" WHERE "custom_field"."id" = "custom_field_type_visibility"."custom_field_id";--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" DROP CONSTRAINT "custom_field_type_visibility_custom_field_id_custom_field_id_fk";--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" DROP CONSTRAINT "custom_field_type_visibility_work_item_type_id_work_item_type_i";--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" ADD CONSTRAINT "custom_field_type_visibility_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" ADD CONSTRAINT "custom_field_type_visibility_workspace_field_fk" FOREIGN KEY ("workspace_id","custom_field_id") REFERENCES "public"."custom_field"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" ADD CONSTRAINT "custom_field_type_visibility_workspace_type_fk" FOREIGN KEY ("workspace_id","work_item_type_id") REFERENCES "public"."work_item_type"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_type_visibility_workspaceId_idx" ON "custom_field_type_visibility" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD COLUMN "workspace_id" text;--> statement-breakpoint
UPDATE "custom_field_value" SET "workspace_id" = "custom_field"."workspace_id" FROM "custom_field" WHERE "custom_field"."id" = "custom_field_value"."custom_field_id";--> statement-breakpoint
ALTER TABLE "custom_field_value" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_value" DROP CONSTRAINT "custom_field_value_custom_field_id_custom_field_id_fk";--> statement-breakpoint
ALTER TABLE "custom_field_value" DROP CONSTRAINT "custom_field_value_project_id_project_id_fk";--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_workspace_field_fk" FOREIGN KEY ("workspace_id","custom_field_id") REFERENCES "public"."custom_field"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_workspace_work_item_fk" FOREIGN KEY ("workspace_id","entity_id") REFERENCES "public"."work_item"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_value_workspaceId_idx" ON "custom_field_value" USING btree ("workspace_id");
