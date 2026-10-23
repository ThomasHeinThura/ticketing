-- P1 projects: hierarchy parent (PR-1), manager (PR-6), start/end dates (PR-10) and the
-- project default assignee (AS-11). All nullable and additive: existing rows keep working
-- (no parent, no manager, no dates, no default assignee) and no backfill is attempted.
-- Depth <= 4 and cycle prevention are enforced by the ownership write path under a workspace
-- advisory lock; no CHECK can see ancestors. `owner_team_id` is deliberately NOT added here:
-- reach step 5 (owner-team reach) has no resolver yet, so a settable column would grant
-- nothing and mislead.
ALTER TABLE "project" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "manager_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "default_assignee_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_manager_id_person_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_default_assignee_id_person_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_workspace_parent_idx" ON "project" USING btree ("workspace_id","parent_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_parent_not_self" CHECK ((parent_id IS NULL) OR (parent_id <> id));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_dates_ordered" CHECK ((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date));