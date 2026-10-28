-- 0199_p6_import_reconciliation: per-run reconciliation snapshot and cutover rehearsal evidence.
-- Hand-written and idempotent.
CREATE TABLE IF NOT EXISTS "import_reconciliation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"import_run_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"status" text NOT NULL,
	"source_available" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seed" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"computed_by" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_reconciliation_run_key" UNIQUE("import_run_id"),
	CONSTRAINT "import_reconciliation_status_allowed" CHECK ("status" IN ('pass','attention','fail')),
	CONSTRAINT "import_reconciliation_version_positive" CHECK ("version" > 0),
	CONSTRAINT "import_reconciliation_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object')
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_reconciliation_run_scope_fk') THEN
		ALTER TABLE "import_reconciliation" ADD CONSTRAINT "import_reconciliation_run_scope_fk" FOREIGN KEY ("workspace_id","import_run_id","plugin_id","source_ref") REFERENCES "public"."import_run"("workspace_id","id","plugin_id","source_ref") ON DELETE cascade ON UPDATE cascade;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_reconciliation_workspace_idx" ON "import_reconciliation" USING btree ("workspace_id","computed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cutover_rehearsal" (
	"id" text PRIMARY KEY NOT NULL,
	"rehearsal_key" text NOT NULL,
	"workspace_id" text,
	"import_run_id" text,
	"status" text NOT NULL,
	"database_name" text NOT NULL,
	"freeze_boundary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cutover_rehearsal_key" UNIQUE("rehearsal_key"),
	CONSTRAINT "cutover_rehearsal_status_allowed" CHECK ("status" IN ('passed','failed')),
	CONSTRAINT "cutover_rehearsal_json_shapes" CHECK (jsonb_typeof("freeze_boundary") = 'object' AND jsonb_typeof("steps") = 'array' AND jsonb_typeof("timings") = 'object' AND jsonb_typeof("report") = 'object')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutover_rehearsal_finished_idx" ON "cutover_rehearsal" USING btree ("finished_at");
