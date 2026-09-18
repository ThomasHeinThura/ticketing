CREATE UNIQUE INDEX "state_project_default_unique" ON "state" USING btree ("project_id") WHERE "state"."is_default";--> statement-breakpoint
ALTER TABLE "state_template" ADD CONSTRAINT "state_template_group_allowed" CHECK ("state_template"."group" in ('backlog', 'unstarted', 'started', 'completed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "watcher" ADD CONSTRAINT "watcher_source_allowed" CHECK ("watcher"."source" in ('explicit', 'implicit'));--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_priority_allowed" CHECK ("work_item"."priority" in ('low', 'medium', 'high', 'urgent'));--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_customer_visibility_allowed" CHECK ("work_item"."customer_visibility" in ('private', 'organisation'));--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_position_not_nan" CHECK ("work_item"."position" <> 'NaN'::numeric);--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_number_positive" CHECK ("work_item"."number" > 0);--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_category_allowed" CHECK ("work_item_type"."category" in ('service', 'delivery'));