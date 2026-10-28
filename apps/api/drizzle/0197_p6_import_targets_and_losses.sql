-- 0197_p6_import_targets_and_losses: widen the ledger target types and add the per-run loss report.
-- Hand-written and idempotent.
ALTER TABLE "import_record_link" DROP CONSTRAINT IF EXISTS "import_link_target_type_allowed";--> statement-breakpoint
ALTER TABLE "import_record_link" ADD CONSTRAINT "import_link_target_type_allowed" CHECK ("target_type" IN ('work_item','comment','attachment','relation','activity','person','label','cycle','module','custom_field'));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_loss" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"import_run_id" text NOT NULL,
	"import_chunk_id" text,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"code" text NOT NULL,
	"detail_code" text DEFAULT '' NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_loss_run_source_code_key" UNIQUE("import_run_id","source_type","source_id","code","detail_code"),
	CONSTRAINT "import_loss_code_shape" CHECK ("code" ~ '^[a-z][a-z0-9_]{1,63}$' AND ("detail_code" = '' OR "detail_code" ~ '^[a-z][a-z0-9_]{1,63}$'))
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_loss_workspace_id_workspace_id_fk') THEN
		ALTER TABLE "import_loss" ADD CONSTRAINT "import_loss_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_loss_import_run_id_import_run_id_fk') THEN
		ALTER TABLE "import_loss" ADD CONSTRAINT "import_loss_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_loss_import_chunk_id_import_chunk_id_fk') THEN
		ALTER TABLE "import_loss" ADD CONSTRAINT "import_loss_import_chunk_id_import_chunk_id_fk" FOREIGN KEY ("import_chunk_id") REFERENCES "public"."import_chunk"("id") ON DELETE set null ON UPDATE cascade;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_loss_run_idx" ON "import_loss" USING btree ("import_run_id","id");
