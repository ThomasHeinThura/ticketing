-- 0152_p5_reports_dashboards: RP-13..RP-16 (saved dashboards and their widgets).
-- Additive and hand-written. Both tables are new, so every foreign key is validated against empty
-- tables. No existing row is touched and no data is deleted. `metric_snapshot` (RP-9) is not part of
-- this migration: every period is computed live (the report states it).
CREATE TABLE IF NOT EXISTS "dashboard" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "dashboard_scope_allowed" CHECK ("dashboard"."scope" IN ('personal', 'workspace')),
	CONSTRAINT "dashboard_scope_owner" CHECK (("dashboard"."scope" = 'personal') = ("dashboard"."owner_id" IS NOT NULL)),
	CONSTRAINT "dashboard_default_workspace_only" CHECK (NOT "dashboard"."is_default" OR "dashboard"."scope" = 'workspace'),
	CONSTRAINT "dashboard_name_length" CHECK (char_length(btrim("dashboard"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "dashboard_version_positive" CHECK ("dashboard"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_widget" (
	"id" text PRIMARY KEY NOT NULL,
	"dashboard_id" text NOT NULL,
	"report_key" text,
	"saved_view_id" text,
	"chart_type" text DEFAULT 'bar' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"x" integer DEFAULT 0 NOT NULL,
	"y" integer DEFAULT 0 NOT NULL,
	"w" integer DEFAULT 6 NOT NULL,
	"h" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_widget_source" CHECK (("dashboard_widget"."report_key" IS NOT NULL) <> ("dashboard_widget"."saved_view_id" IS NOT NULL)),
	CONSTRAINT "dashboard_widget_chart_type_allowed" CHECK ("dashboard_widget"."chart_type" IN ('bar', 'line', 'table', 'number')),
	CONSTRAINT "dashboard_widget_grid_range" CHECK ("dashboard_widget"."x" BETWEEN 0 AND 11 AND "dashboard_widget"."y" BETWEEN 0 AND 999 AND "dashboard_widget"."w" BETWEEN 1 AND 12 AND "dashboard_widget"."h" BETWEEN 1 AND 12 AND "dashboard_widget"."x" + "dashboard_widget"."w" <= 12)
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_workspace_fk') THEN
    ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_owner_fk') THEN
    ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_widget_dashboard_fk') THEN
    ALTER TABLE "dashboard_widget" ADD CONSTRAINT "dashboard_widget_dashboard_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboard"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_widget_saved_view_fk') THEN
    ALTER TABLE "dashboard_widget" ADD CONSTRAINT "dashboard_widget_saved_view_fk" FOREIGN KEY ("saved_view_id") REFERENCES "public"."saved_view"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_scope_name_unique" ON "dashboard" ("workspace_id", COALESCE("owner_id", ''), lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_one_default_per_workspace" ON "dashboard" ("workspace_id") WHERE "is_default";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_owner_idx" ON "dashboard" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_widget_dashboard_idx" ON "dashboard_widget" ("dashboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_widget_saved_view_idx" ON "dashboard_widget" ("saved_view_id");
