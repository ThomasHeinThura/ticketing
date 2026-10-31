-- 0213_project_overview_contract: the project Overview (S3/S3b, decisions D1 and D2 approved by
-- Thomas on 31 Oct 2026). Hand-written and idempotent.
--
-- * Summary fields from feature-contracts-p1 "Engagement structure": objective, in scope, out of
--   scope, success criteria and a status note. `status_note_at` is set by the server whenever the
--   note changes (PATCH /api/project/{id}/summary); clients never write it.
-- * D1 lifecycle status: planning | active | on_hold | closed. Existing projects become `active`.
--   Status is information only; it does not archive, freeze or hide a project.
-- * D2 contract and hour bank: at most one `project_contract` row per project, deleted with the
--   project. "Hours used" is derived at read time from billable `time_entry` minutes on the
--   project dated inside [start_date, end_date]; nothing is stored redundantly.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "objective" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "in_scope" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "out_of_scope" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "success_criteria" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "status_note" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "status_note_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project" ADD CONSTRAINT "project_status_allowed"
    CHECK (status = ANY (ARRAY['planning'::text, 'active'::text, 'on_hold'::text, 'closed'::text]));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_contract" (
	"project_id" text PRIMARY KEY NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"contracted_minutes" integer NOT NULL,
	"coverage" text NOT NULL,
	"kickoff_status" text DEFAULT 'pending' NOT NULL,
	"kickoff_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_contract_dates_ordered" CHECK (end_date >= start_date),
	CONSTRAINT "project_contract_minutes_allowed" CHECK ((contracted_minutes > 0) AND (contracted_minutes <= 60000000)),
	CONSTRAINT "project_contract_coverage_allowed" CHECK (coverage = ANY (ARRAY['9x5'::text, '12x5'::text, '24x7'::text])),
	CONSTRAINT "project_contract_kickoff_status_allowed" CHECK (kickoff_status = ANY (ARRAY['pending'::text, 'scheduled'::text, 'completed'::text]))
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_contract" ADD CONSTRAINT "project_contract_project_id_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
