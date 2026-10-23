CREATE TABLE "checklist_template" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "archived_at" timestamp,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "checklist_template_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "work_item_template" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "type_id" text NOT NULL,
  "name" text NOT NULL,
  "title" text NOT NULL,
  "description" jsonb,
  "labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "custom_field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "checklist_template_id" text,
  "recurrence" jsonb,
  "archived_at" timestamp,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "work_item_template_labels_array" CHECK (jsonb_typeof("labels") = 'array'),
  CONSTRAINT "work_item_template_custom_fields_object" CHECK (jsonb_typeof("custom_field_values") = 'object')
);
--> statement-breakpoint
CREATE TABLE "checklist_item" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "work_item_id" text,
  "template_id" text,
  "release_id" text,
  "position" integer NOT NULL,
  "text" text NOT NULL,
  "done_at" timestamp,
  "done_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "checklist_item_one_owner" CHECK (num_nonnulls("work_item_id","template_id","release_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item_template" ADD CONSTRAINT "work_item_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item_template" ADD CONSTRAINT "work_item_template_workspace_type_fk" FOREIGN KEY ("workspace_id","type_id") REFERENCES "public"."work_item_type"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_template" ADD CONSTRAINT "work_item_template_workspace_checklist_fk" FOREIGN KEY ("workspace_id","checklist_template_id") REFERENCES "public"."checklist_template"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_workspace_work_item_fk" FOREIGN KEY ("workspace_id","work_item_id") REFERENCES "public"."work_item"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_workspace_template_fk" FOREIGN KEY ("workspace_id","template_id") REFERENCES "public"."checklist_template"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_done_by_person_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_template_workspace_name_unique" ON "checklist_template" ("workspace_id", lower("name")) WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_template_workspace_name_unique" ON "work_item_template" ("workspace_id", lower("name")) WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "work_item_template_workspaceId_idx" ON "work_item_template" ("workspace_id");--> statement-breakpoint
CREATE INDEX "checklist_item_workItem_position_idx" ON "checklist_item" ("work_item_id","position") WHERE "work_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "checklist_item_template_position_idx" ON "checklist_item" ("template_id","position") WHERE "template_id" IS NOT NULL;
