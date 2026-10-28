-- 0156_p5_report_snapshots: RP-9 (metric_snapshot, day grain) and RP-10 (report_export, the queue and
-- the stored result of an asynchronous export).
-- Additive and hand-written. All three tables are new, so every foreign key is validated against empty
-- tables, and the statements are idempotent (IF NOT EXISTS / constraint guards). No existing row is
-- touched and no data is deleted.
--
-- metric_snapshot rows are aggregates (counts per project, day, priority and type): they hold no
-- person, rate or cost data, so legal holds do not apply to them. They are removed with their
-- workspace, project or organisation (the organisation hard-delete contract purges them).
CREATE TABLE IF NOT EXISTS "metric_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"grain" text DEFAULT 'day' NOT NULL,
	"metric_key" text NOT NULL,
	"project_id" text,
	"organisation_id" text,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshot_grain_allowed" CHECK ("metric_snapshot"."grain" IN ('day')),
	CONSTRAINT "metric_snapshot_period_order" CHECK ("metric_snapshot"."period_end" > "metric_snapshot"."period_start")
);
--> statement-breakpoint
-- One row per workspace and closed day that the job has computed: a day with no `metric_snapshot` row
-- is either a day with nothing to count or a day never computed, and only this marker tells them apart.
CREATE TABLE IF NOT EXISTS "metric_snapshot_day" (
	"workspace_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshot_day_workspace_id_period_start_pk" PRIMARY KEY("workspace_id","period_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_export" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"person_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"report_key" text,
	"title" text NOT NULL,
	"spec" jsonb NOT NULL,
	"caps" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rates_included" boolean DEFAULT false NOT NULL,
	"filename" text,
	"content" text,
	"row_count" integer,
	"byte_size" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"error" text,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	CONSTRAINT "report_export_kind_allowed" CHECK ("report_export"."kind" IN ('report', 'custom')),
	CONSTRAINT "report_export_status_allowed" CHECK ("report_export"."status" IN ('queued', 'running', 'ready', 'failed', 'expired')),
	CONSTRAINT "report_export_report_key" CHECK (("report_export"."kind" = 'report') = ("report_export"."report_key" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_snapshot_workspace_fk') THEN
    ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_snapshot_project_fk') THEN
    ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_snapshot_organisation_fk') THEN
    ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_organisation_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_snapshot_day_workspace_fk') THEN
    ALTER TABLE "metric_snapshot_day" ADD CONSTRAINT "metric_snapshot_day_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_export_workspace_fk') THEN
    ALTER TABLE "report_export" ADD CONSTRAINT "report_export_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_export_person_fk') THEN
    ALTER TABLE "report_export" ADD CONSTRAINT "report_export_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_export_user_fk') THEN
    ALTER TABLE "report_export" ADD CONSTRAINT "report_export_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
END $$;--> statement-breakpoint
-- The contract's key `(metric_key, grain, period_start, project_id, organisation_id, dimensions)` with
-- the workspace added; COALESCE makes the nullable columns part of the uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS "metric_snapshot_key_unique" ON "metric_snapshot" ("workspace_id", "metric_key", "grain", "period_start", COALESCE("project_id", ''), COALESCE("organisation_id", ''), "dimensions");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_snapshot_read_idx" ON "metric_snapshot" ("workspace_id", "metric_key", "grain", "period_start", "project_id", "organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_snapshot_project_idx" ON "metric_snapshot" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_snapshot_organisation_idx" ON "metric_snapshot" ("organisation_id") WHERE "organisation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_export_status_idx" ON "report_export" ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_export_person_idx" ON "report_export" ("person_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_export_workspace_idx" ON "report_export" ("workspace_id");
