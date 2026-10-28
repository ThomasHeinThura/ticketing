-- 0196_p6_import_sources_and_runs: source connections and the import-engine columns on import_run.
-- Hand-written and idempotent (every statement can be re-run). Credentials are stored only as the
-- enc:v2 envelope produced by encryptSecret; this table never holds a plaintext secret.
CREATE TABLE IF NOT EXISTS "import_source_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ciphertext" text,
	"read_only" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_source_connection_scope_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "import_source_connection_name_key" UNIQUE("workspace_id","plugin_id","name"),
	CONSTRAINT "import_source_connection_plugin_allowed" CHECK ("plugin_id" IN ('import.csv','import.jira','import.jsm','import.azure-devops','import.plane','import.planner','import.power-apps','import.mcp')),
	CONSTRAINT "import_source_connection_read_only" CHECK ("read_only" = true),
	CONSTRAINT "import_source_connection_config_object" CHECK (jsonb_typeof("config") = 'object')
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_source_connection_workspace_id_workspace_id_fk') THEN
		ALTER TABLE "import_source_connection" ADD CONSTRAINT "import_source_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_source_connection_created_by_person_id_fk') THEN
		ALTER TABLE "import_source_connection" ADD CONSTRAINT "import_source_connection_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "source_connection_id" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "engine_phase" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "source_cursor" jsonb;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "paused_reason" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "approved_digest" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "approved_count" integer;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "approved_mapping_version" integer;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "approval_pending_action_id" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "engine_discovery" jsonb;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "engine_dry_run_digest" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "engine_dry_run_mapping_version" integer;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "engine_dry_run_report" jsonb;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "engine_dry_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_run" DROP CONSTRAINT IF EXISTS "import_run_plugin_allowed";--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_plugin_allowed" CHECK ("plugin_id" IN ('import.csv','import.jira','import.jsm','import.azure-devops','import.plane','import.planner','import.power-apps','import.mcp'));--> statement-breakpoint
ALTER TABLE "import_run" DROP CONSTRAINT IF EXISTS "import_run_engine_phase_allowed";--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_engine_phase_allowed" CHECK ("engine_phase" IS NULL OR "engine_phase" IN ('created','discovered','dry_run_ready','executing','completed'));--> statement-breakpoint
ALTER TABLE "import_run" DROP CONSTRAINT IF EXISTS "import_run_paused_reason_allowed";--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_paused_reason_allowed" CHECK ("paused_reason" IS NULL OR "paused_reason" IN ('operator','authority_lost','project_reach_lost','mapping_changed','approval_invalid','approved_count_exceeded','source_error','chunk_failed','conflict'));--> statement-breakpoint
ALTER TABLE "import_run" DROP CONSTRAINT IF EXISTS "import_run_engine_approval_shape";--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_engine_approval_shape" CHECK (("approved_digest" IS NULL) = ("approved_count" IS NULL) AND ("approved_digest" IS NULL) = ("approved_mapping_version" IS NULL) AND ("approved_digest" IS NULL OR "approved_digest" ~ '^[a-f0-9]{64}$') AND ("approved_count" IS NULL OR "approved_count" >= 0) AND ("engine_dry_run_digest" IS NULL OR "engine_dry_run_digest" ~ '^[a-f0-9]{64}$'));--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_run_source_connection_scope_fk') THEN
		ALTER TABLE "import_run" ADD CONSTRAINT "import_run_source_connection_scope_fk" FOREIGN KEY ("workspace_id","source_connection_id") REFERENCES "public"."import_source_connection"("workspace_id","id") ON DELETE no action ON UPDATE cascade;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_run_approval_pending_action_id_pending_action_id_fk') THEN
		ALTER TABLE "import_run" ADD CONSTRAINT "import_run_approval_pending_action_id_pending_action_id_fk" FOREIGN KEY ("approval_pending_action_id") REFERENCES "public"."pending_action"("id") ON DELETE set null ON UPDATE cascade;
	END IF;
END $$;
