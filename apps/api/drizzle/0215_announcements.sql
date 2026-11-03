-- 0215_announcements: customer announcements (D7, approved by Thomas on 31 Oct 2026).
-- Hand-written and idempotent.
--
-- * `announcement`: a staff-written notice (title, plain-text body, severity info | maintenance |
--   incident) shown in the customer portal. A draft has `published_at` null. The portal shows a
--   published, not-deleted row while `starts_at <= now()` and (`ends_at` is null or later).
-- * Audience: `workspace` (every customer organisation with a live project in the workspace),
--   `organisations` (rows in `announcement_organisation`) or `projects` (rows in
--   `announcement_project`; the projects' customer organisations).
-- * Tenant safety: the join tables reference `announcement (workspace_id, id)`, and a targeted
--   project is referenced as `project (workspace_id, id)`, so a join row can never point at a
--   project of another workspace. ON UPDATE stays NO ACTION on every composite key.
-- * Deletion is soft (`deleted_at`), through a click-confirmed pending action.
CREATE TABLE IF NOT EXISTS "announcement" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"severity" text NOT NULL,
	"audience" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "announcement_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "announcement_severity_check" CHECK ("announcement"."severity" IN ('info', 'maintenance', 'incident')),
	CONSTRAINT "announcement_audience_check" CHECK ("announcement"."audience" IN ('workspace', 'organisations', 'projects')),
	CONSTRAINT "announcement_title_check" CHECK (char_length("announcement"."title") BETWEEN 1 AND 200),
	CONSTRAINT "announcement_body_check" CHECK (char_length("announcement"."body") <= 20000),
	CONSTRAINT "announcement_window_check" CHECK ("announcement"."ends_at" IS NULL OR "announcement"."ends_at" > "announcement"."starts_at")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcement_organisation" (
	"workspace_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	CONSTRAINT "announcement_organisation_pk" PRIMARY KEY("announcement_id","organisation_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcement_project" (
	"workspace_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "announcement_project_pk" PRIMARY KEY("announcement_id","project_id")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcement" ADD CONSTRAINT "announcement_workspace_id_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcement" ADD CONSTRAINT "announcement_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcement" ADD CONSTRAINT "announcement_updated_by_user_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcement_organisation" ADD CONSTRAINT "announcement_organisation_announcement_fk"
    FOREIGN KEY ("workspace_id","announcement_id") REFERENCES "public"."announcement"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcement_organisation" ADD CONSTRAINT "announcement_organisation_organisation_id_organisation_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcement_project" ADD CONSTRAINT "announcement_project_announcement_fk"
    FOREIGN KEY ("workspace_id","announcement_id") REFERENCES "public"."announcement"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcement_project" ADD CONSTRAINT "announcement_project_project_fk"
    FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_workspace_starts_idx" ON "announcement" USING btree ("workspace_id","starts_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_organisation_org_idx" ON "announcement_organisation" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_project_project_idx" ON "announcement_project" USING btree ("project_id");
