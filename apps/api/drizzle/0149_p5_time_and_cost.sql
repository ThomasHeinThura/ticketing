-- 0149_p5_time_and_cost: canonical work-item time tracking (feature-contracts-p5.md, "Time and cost";
-- data-model.md section 9). Hand-written and idempotent: every statement is guarded so a re-run on a
-- populated database changes nothing and never drops or rewrites existing rows.
--
-- 1. The legacy Kaneo `time_entry` table (task_id/user_id, start/end, seconds) is renamed
--    `task_time_entry`, the 0066 `task_activity` precedent (owner decision 23 Oct, P5: "rename old
--    time table to `task_time_entry`"). Postgres tracks foreign keys by table OID, so nothing that
--    points at the table needs repair. The table's own indexes, primary key and NOT NULL
--    constraints keep their `time_entry_*` names after a plain RENAME, which would make the new
--    table's auto-named objects collide (`time_entry_pkey1`), so every `time_entry_*` object on the
--    renamed table is renamed too. The loops enumerate the live catalogue, so they cover Postgres
--    18's named NOT NULL constraints and are a no-op where those do not exist.
-- 2. The canonical `time_entry` is created: a person's integer minutes on a date against a work
--    item, with a required activity, a billable flag and the hourly rate snapshotted at creation
--    (owner decision D4, 20 Oct: rates are captured when an entry is created or a timer stops, so
--    a later rate change never rewrites the cost of work already done).
-- 3. `running_timer` (one per person), `time_activity`, `hourly_rate` and `budget`.
-- 4. `workspace.time_entry_backdate_limit_days` (TC-4) and `project.default_billable` (TC-3): new
--    columns with constant defaults on populated tables, so no row is rewritten; the new CHECK is
--    NOT VALID.
--
-- `time_entry.work_item_id` is nullable with ON DELETE SET NULL: time logged against a work item
-- that is later deleted is retained against its project and flagged in reporting (edge case table).
-- `project_id` is therefore stored on the row. Every other reference cascades from the tenant, so a
-- workspace or organisation delete is never blocked by logged time (the 0066 RESTRICT lesson).

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.task_time_entry') IS NULL
     AND to_regclass('public.time_entry') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'time_entry' AND column_name = 'task_id'
     ) THEN
    ALTER TABLE "time_entry" RENAME TO "task_time_entry";
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.task_time_entry'::regclass AND conname LIKE 'time\_entry\_%'
    LOOP
      EXECUTE format('ALTER TABLE "task_time_entry" RENAME CONSTRAINT %I TO %I', r.conname, 'task_' || r.conname);
    END LOOP;
    FOR r IN
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'task_time_entry' AND indexname LIKE 'time\_entry\_%'
    LOOP
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'task_' || r.indexname);
    END LOOP;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "time_entry_backdate_limit_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_time_entry_backdate_limit_days_check') THEN
    ALTER TABLE "workspace" ADD CONSTRAINT "workspace_time_entry_backdate_limit_days_check"
      CHECK ("time_entry_backdate_limit_days" >= 0 AND "time_entry_backdate_limit_days" <= 3650) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "default_billable" boolean DEFAULT true NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "time_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_activity_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "time_activity_workspace_name_unique" UNIQUE("workspace_id","name"),
	CONSTRAINT "time_activity_name_not_blank" CHECK (btrim("name") <> '')
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_activity_workspace_fk') THEN
    ALTER TABLE "time_activity" ADD CONSTRAINT "time_activity_workspace_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
END $$;--> statement-breakpoint

-- TC-2: the four activity types the contract names, for every existing workspace. Insert-only.
INSERT INTO "time_activity" ("id", "workspace_id", "name", "position")
SELECT gen_random_uuid()::text, w."id", a."name", a."position"
FROM "workspace" w
CROSS JOIN (VALUES ('Development', 0), ('Support', 1), ('Meeting', 2), ('Travel', 3)) AS a("name", "position")
ON CONFLICT ("workspace_id", "name") DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "time_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text,
	"person_id" text NOT NULL,
	"date" date NOT NULL,
	"minutes" integer NOT NULL,
	"activity_id" text NOT NULL,
	"description" text,
	"billable" boolean NOT NULL,
	"rate_minor" bigint,
	"currency" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entry_minutes_range" CHECK ("minutes" > 0 AND "minutes" <= 1440),
	CONSTRAINT "time_entry_rate_pair" CHECK (("rate_minor" IS NULL) = ("currency" IS NULL)),
	CONSTRAINT "time_entry_rate_nonnegative" CHECK ("rate_minor" IS NULL OR "rate_minor" >= 0),
	CONSTRAINT "time_entry_source_allowed" CHECK ("source" IN ('manual', 'timer', 'timer_capped'))
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entry_workspace_project_fk') THEN
    ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_workspace_project_fk"
      FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entry_work_item_fk') THEN
    ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_work_item_fk"
      FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entry_person_fk') THEN
    ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_person_fk"
      FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entry_workspace_activity_fk') THEN
    ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_workspace_activity_fk"
      FOREIGN KEY ("workspace_id","activity_id") REFERENCES "public"."time_activity"("workspace_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_person_id_date_idx" ON "time_entry" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_work_item_id_idx" ON "time_entry" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_project_id_date_idx" ON "time_entry" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_workspace_id_date_idx" ON "time_entry" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_activity_id_idx" ON "time_entry" USING btree ("activity_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "running_timer" (
	"person_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"description" text,
	"billable" boolean NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'running_timer_person_fk') THEN
    ALTER TABLE "running_timer" ADD CONSTRAINT "running_timer_person_fk"
      FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'running_timer_workspace_project_fk') THEN
    ALTER TABLE "running_timer" ADD CONSTRAINT "running_timer_workspace_project_fk"
      FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'running_timer_work_item_fk') THEN
    ALTER TABLE "running_timer" ADD CONSTRAINT "running_timer_work_item_fk"
      FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'running_timer_workspace_activity_fk') THEN
    ALTER TABLE "running_timer" ADD CONSTRAINT "running_timer_workspace_activity_fk"
      FOREIGN KEY ("workspace_id","activity_id") REFERENCES "public"."time_activity"("workspace_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "running_timer_started_at_idx" ON "running_timer" USING btree ("started_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hourly_rate" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"person_id" text NOT NULL,
	"project_id" text,
	"rate_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hourly_rate_rate_nonnegative" CHECK ("rate_minor" >= 0),
	CONSTRAINT "hourly_rate_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hourly_rate_workspace_fk') THEN
    ALTER TABLE "hourly_rate" ADD CONSTRAINT "hourly_rate_workspace_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hourly_rate_person_fk') THEN
    ALTER TABLE "hourly_rate" ADD CONSTRAINT "hourly_rate_person_fk"
      FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hourly_rate_workspace_project_fk') THEN
    ALTER TABLE "hourly_rate" ADD CONSTRAINT "hourly_rate_workspace_project_fk"
      FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
-- TC-8/TC-10: one rate per (person, project, effective date); the project-less row is the person's default.
CREATE UNIQUE INDEX IF NOT EXISTS "hourly_rate_person_project_effective_unique" ON "hourly_rate" USING btree ("person_id","project_id","effective_from") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hourly_rate_person_default_effective_unique" ON "hourly_rate" USING btree ("person_id","effective_from") WHERE "project_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hourly_rate_workspace_id_idx" ON "hourly_rate" USING btree ("workspace_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "budget" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"planned_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_planned_nonnegative" CHECK ("planned_amount_minor" >= 0),
	CONSTRAINT "budget_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "budget_period_order" CHECK ("period_end" >= "period_start"),
	CONSTRAINT "budget_name_not_blank" CHECK (btrim("name") <> '')
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_workspace_project_fk') THEN
    ALTER TABLE "budget" ADD CONSTRAINT "budget_workspace_project_fk"
      FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_project_id_idx" ON "budget" USING btree ("project_id");
