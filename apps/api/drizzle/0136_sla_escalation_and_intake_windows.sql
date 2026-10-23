-- P2: SLA-17 escalation walk table, IQ-15 clarification window + auto-decline marker, WF-21/CP-8
-- reopen window. All additive; the new NOT NULL columns carry defaults, so no backfill is needed
-- except `submission.clarifying_since`, seeded with the deploy time for rows currently clarifying:
-- seeding from `updated_at` would auto-decline every legacy clarifying request older than the
-- window on the first scan after deploy, so each legacy period gets a full fresh window.
CREATE TABLE "sla_escalation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"metric" text NOT NULL,
	"trigger_event_id" text NOT NULL,
	"state_id_at_start" text NOT NULL,
	"assignee_id_at_start" text,
	"last_order" integer NOT NULL,
	"next_due_at" timestamp with time zone,
	"state" text DEFAULT 'active' NOT NULL,
	"stop_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_escalation_item_metric_trigger_unique" UNIQUE("work_item_id","metric","trigger_event_id"),
	CONSTRAINT "sla_escalation_metric_allowed" CHECK (metric = ANY (ARRAY['first_response'::text, 'resolution'::text])),
	CONSTRAINT "sla_escalation_state_allowed" CHECK (state = ANY (ARRAY['active'::text, 'completed'::text, 'stopped'::text])),
	CONSTRAINT "sla_escalation_active_has_due" CHECK ((state <> 'active'::text) OR (next_due_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "clarification_window_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "reopen_window_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "clarifying_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "auto_declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sla_escalation" ADD CONSTRAINT "sla_escalation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sla_escalation" ADD CONSTRAINT "sla_escalation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sla_escalation" ADD CONSTRAINT "sla_escalation_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "sla_escalation_due_idx" ON "sla_escalation" USING btree ("next_due_at") WHERE (state = 'active'::text);--> statement-breakpoint
CREATE INDEX "submission_clarifying_since_idx" ON "submission" USING btree ("clarifying_since") WHERE (state = 'clarifying'::text);--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_clarification_window_days_positive" CHECK (clarification_window_days >= 1);--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_reopen_window_days_positive" CHECK (reopen_window_days >= 1);--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_auto_declined_state_consistent" CHECK ((auto_declined_at IS NULL) OR (state = 'declined'::text));
--> statement-breakpoint
UPDATE "submission" SET "clarifying_since" = now() WHERE "state" = 'clarifying' AND "clarifying_since" IS NULL;
