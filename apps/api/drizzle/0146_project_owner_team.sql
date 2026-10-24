-- TM-4: `project.owner_team_id` is reach step 5 (permissions.md): every active member of the
-- owning team reaches the project. Reach only, never a capability. Nullable and additive; the
-- team must live in the project's workspace (composite FK on the existing
-- `team_workspace_id_id_unique`). NO ACTION, not RESTRICT: a team that owns a project still
-- cannot be row-deleted (checked at statement end; TM-7 refuses first with a clean 409), but a
-- workspace deletion that cascades to both the team and its projects in one statement passes. Written ONLY by
-- `PATCH /api/projects/{id}/ownership`, never by the general settings route.
ALTER TABLE "project" ADD COLUMN "owner_team_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_owner_team_fk" FOREIGN KEY ("workspace_id","owner_team_id") REFERENCES "public"."team"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_owner_team_idx" ON "project" USING btree ("owner_team_id") WHERE "project"."owner_team_id" IS NOT NULL;
