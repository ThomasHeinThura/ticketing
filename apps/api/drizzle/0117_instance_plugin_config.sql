CREATE TABLE "instance_plugin_config" (
	"id" text PRIMARY KEY NOT NULL,
	"plugin_id" text NOT NULL,
	"instance_key" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"config" jsonb NOT NULL,
	"secrets" "bytea",
	"scope" text NOT NULL,
	"workspace_id" text,
	"portal_scope" text,
	"config_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "instance_plugin_config_instance_unique" UNIQUE("plugin_id","instance_key"),
	CONSTRAINT "instance_plugin_config_scope_check" CHECK ("instance_plugin_config"."scope" in ('instance', 'workspace')),
	CONSTRAINT "instance_plugin_config_workspace_scope_check" CHECK (("instance_plugin_config"."scope" = 'instance' and "instance_plugin_config"."workspace_id" is null) or ("instance_plugin_config"."scope" = 'workspace' and "instance_plugin_config"."workspace_id" is not null)),
	CONSTRAINT "instance_plugin_config_portal_scope_check" CHECK ("instance_plugin_config"."portal_scope" is null or "instance_plugin_config"."portal_scope" in ('agent', 'customer', 'both')),
	CONSTRAINT "instance_plugin_config_auth_portal_scope_required" CHECK ("instance_plugin_config"."plugin_id" not like 'auth.%' or "instance_plugin_config"."portal_scope" is not null),
	CONSTRAINT "instance_plugin_config_non_auth_portal_scope_null" CHECK ("instance_plugin_config"."plugin_id" like 'auth.%' or "instance_plugin_config"."portal_scope" is null),
	CONSTRAINT "instance_plugin_config_version_positive" CHECK ("instance_plugin_config"."config_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "instance_plugin_config" ADD CONSTRAINT "instance_plugin_config_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_plugin_config" ADD CONSTRAINT "instance_plugin_config_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "instance_plugin_config_auth_version_idx" ON "instance_plugin_config" USING btree ("config_version") WHERE "instance_plugin_config"."plugin_id" like 'auth.%';
