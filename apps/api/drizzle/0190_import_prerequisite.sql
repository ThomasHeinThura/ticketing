CREATE TABLE "import_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"import_run_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"state" text DEFAULT 'previewed' NOT NULL,
	"expected_run_version" integer NOT NULL,
	"input_digest" text NOT NULL,
	"input_payload" jsonb,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"record_count" integer NOT NULL,
	"source_cursor" text,
	"pending_action_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "import_chunk_run_key" UNIQUE("import_run_id","chunk_id"),
	CONSTRAINT "import_chunk_run_sequence_key" UNIQUE("import_run_id","sequence"),
	CONSTRAINT "import_chunk_state_allowed" CHECK ("import_chunk"."state" IN ('previewed','pending_approval','committed','rejected','failed')),
	CONSTRAINT "import_chunk_bounds" CHECK ("import_chunk"."sequence" >= 0 AND "import_chunk"."expected_run_version" > 0 AND "import_chunk"."record_count" BETWEEN 1 AND 500),
	CONSTRAINT "import_chunk_hash_valid" CHECK ("import_chunk"."input_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "import_chunk_json_shapes" CHECK (jsonb_typeof("import_chunk"."report") = 'object' AND ("import_chunk"."input_payload" IS NULL OR jsonb_typeof("import_chunk"."input_payload") = 'object')),
	CONSTRAINT "import_chunk_committed_binding" CHECK (("import_chunk"."state" = 'committed') = ("import_chunk"."committed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "import_mapping_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"mapping_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_profile_scope_source_key" UNIQUE("workspace_id","id","plugin_id","source_ref"),
	CONSTRAINT "import_profile_scope_name_key" UNIQUE("workspace_id","plugin_id","source_ref","name"),
	CONSTRAINT "import_profile_versions_positive" CHECK ("import_mapping_profile"."version" > 0 AND "import_mapping_profile"."mapping_version" > 0),
	CONSTRAINT "import_profile_mapping_object" CHECK (jsonb_typeof("import_mapping_profile"."mapping") = 'object')
);
--> statement-breakpoint
CREATE TABLE "import_record_link" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"import_run_id" text NOT NULL,
	"first_import_run_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_hash" text,
	"target_content_hash" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"source_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp with time zone,
	CONSTRAINT "import_link_stable_source_key" UNIQUE("workspace_id","plugin_id","source_ref","source_type","source_id","target_type"),
	CONSTRAINT "import_link_target_type_allowed" CHECK ("import_record_link"."target_type" = 'work_item'),
	CONSTRAINT "import_link_hash_valid" CHECK ("import_record_link"."source_hash" IS NULL OR "import_record_link"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "import_link_target_hash_valid" CHECK ("import_record_link"."target_content_hash" IS NULL OR "import_record_link"."target_content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"plugin_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"profile_id" text,
	"started_by" text,
	"started_by_api_key_id" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"dry_run_digest" text,
	"dry_run_expires_at" timestamp with time zone,
	"next_cursor" text,
	"last_committed_chunk" integer DEFAULT -1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_run_scope_source_key" UNIQUE("workspace_id","id","plugin_id","source_ref"),
	CONSTRAINT "import_run_state_allowed" CHECK ("import_run"."state" IN ('queued','running','paused','completed','failed')),
	CONSTRAINT "import_run_checkpoint_valid" CHECK ("import_run"."version" > 0 AND "import_run"."last_committed_chunk" >= -1),
	CONSTRAINT "import_run_json_shapes" CHECK (jsonb_typeof("import_run"."stats") = 'object' AND jsonb_typeof("import_run"."log") = 'array'),
	CONSTRAINT "import_run_preview_binding" CHECK (("import_run"."dry_run_digest" IS NULL) = ("import_run"."dry_run_expires_at" IS NULL) AND ("import_run"."dry_run_digest" IS NULL OR "import_run"."dry_run_digest" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_scope_check";--> statement-breakpoint
ALTER TABLE "import_chunk" ADD CONSTRAINT "import_chunk_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_chunk" ADD CONSTRAINT "import_chunk_pending_action_id_pending_action_id_fk" FOREIGN KEY ("pending_action_id") REFERENCES "public"."pending_action"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_mapping_profile" ADD CONSTRAINT "import_mapping_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_mapping_profile" ADD CONSTRAINT "import_mapping_profile_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_record_link" ADD CONSTRAINT "import_record_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_record_link" ADD CONSTRAINT "import_link_current_run_scope_fk" FOREIGN KEY ("workspace_id","import_run_id","plugin_id","source_ref") REFERENCES "public"."import_run"("workspace_id","id","plugin_id","source_ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_record_link" ADD CONSTRAINT "import_link_first_run_scope_fk" FOREIGN KEY ("workspace_id","first_import_run_id","plugin_id","source_ref") REFERENCES "public"."import_run"("workspace_id","id","plugin_id","source_ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_started_by_person_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_started_by_api_key_id_apikey_id_fk" FOREIGN KEY ("started_by_api_key_id") REFERENCES "public"."apikey"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_project_scope_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_profile_scope_fk" FOREIGN KEY ("workspace_id","profile_id","plugin_id","source_ref") REFERENCES "public"."import_mapping_profile"("workspace_id","id","plugin_id","source_ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "import_chunk_expiry_idx" ON "import_chunk" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "import_link_current_run_idx" ON "import_record_link" USING btree ("import_run_id","id");--> statement-breakpoint
CREATE INDEX "import_run_workspace_created_idx" ON "import_run" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_scope_check" CHECK ((workspace_id IS NOT NULL) OR ((organisation_id IS NULL) AND (kind = ANY (ARRAY['pending_action.requested'::text, 'pending_action.decided'::text, 'pending_action.executed'::text, 'identity.deprovisioned'::text, 'identity.provisioned'::text, 'api_key.auto_disabled'::text, 'import.chunk_completed'::text]))));