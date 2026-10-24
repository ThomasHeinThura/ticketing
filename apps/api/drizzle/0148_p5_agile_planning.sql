-- 0148_p5_agile_planning: cycles, modules and estimates (feature-contracts-p5.md, "Cycles, modules
-- and estimates"; data-model.md §8). Hand-written and idempotent: every statement is guarded so a
-- re-run on a populated database changes nothing and never drops or rewrites existing rows.
--
-- CY-8: `cycle_scope_event` is the append-only scope log. `rolled_over` records an incomplete item
-- leaving a cycle at completion: it stays part of that cycle's history (so a completed cycle's
-- burndown records the unfinished scope honestly) but no longer points at it.
-- CY-9: `cycle_snapshot` holds the frozen completion summary velocity reads; `summary` is the
-- full CycleSummary at completion. The daily snapshot job is not built.
-- CY-3: a cycle's `upcoming`/`active`/`completed` status is NOT stored. Only `completed_at` (the
-- completion action) is, and the status is derived from it plus the dates, so it cannot be set by
-- hand. The overlap rule (CY-2) is enforced by the application under a project row lock, not by a
-- btree_gist exclusion constraint (no extension is added).
CREATE TABLE IF NOT EXISTS "cycle" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "cycle_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "cycle_dates_ordered" CHECK ("cycle"."end_date" >= "cycle"."start_date"),
	CONSTRAINT "cycle_version_positive" CHECK ("cycle"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_scope_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"after_start" boolean DEFAULT false NOT NULL,
	"retrospective" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cycle_scope_event_kind_allowed" CHECK ("cycle_scope_event"."kind" IN ('added', 'removed', 'rolled_over'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_snapshot" (
	"cycle_id" text NOT NULL,
	"date" date NOT NULL,
	"unit" text NOT NULL,
	"scope_points" numeric(14, 2) DEFAULT '0' NOT NULL,
	"completed_points" numeric(14, 2) DEFAULT '0' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"unestimated_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_snapshot_cycle_id_date_pk" PRIMARY KEY("cycle_id","date"),
	CONSTRAINT "cycle_snapshot_unit_allowed" CHECK ("cycle_snapshot"."unit" IN ('points', 'time', 'count'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lead_id" text,
	"state" text DEFAULT 'planned' NOT NULL,
	"target_date" date,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "module_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "module_state_allowed" CHECK ("module"."state" IN ('backlog', 'planned', 'in_progress', 'paused', 'completed', 'cancelled')),
	CONSTRAINT "module_version_positive" CHECK ("module"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estimate" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"system" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "estimate_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "estimate_system_allowed" CHECK ("estimate"."system" IN ('points', 'categories', 'time'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estimate_point" (
	"id" text PRIMARY KEY NOT NULL,
	"estimate_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"weight" numeric(14, 2),
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "estimate_point_estimate_id_key_unique" UNIQUE("estimate_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estimate_change" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_system" text,
	"to_system" text,
	"mapped_count" integer DEFAULT 0 NOT NULL,
	"cleared_count" integer DEFAULT 0 NOT NULL,
	"actor_id" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_change_kind_allowed" CHECK ("estimate_change"."kind" IN ('system', 'scale'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_agile_setting" (
	"project_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"cycle_incomplete_policy" text DEFAULT 'backlog' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_agile_setting_policy_allowed" CHECK ("project_agile_setting"."cycle_incomplete_policy" IN ('next_cycle', 'backlog', 'leave'))
);
--> statement-breakpoint
-- VW-12: an optional work-in-progress limit per board column (a column is a project state). Kept
-- in its own table so the shared `state` table is untouched; no row means no limit.
CREATE TABLE IF NOT EXISTS "state_wip_limit" (
	"state_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"wip_limit" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "state_wip_limit_range" CHECK ("state_wip_limit"."wip_limit" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cycle_workspace_project_fk') THEN
    ALTER TABLE "cycle" ADD CONSTRAINT "cycle_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_workspace_project_fk') THEN
    ALTER TABLE "module" ADD CONSTRAINT "module_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_lead_id_person_id_fk') THEN
    ALTER TABLE "module" ADD CONSTRAINT "module_lead_id_person_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_workspace_project_fk') THEN
    ALTER TABLE "estimate" ADD CONSTRAINT "estimate_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_point_estimate_id_estimate_id_fk') THEN
    ALTER TABLE "estimate_point" ADD CONSTRAINT "estimate_point_estimate_id_estimate_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimate"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_change_workspace_project_fk') THEN
    ALTER TABLE "estimate_change" ADD CONSTRAINT "estimate_change_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_agile_setting_workspace_project_fk') THEN
    ALTER TABLE "project_agile_setting" ADD CONSTRAINT "project_agile_setting_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cycle_scope_event_cycle_id_cycle_id_fk') THEN
    ALTER TABLE "cycle_scope_event" ADD CONSTRAINT "cycle_scope_event_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cycle_scope_event_work_item_id_work_item_id_fk') THEN
    ALTER TABLE "cycle_scope_event" ADD CONSTRAINT "cycle_scope_event_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cycle_snapshot_cycle_id_cycle_id_fk') THEN
    ALTER TABLE "cycle_snapshot" ADD CONSTRAINT "cycle_snapshot_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'state_wip_limit_project_state_fk') THEN
    ALTER TABLE "state_wip_limit" ADD CONSTRAINT "state_wip_limit_project_state_fk" FOREIGN KEY ("project_id","state_id") REFERENCES "public"."state"("project_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
-- A work item can only point at a cycle or module of its OWN project (CY-4, MO-2), and at an
-- estimate point (ES-2). Composite and NO ACTION on delete (a SET NULL on the composite key would
-- null `project_id`): the deletion executors clear the pointer first. NOT VALID so existing
-- populated rows are not scanned or rejected; new and updated rows are checked.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_item_project_cycle_fk') THEN
    ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_cycle_fk" FOREIGN KEY ("project_id","cycle_id") REFERENCES "public"."cycle"("project_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_item_project_module_fk') THEN
    ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_module_fk" FOREIGN KEY ("project_id","module_id") REFERENCES "public"."module"("project_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_item_estimate_point_fk') THEN
    ALTER TABLE "work_item" ADD CONSTRAINT "work_item_estimate_point_fk" FOREIGN KEY ("estimate_point_id") REFERENCES "public"."estimate_point"("id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- At most one active estimate system per project (ES-1).
CREATE UNIQUE INDEX IF NOT EXISTS "estimate_project_active_unique" ON "estimate" USING btree ("project_id") WHERE "estimate"."active";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_project_start_idx" ON "cycle" USING btree ("project_id","start_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_scope_event_cycle_at_idx" ON "cycle_scope_event" USING btree ("cycle_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_scope_event_work_item_idx" ON "cycle_scope_event" USING btree ("work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_project_idx" ON "module" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "estimate_point_estimate_position_idx" ON "estimate_point" USING btree ("estimate_id","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "estimate_change_project_idx" ON "estimate_change" USING btree ("project_id","changed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_cycle_idx" ON "work_item" USING btree ("cycle_id") WHERE "work_item"."cycle_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_module_idx" ON "work_item" USING btree ("module_id") WHERE "work_item"."module_id" IS NOT NULL;
