CREATE TABLE "instance_job_configuration" (
	"name" text PRIMARY KEY NOT NULL,
	"pattern" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_person_id" text,
	CONSTRAINT "instance_job_configuration_version_positive" CHECK ("instance_job_configuration"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "instance_job_run" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"state" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"runner_id" text,
	"run_lease_expires_at" timestamp with time zone,
	"actor_person_id" text,
	"error_code" text,
	"duration_ms" integer,
	CONSTRAINT "instance_job_run_trigger_allowed" CHECK ("instance_job_run"."trigger" IN ('scheduled', 'manual')),
	CONSTRAINT "instance_job_run_state_allowed" CHECK ("instance_job_run"."state" IN ('queued', 'running', 'succeeded', 'failed', 'lease_lost')),
	CONSTRAINT "instance_job_run_error_code_allowed" CHECK ("instance_job_run"."error_code" IS NULL OR "instance_job_run"."error_code" IN ('handler_failed', 'authorization_lost', 'lease_lost')),
	CONSTRAINT "instance_job_run_duration_nonnegative" CHECK ("instance_job_run"."duration_ms" IS NULL OR "instance_job_run"."duration_ms" >= 0),
	CONSTRAINT "instance_job_run_lease_after_heartbeat" CHECK ("instance_job_run"."run_lease_expires_at" IS NULL OR ("instance_job_run"."heartbeat_at" IS NOT NULL AND "instance_job_run"."run_lease_expires_at" > "instance_job_run"."heartbeat_at")),
	CONSTRAINT "instance_job_run_time_order" CHECK (("instance_job_run"."started_at" IS NULL OR "instance_job_run"."requested_at" <= "instance_job_run"."started_at")
        AND ("instance_job_run"."heartbeat_at" IS NULL OR ("instance_job_run"."started_at" IS NOT NULL AND "instance_job_run"."started_at" <= "instance_job_run"."heartbeat_at"))
        AND ("instance_job_run"."finished_at" IS NULL OR ("instance_job_run"."started_at" IS NOT NULL AND "instance_job_run"."started_at" <= "instance_job_run"."finished_at"))
        AND ("instance_job_run"."finished_at" IS NULL OR "instance_job_run"."heartbeat_at" IS NULL OR "instance_job_run"."heartbeat_at" <= "instance_job_run"."finished_at")),
	CONSTRAINT "instance_job_run_lifecycle_fields" CHECK ((
        ("instance_job_run"."state" = 'queued' AND "instance_job_run"."trigger" = 'manual'
          AND "instance_job_run"."started_at" IS NULL AND "instance_job_run"."heartbeat_at" IS NULL
          AND "instance_job_run"."finished_at" IS NULL AND "instance_job_run"."runner_id" IS NULL
          AND "instance_job_run"."run_lease_expires_at" IS NULL AND "instance_job_run"."error_code" IS NULL
          AND "instance_job_run"."duration_ms" IS NULL)
        OR
        ("instance_job_run"."state" = 'running' AND "instance_job_run"."started_at" IS NOT NULL
          AND "instance_job_run"."heartbeat_at" IS NOT NULL AND "instance_job_run"."finished_at" IS NULL
          AND "instance_job_run"."runner_id" IS NOT NULL AND "instance_job_run"."run_lease_expires_at" IS NOT NULL
          AND "instance_job_run"."error_code" IS NULL AND "instance_job_run"."duration_ms" IS NULL)
        OR
        ("instance_job_run"."state" = 'succeeded' AND "instance_job_run"."started_at" IS NOT NULL
          AND "instance_job_run"."heartbeat_at" IS NOT NULL AND "instance_job_run"."finished_at" IS NOT NULL
          AND "instance_job_run"."runner_id" IS NULL AND "instance_job_run"."run_lease_expires_at" IS NULL
          AND "instance_job_run"."error_code" IS NULL AND "instance_job_run"."duration_ms" IS NOT NULL)
        OR
        ("instance_job_run"."state" = 'failed' AND "instance_job_run"."started_at" IS NOT NULL
          AND "instance_job_run"."heartbeat_at" IS NOT NULL AND "instance_job_run"."finished_at" IS NOT NULL
          AND "instance_job_run"."runner_id" IS NULL AND "instance_job_run"."run_lease_expires_at" IS NULL
          AND "instance_job_run"."error_code" IS NOT NULL
          AND "instance_job_run"."error_code" IN ('handler_failed', 'authorization_lost')
          AND "instance_job_run"."duration_ms" IS NOT NULL)
        OR
        ("instance_job_run"."state" = 'lease_lost' AND "instance_job_run"."started_at" IS NOT NULL
          AND "instance_job_run"."finished_at" IS NOT NULL AND "instance_job_run"."runner_id" IS NULL
          AND "instance_job_run"."run_lease_expires_at" IS NULL AND "instance_job_run"."error_code" IS NOT NULL
          AND "instance_job_run"."error_code" = 'lease_lost'
          AND "instance_job_run"."duration_ms" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "instance_job_configuration" ADD CONSTRAINT "instance_job_configuration_updated_by_person_id_person_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "instance_job_run" ADD CONSTRAINT "instance_job_run_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "instance_job_run_one_active_manual_idx" ON "instance_job_run" USING btree ("name") WHERE "instance_job_run"."trigger" = 'manual' AND "instance_job_run"."state" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "instance_job_run_history_idx" ON "instance_job_run" USING btree ("name","requested_at");--> statement-breakpoint
CREATE INDEX "instance_job_run_terminal_retention_idx" ON "instance_job_run" USING btree ("requested_at") WHERE "instance_job_run"."state" IN ('succeeded', 'failed', 'lease_lost');