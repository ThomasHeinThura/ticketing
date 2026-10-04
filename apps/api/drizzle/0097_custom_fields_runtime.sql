CREATE TABLE "custom_field_section" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_section_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "custom_field_section_workspace_name_unique" UNIQUE("workspace_id","name"),
	CONSTRAINT "custom_field_section_position_nonnegative" CHECK ("custom_field_section"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custom_field" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"section_id" text NOT NULL,
	"entity_type" text DEFAULT 'work_item' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_value" jsonb,
	"help_text" text,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"visibility_condition" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "custom_field_workspace_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "custom_field_entity_type_allowed" CHECK ("custom_field"."entity_type" = 'work_item'),
	CONSTRAINT "custom_field_format_allowed" CHECK ("custom_field"."format" in ('text', 'long_text', 'number', 'decimal', 'currency', 'date', 'datetime', 'boolean', 'select', 'multi_select', 'user', 'multi_user', 'url', 'email')),
	CONSTRAINT "custom_field_key_nonempty" CHECK (length("custom_field"."key") > 0),
	CONSTRAINT "custom_field_position_nonnegative" CHECK ("custom_field"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custom_field_type_visibility" (
	"custom_field_id" text NOT NULL,
	"work_item_type_id" text NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	CONSTRAINT "custom_field_type_visibility_custom_field_id_work_item_type_id_pk" PRIMARY KEY("custom_field_id","work_item_type_id"),
	CONSTRAINT "custom_field_type_visibility_required_visible" CHECK (not "custom_field_type_visibility"."required" or "custom_field_type_visibility"."visible")
);
--> statement-breakpoint
CREATE TABLE "custom_field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"custom_field_id" text NOT NULL,
	"entity_type" text DEFAULT 'work_item' NOT NULL,
	"entity_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"project_id" text,
	"organisation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_value_field_entity_unique" UNIQUE("custom_field_id","entity_type","entity_id"),
	CONSTRAINT "custom_field_value_entity_type_allowed" CHECK ("custom_field_value"."entity_type" = 'work_item')
);
--> statement-breakpoint
ALTER TABLE "custom_field_section" ADD CONSTRAINT "custom_field_section_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_workspace_section_fk" FOREIGN KEY ("workspace_id","section_id") REFERENCES "public"."custom_field_section"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" ADD CONSTRAINT "custom_field_type_visibility_custom_field_id_custom_field_id_fk" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_type_visibility" ADD CONSTRAINT "custom_field_type_visibility_work_item_type_id_work_item_type_id_fk" FOREIGN KEY ("work_item_type_id") REFERENCES "public"."work_item_type"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_custom_field_id_custom_field_id_fk" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_section_workspace_position_idx" ON "custom_field_section" USING btree ("workspace_id","position","id");--> statement-breakpoint
CREATE INDEX "custom_field_workspace_active_idx" ON "custom_field" USING btree ("workspace_id","deleted_at","position","id");--> statement-breakpoint
CREATE INDEX "custom_field_type_visibility_type_idx" ON "custom_field_type_visibility" USING btree ("work_item_type_id","custom_field_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_project_reach_idx" ON "custom_field_value" USING btree ("project_id","custom_field_id","entity_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_organisation_reach_idx" ON "custom_field_value" USING btree ("organisation_id","custom_field_id","entity_id");