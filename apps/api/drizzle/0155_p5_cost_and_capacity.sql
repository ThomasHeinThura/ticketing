-- 0155_p5_cost_and_capacity: cost types and cost entries (TC-12..TC-14), per-person available hours
-- (TC-20) and the budget threshold notice marker (TC-18). Hand-written and idempotent: every
-- statement is guarded, only new tables are created, no existing row is rewritten or deleted.
--
-- 1. `cost_type`: a workspace-level catalogue entry (name, unit label, optional default rate in minor
--    units, currency, billable flag). Archived, never deleted, so logged cost keeps its type.
-- 2. `cost_entry`: units against a cost type on a date, on a project and optionally a work item
--    (nulled when the item is deleted, the row stays on its project, like `time_entry`). The rate is
--    captured on the row (TC-13) and `amount_minor = units * rate_minor` is enforced by a CHECK, so a
--    later rate change never rewrites it. Tenant isolation: composite (workspace_id, ...) foreign keys
--    to the project and to the cost type.
-- 3. `available_hours`: a person's capacity in integer minutes per week from an effective date
--    (append-only history; the latest row on or before a day applies).
-- 4. `budget_threshold_notice`: one row per (budget, 75|90) so a threshold notifies the project
--    manager once; the insert is the idempotency gate.

CREATE TABLE IF NOT EXISTS "cost_type" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'unit' NOT NULL,
	"default_rate_minor" bigint,
	"currency" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_type_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "cost_type_workspace_name_unique" UNIQUE("workspace_id","name"),
	CONSTRAINT "cost_type_name_not_blank" CHECK (btrim("name") <> ''),
	CONSTRAINT "cost_type_unit_not_blank" CHECK (btrim("unit") <> ''),
	CONSTRAINT "cost_type_rate_nonnegative" CHECK ("default_rate_minor" IS NULL OR "default_rate_minor" >= 0),
	CONSTRAINT "cost_type_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_type_workspace_fk') THEN
    ALTER TABLE "cost_type" ADD CONSTRAINT "cost_type_workspace_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cost_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text,
	"cost_type_id" text NOT NULL,
	"person_id" text NOT NULL,
	"date" date NOT NULL,
	"units" integer NOT NULL,
	"rate_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"billable" boolean NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_entry_units_range" CHECK ("units" > 0 AND "units" <= 1000000),
	CONSTRAINT "cost_entry_rate_nonnegative" CHECK ("rate_minor" >= 0),
	CONSTRAINT "cost_entry_amount_matches" CHECK ("amount_minor" = "units"::bigint * "rate_minor"),
	CONSTRAINT "cost_entry_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_entry_workspace_project_fk') THEN
    ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_workspace_project_fk"
      FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_entry_work_item_fk') THEN
    ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_work_item_fk"
      FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_entry_person_fk') THEN
    ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_person_fk"
      FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_entry_workspace_cost_type_fk') THEN
    ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_workspace_cost_type_fk"
      FOREIGN KEY ("workspace_id","cost_type_id") REFERENCES "public"."cost_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_entry_project_id_date_idx" ON "cost_entry" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_entry_work_item_id_idx" ON "cost_entry" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_entry_person_id_idx" ON "cost_entry" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_entry_cost_type_id_idx" ON "cost_entry" USING btree ("cost_type_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_entry_workspace_id_date_idx" ON "cost_entry" USING btree ("workspace_id","date");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "available_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"person_id" text NOT NULL,
	"minutes_per_week" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "available_hours_person_effective_unique" UNIQUE("workspace_id","person_id","effective_from"),
	CONSTRAINT "available_hours_minutes_range" CHECK ("minutes_per_week" >= 0 AND "minutes_per_week" <= 10080)
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'available_hours_workspace_fk') THEN
    ALTER TABLE "available_hours" ADD CONSTRAINT "available_hours_workspace_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'available_hours_person_fk') THEN
    ALTER TABLE "available_hours" ADD CONSTRAINT "available_hours_person_fk"
      FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "available_hours_person_id_idx" ON "available_hours" USING btree ("person_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "budget_threshold_notice" (
	"budget_id" text NOT NULL,
	"threshold" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_threshold_notice_pk" PRIMARY KEY("budget_id","threshold"),
	CONSTRAINT "budget_threshold_notice_threshold_allowed" CHECK ("threshold" IN (75, 90))
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_threshold_notice_budget_fk') THEN
    ALTER TABLE "budget_threshold_notice" ADD CONSTRAINT "budget_threshold_notice_budget_fk"
      FOREIGN KEY ("budget_id") REFERENCES "public"."budget"("id") ON DELETE cascade ON UPDATE cascade;
  END IF;
END $$;
