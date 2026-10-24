-- P4 teams (TM-3, TM-5): leads, capacity, one CAB team per workspace, one row per person per team.
ALTER TABLE "team" ADD COLUMN "capacity_days_per_week" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_capacity_days_per_week_range" CHECK ("team"."capacity_days_per_week" IS NULL OR ("team"."capacity_days_per_week" >= 0 AND "team"."capacity_days_per_week" <= 7));--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "is_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "allocation_pct" integer;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_allocation_pct_range" CHECK ("team_member"."allocation_pct" IS NULL OR ("team_member"."allocation_pct" >= 0 AND "team_member"."allocation_pct" <= 100));--> statement-breakpoint
-- Fail safe, never silently rewrite data: the unique indexes below need one row per person per team and
-- at most one CAB team per workspace. When live data violates either, REFUSE with the counts and the fix,
-- so an operator decides which rows and which CAB team to keep (CAB decision authority and pending CAB
-- approvals depend on it). Nothing is deleted or un-flagged by this migration.
DO $$
DECLARE
  duplicate_members integer;
  multi_cab_workspaces integer;
BEGIN
  SELECT count(*) INTO duplicate_members FROM (
    SELECT 1 FROM "team_member" GROUP BY "team_id", "user_id" HAVING count(*) > 1
  ) d;
  SELECT count(*) INTO multi_cab_workspaces FROM (
    SELECT 1 FROM "team" WHERE "is_cab" GROUP BY "workspace_id" HAVING count(*) > 1
  ) c;
  IF duplicate_members > 0 THEN
    RAISE EXCEPTION 'migration 0138: % team/person pair(s) have duplicate team_member rows; delete the extra rows (SELECT team_id, user_id, count(*) FROM team_member GROUP BY 1, 2 HAVING count(*) > 1) before migrating', duplicate_members;
  END IF;
  IF multi_cab_workspaces > 0 THEN
    RAISE EXCEPTION 'migration 0138: % workspace(s) have more than one CAB team; clear is_cab on all but one (SELECT workspace_id, id, name FROM team WHERE is_cab ORDER BY workspace_id, created_at) before migrating', multi_cab_workspaces;
  END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_team_user_unique" ON "team_member" USING btree ("team_id","user_id");--> statement-breakpoint
-- TM-5: one CAB team per workspace (the precheck above guarantees the data already satisfies it).
CREATE UNIQUE INDEX "team_workspace_cab_unique" ON "team" USING btree ("workspace_id") WHERE is_cab;
