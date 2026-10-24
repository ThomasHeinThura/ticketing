-- P4 AM-1..AM-13: automation rules and their run log. Additive; no backfill. New rules are created
-- disabled by the application (AM-10); the column default is false as well.
CREATE TABLE "automation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"project_filter" jsonb,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"trigger" text NOT NULL,
	"schedule_cron" text,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_role_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"stop_processing" boolean DEFAULT false NOT NULL,
	"flagged_reason" text,
	"fire_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_name_length" CHECK ((char_length(name) >= 1) AND (char_length(name) <= 120)),
	CONSTRAINT "automation_trigger_length" CHECK ((char_length(trigger) >= 1) AND (char_length(trigger) <= 64)),
	CONSTRAINT "automation_schedule_cron_matches_trigger" CHECK (((trigger = 'schedule'::text)) = ((schedule_cron IS NOT NULL))),
	CONSTRAINT "automation_position_nonnegative" CHECK (position >= 0),
	CONSTRAINT "automation_fire_count_nonnegative" CHECK (fire_count >= 0),
	CONSTRAINT "automation_version_positive" CHECK (version >= 1),
	CONSTRAINT "automation_conditions_array" CHECK (jsonb_typeof(conditions) = 'array'::text),
	CONSTRAINT "automation_actions_array" CHECK (jsonb_typeof(actions) = 'array'::text)
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"work_item_id" text,
	"work_item_key" text,
	"project_id" text,
	"event_id" text,
	"origin" text DEFAULT 'event' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"matched" boolean,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"lease_expires_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "automation_run_state_allowed" CHECK (state = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'skipped'::text, 'abandoned'::text])),
	CONSTRAINT "automation_run_origin_allowed" CHECK (origin = ANY (ARRAY['event'::text, 'schedule'::text])),
	CONSTRAINT "automation_run_depth_nonnegative" CHECK (depth >= 0)
);
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_effective_role_id_role_id_fk" FOREIGN KEY ("effective_role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workspace_id_project_id_project_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "automation_workspace_position_idx" ON "automation" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "automation_project_idx" ON "automation" USING btree ("project_id") WHERE (project_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "automation_enabled_trigger_idx" ON "automation" USING btree ("workspace_id","trigger") WHERE (enabled);--> statement-breakpoint
CREATE INDEX "automation_effective_role_idx" ON "automation" USING btree ("effective_role_id");--> statement-breakpoint
CREATE INDEX "automation_run_automation_triggered_idx" ON "automation_run" USING btree ("automation_id","triggered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "automation_run_pending_idx" ON "automation_run" USING btree ("triggered_at") WHERE (state = 'pending'::text);--> statement-breakpoint
CREATE INDEX "automation_run_event_idx" ON "automation_run" USING btree ("event_id") WHERE (event_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "automation_run_triggered_at_idx" ON "automation_run" USING btree ("triggered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_event_unique" ON "automation_run" USING btree ("automation_id","event_id") WHERE (event_id IS NOT NULL);
