CREATE TABLE "terminology_override" (
	"scope" text NOT NULL,
	"workspace_id" text,
	"audience" text DEFAULT 'both' NOT NULL,
	"term_key" text NOT NULL,
	"locale" text NOT NULL,
	"forms" jsonb NOT NULL,
	CONSTRAINT "terminology_override_scope" CHECK (scope IN ('instance', 'workspace')),
	CONSTRAINT "terminology_override_scope_workspace" CHECK ((scope = 'instance' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL)),
	CONSTRAINT "terminology_override_audience" CHECK (audience IN ('agent', 'customer', 'both')),
	CONSTRAINT "terminology_override_term_key" CHECK (term_key IN ('work_item', 'project', 'cycle', 'module', 'epic', 'request', 'submission', 'service', 'change')),
	CONSTRAINT "terminology_override_locale" CHECK (length(locale) BETWEEN 2 AND 35),
	CONSTRAINT "terminology_override_forms" CHECK (jsonb_typeof(forms) = 'object' AND forms ? 'other' AND (forms - ARRAY['zero','one','two','few','many','other']::text[]) = '{}'::jsonb AND NOT jsonb_path_exists(forms, '$.* ? (@.type() != "string" || @ == "")') AND octet_length(forms::text) <= 8192)
);
--> statement-breakpoint
ALTER TABLE "terminology_override" ADD CONSTRAINT "terminology_override_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "terminology_override_instance_unique" ON "terminology_override" USING btree ("audience","term_key","locale") WHERE scope = 'instance';--> statement-breakpoint
CREATE UNIQUE INDEX "terminology_override_workspace_unique" ON "terminology_override" USING btree ("workspace_id","audience","term_key","locale") WHERE scope = 'workspace';