CREATE TABLE "import_placeholder_claim" (
	"person_id" text PRIMARY KEY NOT NULL,
	"import_run_id" text NOT NULL,
	"normalized_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "import_placeholder_claim_email_shape" CHECK (length("import_placeholder_claim"."normalized_email") BETWEEN 3 AND 320 AND "import_placeholder_claim"."normalized_email" = lower(btrim("import_placeholder_claim"."normalized_email")) AND position('@' in "import_placeholder_claim"."normalized_email") > 1)
);
--> statement-breakpoint
ALTER TABLE "import_placeholder_claim" ADD CONSTRAINT "import_placeholder_claim_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "import_placeholder_claim" ADD CONSTRAINT "import_placeholder_claim_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "import_placeholder_claim_email_idx" ON "import_placeholder_claim" USING btree ("normalized_email");