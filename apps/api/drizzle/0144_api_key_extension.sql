-- P4 AK-1..AK-10 / MC-14 / MC-21: the `api_key` extension of better-auth's `apikey` (data-model.md).
-- Purely additive: a key with no extension row is a legacy personal, non-MCP key whose capability
-- subset is still better-auth's `permissions` column (fail-closed: NULL means no grants).
-- Exactly one of workspace_id (service key, no person) / person_id (personal key) is set, and an
-- MCP key is always personal (AK-10 / MC-21).
CREATE TABLE "api_key" (
	"apikey_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"person_id" text,
	"created_by_person_id" text,
	"capabilities" jsonb,
	"ip_allowlist" "inet"[],
	"rate_limit_per_minute" integer,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"is_mcp" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_exactly_one_owner" CHECK ((workspace_id IS NULL) <> (person_id IS NULL)),
	CONSTRAINT "api_key_mcp_requires_person" CHECK ((NOT is_mcp) OR (person_id IS NOT NULL)),
	CONSTRAINT "api_key_rate_limit_positive" CHECK ((rate_limit_per_minute IS NULL) OR (rate_limit_per_minute >= 1))
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_apikey_id_apikey_id_fk" FOREIGN KEY ("apikey_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "api_key_workspace_idx" ON "api_key" USING btree ("workspace_id") WHERE (workspace_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "api_key_person_idx" ON "api_key" USING btree ("person_id") WHERE (person_id IS NOT NULL);
